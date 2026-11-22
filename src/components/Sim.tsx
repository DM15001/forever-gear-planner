import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import type { Gear } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { type SimActionId, simKey, type SimOutcome } from '../lib/sim/request';
import type { SimSetupData } from '../lib/sim/setup';
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
export function SimDelta({ base, variant, label = 'Sim this' }: { base: Gear; variant: Gear; label?: string }) {
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
			className="button button-small sim-button"
			onClick={() => {
				if (!a) sim.run(base, SWAP_ITERATIONS);
				sim.run(variant, SWAP_ITERATIONS);
			}}>
			{label}
		</button>
	);
}

const percent = (value: number, digits = 0) => `${(value * 100).toFixed(digits)}%`;

/** What a run is made of: damage per spell, effects with their uptime, and the spread of the result. */
function Breakdown({ title, outcome, names }: { title: string; outcome: SimOutcome; names: SimSetupData | null }) {
	const breakdown = outcome.breakdown;
	if (!breakdown) return null;
	const nameOf = (id: SimActionId) => {
		const base = id.spellId ? (names?.spells[id.spellId] ?? `Spell ${id.spellId}`) : id.itemId ? (names?.items[id.itemId] ?? `Item ${id.itemId}`) : String(id.otherId ?? 'Other').replace(/^OtherAction/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
		return id.rank ? `${base} (Rank ${id.rank})` : base;
	};
	// Effects that are simply always on say nothing about the run; the ones that come and go do.
	const timed = (list: typeof breakdown.auras) => list.filter(aura => aura.uptime < 0.995);
	const buffs = timed(breakdown.auras);
	const debuffs = timed(breakdown.targetAuras);
	return (
		<div className="breakdown">
			<h4>{title}</h4>
			<p className="slot-source">
				{outcome.dps.toFixed(1)} DPS on average over {outcome.iterations.toLocaleString('en')} fights of about {breakdown.seconds.toFixed(0)} seconds. Single fights ran from {breakdown.min.toFixed(0)} to{' '}
				{breakdown.max.toFixed(0)} DPS (standard deviation {breakdown.stdev.toFixed(0)}).
				{breakdown.oomSeconds >= 0.5 && ` Out of mana for ${breakdown.oomSeconds.toFixed(1)} seconds per fight.`}
			</p>
			<table className="breakdown-table">
				<thead>
					<tr>
						<th scope="col">Damage from</th>
						<th scope="col" className="num">
							DPS
						</th>
						<th scope="col" className="num">
							Share
						</th>
						<th scope="col" className="num">
							Casts
						</th>
						<th scope="col" className="num">
							Crit
						</th>
						<th scope="col" className="num">
							Miss
						</th>
					</tr>
				</thead>
				<tbody>
					{breakdown.actions.map((row, index) => (
						<tr key={index}>
							<th scope="row">
								{nameOf(row.id)}
								{row.pet && <span className="slot-source"> ({row.pet})</span>}
							</th>
							<td className="num">{row.dps.toFixed(1)}</td>
							<td className="num">{percent(row.share, 1)}</td>
							<td className="num">{row.casts >= 0.05 ? row.casts.toFixed(1) : ''}</td>
							<td className="num">{percent(row.crit)}</td>
							<td className="num">{row.miss !== undefined ? percent(row.miss) : ''}</td>
						</tr>
					))}
				</tbody>
			</table>
			{buffs.length > 0 && (
				<p className="slot-source">
					<strong>Procs and timed effects on you:</strong> {buffs.map(aura => `${nameOf(aura.id)} ${percent(aura.uptime)}`).join(', ')}.
				</p>
			)}
			{debuffs.length > 0 && (
				<p className="slot-source">
					<strong>Effects on the target that were not up all the time:</strong> {debuffs.map(aura => `${nameOf(aura.id)} ${percent(aura.uptime)}`).join(', ')}.
				</p>
			)}
		</div>
	);
}

/** Simulated DPS of the equipped and the planned gear, side by side. */
export function SimSummary({ equipped, planned, hasPlan, auto = false }: { equipped: Gear; planned: Gear; hasPlan: boolean; auto?: boolean }) {
	const sim = useSim();
	const a = sim.result(equipped, SET_ITERATIONS);
	const b = hasPlan ? sim.result(planned, SET_ITERATIONS) : undefined;
	const runningNow = sim.isRunning(equipped, SET_ITERATIONS) || sim.isRunning(planned, SET_ITERATIONS);
	const complete = Boolean(a && (!hasPlan || b));
	// Spell and item names for the breakdown, fetched when it is first opened.
	const [names, setNames] = useState<SimSetupData | null>(null);
	const loadNames = () => {
		if (!names) simClient.setup().then(setNames, () => undefined);
	};
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
			{(a?.breakdown || b?.breakdown) && (
				<details className="sim-details" onToggle={loadNames}>
					<summary>Show how these numbers come about</summary>
					{a && <Breakdown title="Equipped gear" outcome={a} names={names} />}
					{b && <Breakdown title="Planned gear" outcome={b} names={names} />}
					<p className="hint">
						Per spell: average DPS, its part of all damage, casts per fight, how often it crit and how often a cast missed. Effects that were up for the whole fight are left out; the Sim setup tab
						lists them.
					</p>
				</details>
			)}
			<p className="hint">
				Real DPS from the WoWSims simulator, including procs and set bonuses: full raid buffs, a 3-minute single-target fight, the default rotation, enchants as set on your gear. The first run
				downloads the simulator (6 MB) and takes a few seconds longer. Each number has a margin of about ±1 DPS.
			</p>
		</div>
	);
}
