import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Gear } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { simKey, type SimOutcome } from '../lib/sim/request';
import type { Character } from '../lib/types';

/** Set VITE_NO_SIM=1 at build time for a copy of the site without the simulator files. */
const SIM_AVAILABLE = !import.meta.env.VITE_NO_SIM;

/** Iterations for a whole-set run and for a single swap. More is steadier but slower. */
export const SET_ITERATIONS = 3000;
export const SWAP_ITERATIONS = 2000;

interface SimApi {
	character: Character;
	result: (gear: Gear, iterations: number) => SimOutcome | undefined;
	isRunning: (gear: Gear, iterations: number) => boolean;
	run: (gear: Gear, iterations: number) => void;
	/** True while any run is queued or in progress. */
	busy: boolean;
	error: string | null;
}

const SimContext = createContext<SimApi | null>(null);

export function SimProvider({ character, children }: { character: Character; children: ReactNode }) {
	const [results, setResults] = useState<Record<string, SimOutcome>>({});
	const [running, setRunning] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);

	const run = useCallback(
		(gear: Gear, iterations: number) => {
			const key = simKey(character, gear, iterations);
			setRunning(old => new Set(old).add(key));
			setError(null);
			simClient
				.run(character, gear, iterations)
				.then(
					outcome => setResults(old => ({ ...old, [key]: outcome })),
					(err: Error) => setError(err.message),
				)
				.finally(() =>
					setRunning(old => {
						const next = new Set(old);
						next.delete(key);
						return next;
					}),
				);
		},
		[character],
	);

	const api = useMemo<SimApi>(
		() => ({
			character,
			result: (gear, iterations) => results[simKey(character, gear, iterations)],
			isRunning: (gear, iterations) => running.has(simKey(character, gear, iterations)),
			run,
			busy: running.size > 0,
			error,
		}),
		[character, results, running, run, error],
	);
	return <SimContext.Provider value={api}>{children}</SimContext.Provider>;
}

export function useSim(): SimApi {
	const api = useContext(SimContext);
	if (!api) throw new Error('useSim needs a SimProvider');
	return api;
}

const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(digits)}`;

/**
 * A "Sim" button that compares `variant` against `base` and then shows the DPS difference.
 * The margin is the standard error of the difference: differences smaller than it are noise.
 */
export function SimDelta({ base, variant, label = 'Sim' }: { base: Gear; variant: Gear; label?: string }) {
	const sim = useSim();
	const a = sim.result(base, SWAP_ITERATIONS);
	const b = sim.result(variant, SWAP_ITERATIONS);
	if (!SIM_AVAILABLE) return null;
	if (a && b) {
		const delta = b.dps - a.dps;
		const margin = Math.sqrt(a.error ** 2 + b.error ** 2);
		const clear = Math.abs(delta) > 2 * margin;
		return (
			<span className={`sim-delta num ${!clear ? 'sim-unclear' : delta > 0 ? 'delta-up' : 'delta-down'}`} title={`Simulated, ${SWAP_ITERATIONS} iterations each. Margin ±${margin.toFixed(1)} DPS.`}>
				{signed(delta)} DPS{clear ? '' : ' (within noise)'}
			</span>
		);
	}
	if (sim.isRunning(base, SWAP_ITERATIONS) || sim.isRunning(variant, SWAP_ITERATIONS)) return <span className="sim-delta sim-unclear">simulating…</span>;
	return (
		<button
			className="link sim-button"
			onClick={() => {
				if (!a) sim.run(base, SWAP_ITERATIONS);
				sim.run(variant, SWAP_ITERATIONS);
			}}>
			{label}
		</button>
	);
}

/** Simulated DPS of the equipped and the planned gear, side by side. */
export function SimSummary({ equipped, planned, hasPlan, auto = false }: { equipped: Gear; planned: Gear; hasPlan: boolean; auto?: boolean }) {
	const sim = useSim();
	const a = sim.result(equipped, SET_ITERATIONS);
	const b = hasPlan ? sim.result(planned, SET_ITERATIONS) : undefined;
	const runningNow = sim.isRunning(equipped, SET_ITERATIONS) || sim.isRunning(planned, SET_ITERATIONS);
	const complete = Boolean(a && (!hasPlan || b));
	const show = (outcome: typeof a) => (outcome ? `${outcome.dps.toFixed(0)} DPS` : '—');

	// With `auto`, a short pause after the last change starts the missing runs by itself.
	const { run } = sim;
	const needsEquipped = !a && !sim.isRunning(equipped, SET_ITERATIONS);
	const needsPlanned = hasPlan && !b && !sim.isRunning(planned, SET_ITERATIONS);
	useEffect(() => {
		if (!auto || !SIM_AVAILABLE || (!needsEquipped && !needsPlanned)) return;
		const timer = setTimeout(() => {
			if (needsEquipped) run(equipped, SET_ITERATIONS);
			if (needsPlanned) run(planned, SET_ITERATIONS);
		}, 1500);
		return () => clearTimeout(timer);
	}, [auto, needsEquipped, needsPlanned, equipped, planned, run]);

	if (!SIM_AVAILABLE) {
		return (
			<div className="sim-summary">
				<span className="field-label">Simulated with WoWSims</span>
				<p className="hint">The simulator is not part of this preview copy. Run the site locally or from GitHub Pages to get simulated DPS.</p>
			</div>
		);
	}

	return (
		<div className="sim-summary">
			<span className="field-label">Simulated with WoWSims</span>
			<div className="sim-numbers">
				<span>
					Equipped <strong className="num">{show(a)}</strong>
				</span>
				{hasPlan && (
					<span>
						Planned <strong className="num">{show(b)}</strong>
						{a && b && <span className={`num ${b.dps >= a.dps ? 'delta-up' : 'delta-down'}`}> {signed(b.dps - a.dps, 0)}</span>}
					</span>
				)}
				{!complete && (
					<button
						className="button"
						disabled={runningNow}
						onClick={() => {
							if (!a) sim.run(equipped, SET_ITERATIONS);
							if (hasPlan && !b) sim.run(planned, SET_ITERATIONS);
						}}>
						{runningNow ? 'Simulating…' : hasPlan ? 'Simulate both sets' : 'Simulate equipped gear'}
					</button>
				)}
			</div>
			{sim.error && (
				<p className="field-error" role="alert">
					The simulator failed: {sim.error}
				</p>
			)}
			<p className="hint">
				Real DPS from the WoWSims simulator, including procs and set bonuses: full raid buffs, a 3-minute single-target fight, the default rotation, enchants as set on your gear. The first run
				downloads the simulator (6 MB) and takes a few seconds longer. Each number has a margin of about ±1 DPS.
			</p>
		</div>
	);
}
