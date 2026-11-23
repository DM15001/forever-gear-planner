import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { unit } from '../lib/format';
import type { Gear } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { type SimActionId, simKey, type SimOutcome } from '../lib/sim/request';
import type { SimSetupData } from '../lib/sim/setup';
import { wowheadSpellUrl, wowheadData } from '../lib/stats';
import type { Character } from '../lib/types';
import { ICON_SOURCES } from './ItemIcon';

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
	/** Runs finished and runs asked for since the queue was last empty. */
	progress: { done: number; total: number };
	error: string | null;
}

const SimContext = createContext<SimApi | null>(null);

export function SimProvider({ character, children }: { character: Character; children: ReactNode }) {
	const [results, setResults] = useState<Record<string, SimOutcome>>({});
	const [running, setRunning] = useState<Set<string>>(new Set());
	const [error, setError] = useState<string | null>(null);
	const [progress, setProgress] = useState({ done: 0, total: 0 });

	const run = useCallback(
		(gear: Gear, iterations: number) => {
			const key = simKey(character, gear, iterations);
			setRunning(old => new Set(old).add(key));
			// A run that joins a finished queue starts the count again.
			setProgress(old => (old.done >= old.total ? { done: 0, total: 1 } : { ...old, total: old.total + 1 }));
			setError(null);
			simClient
				.run(character, gear, iterations)
				.then(
					outcome => setResults(old => ({ ...old, [key]: outcome })),
					(err: Error) => setError(err.message),
				)
				.finally(() => {
					setProgress(old => ({ ...old, done: old.done + 1 }));
					setRunning(old => {
						const next = new Set(old);
						next.delete(key);
						return next;
					});
				});
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
			progress,
			error,
		}),
		[character, results, running, run, progress, error],
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
			<span className={`sim-delta num ${!clear ? 'sim-unclear' : delta > 0 ? 'delta-up' : 'delta-down'}`} title={`Simulated, ${SWAP_ITERATIONS} iterations each. Margin ±${margin.toFixed(1)} ${unit()}.`}>
				{signed(delta)} {unit()}{clear ? '' : ' (within noise)'}
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

const thousands = (value: number) => (value >= 1000 ? `${(value / 1000).toFixed(value >= 10000 ? 1 : 2)}K` : value.toFixed(value >= 100 ? 0 : 1));

function ActionIcon({ icon }: { icon?: string }) {
	const [attempt, setAttempt] = useState(0);
	if (!icon || attempt >= ICON_SOURCES.length) return <span className="result-icon result-icon-empty" aria-hidden="true" />;
	return <img className="result-icon" src={ICON_SOURCES[attempt](icon)} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} />;
}

/** A bar for the runs in the queue: how many are done, and roughly how long the rest takes. */
export function SimProgress() {
	const sim = useSim();
	const [started, setStarted] = useState<number | null>(null);
	const { done, total } = sim.progress;
	useEffect(() => {
		if (sim.busy && started === null) setStarted(Date.now());
		if (!sim.busy && started !== null) setStarted(null);
	}, [sim.busy, started]);
	if (!sim.busy || total === 0) return null;
	const left = started !== null && done > 0 ? Math.round((((Date.now() - started) / done) * (total - done)) / 1000) : null;
	return <ProgressBar done={done} total={total} label={`Simulating ${Math.min(done + 1, total)} of ${total}`} detail={left !== null ? (left >= 90 ? `about ${Math.round(left / 60)} min left` : `about ${Math.max(1, left)} s left`) : undefined} />;
}

export function ProgressBar({ done, total, label, detail }: { done: number; total: number; label: string; detail?: string }) {
	return (
		<div className="progress" role="status">
			<div className="progress-text">
				<span>{label}</span>
				{detail && <span className="slot-source">{detail}</span>}
			</div>
			<div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
				<div style={{ width: `${Math.max(3, (done / Math.max(1, total)) * 100)}%` }} />
			</div>
		</div>
	);
}

/** What a run is made of: damage per spell with bars, effects with their uptime, and how the fights spread. */
function Breakdown({ title, outcome, names }: { title: string; outcome: SimOutcome; names: SimSetupData | null }) {
	// The damage source under the pointer: its row, its bar and its part of the strip light up together.
	const [lit, setLit] = useState<number | null>(null);
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
	const top = breakdown.actions[0]?.share || 1;
	const fights = Math.max(1, ...breakdown.histogram.map(([, count]) => count));
	const step = breakdown.histogram.length > 1 ? breakdown.histogram[1][0] - breakdown.histogram[0][0] : 1;
	return (
		<div className="breakdown">
			<h4>{title}</h4>
			<dl className="result-tiles">
				<div>
					<dt>{unit()}</dt>
					<dd className="num">{outcome.dps.toFixed(2)}</dd>
					<dd className="result-sub">± {breakdown.stdev.toFixed(0)} between fights</dd>
				</div>
				<div>
					<dt>Casts per minute</dt>
					<dd className="num">{breakdown.apm.toFixed(2)}</dd>
				</div>
				<div>
					<dt>Out of mana</dt>
					<dd className={breakdown.oomSeconds >= 0.5 ? 'num result-warn' : 'num'}>{breakdown.oomSeconds.toFixed(2)}s</dd>
				</div>
				<div>
					<dt>Fights</dt>
					<dd className="num">{outcome.iterations.toLocaleString('en')}</dd>
					<dd className="result-sub">about {breakdown.seconds.toFixed(0)} s each</dd>
				</div>
			</dl>
			<div className="result-strip" role="img" aria-label="Share of the damage per source">
				{breakdown.actions.map((row, index) => (
					<span key={index} className={lit === index ? 'result-strip-part result-lit' : 'result-strip-part'} style={{ width: `${row.share * 100}%`, opacity: lit === null || lit === index ? 1 : 0.3 }} title={`${nameOf(row.id)}: ${percent(row.share, 1)}`} onMouseEnter={() => setLit(index)} onMouseLeave={() => setLit(null)} />
				))}
			</div>
			<div className="result-scroll">
				<table className="result-table" onMouseLeave={() => setLit(null)}>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">{outcome.healing ? 'Healing done' : 'Damage done'}</th>
							<th scope="col" className="num">
								Casts
							</th>
							<th scope="col" className="num">
								Avg cast
							</th>
							<th scope="col" className="num">
								Hits
							</th>
							<th scope="col" className="num">
								Avg hit
							</th>
							<th scope="col" className="num">
								Crit %
							</th>
							<th scope="col" className="num">
								Miss %
							</th>
							<th scope="col" className="num" title={outcome.healing ? 'Healing per second of cast time' : 'Damage per second of cast time'}>
								{outcome.healing ? 'HPET' : 'DPET'}
							</th>
							<th scope="col" className="num">
								{unit()}
							</th>
						</tr>
					</thead>
					<tbody>
						{breakdown.actions.map((row, index) => (
							<tr key={index} className={lit === index ? 'result-lit' : lit !== null ? 'result-dim' : undefined} onMouseEnter={() => setLit(index)}>
								<th scope="row">
									<ActionIcon icon={row.id.spellId ? names?.spellIcons?.[row.id.spellId] : undefined} />
									{row.id.spellId ? (
										<a href={wowheadSpellUrl(row.id.spellId)} data-wowhead={wowheadData('spell', row.id.spellId)} target="_blank" rel="noreferrer">
											{nameOf(row.id)}
										</a>
									) : (
										nameOf(row.id)
									)}
									{row.pet && <span className="slot-source"> ({row.pet})</span>}
								</th>
								<td className="result-bar-cell">
									<span className="num result-share">{percent(row.share, 2)}</span>
									<span className="result-bar">
										<span style={{ width: `${(row.share / top) * 100}%` }} />
									</span>
									<span className="num result-total">{thousands(row.damage)}</span>
								</td>
								<td className="num">{row.casts >= 0.005 ? row.casts.toFixed(2) : ''}</td>
								<td className="num">{row.casts >= 0.005 ? thousands(row.damage / row.casts) : ''}</td>
								<td className="num">{row.hits.toFixed(2)}</td>
								<td className="num">{row.hits ? thousands(row.damage / row.hits) : ''}</td>
								<td className="num">{percent(row.crit, 2)}</td>
								<td className="num">{row.miss !== undefined ? percent(row.miss, 2) : ''}</td>
								<td className="num">{row.dpet !== undefined ? thousands(row.dpet) : ''}</td>
								<td className="num result-dps">{row.dps.toFixed(2)}</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
			{breakdown.histogram.length > 1 && (
				<figure className="result-histogram">
					<figcaption>How the single fights spread, in {unit()}</figcaption>
					<div className="result-bars">
						{breakdown.histogram.map(([bucket, count]) => {
							const typical = Math.abs(bucket + step / 2 - outcome.dps) <= breakdown.stdev;
							return <span key={bucket} className={typical ? 'result-column result-column-typical' : 'result-column'} style={{ height: `${(count / fights) * 100}%` }} title={`${bucket} to ${bucket + step} ${unit()}: ${count} fight${count === 1 ? '' : 's'}`} />;
						})}
					</div>
					<div className="result-axis num">
						<span>{breakdown.histogram[0][0]}</span>
						<span>{Math.round(outcome.dps)}</span>
						<span>{breakdown.histogram[breakdown.histogram.length - 1][0] + step}</span>
					</div>
				</figure>
			)}
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
	const show = (outcome: typeof a) => (outcome ? `${outcome.dps.toFixed(0)} ${unit()}` : '—');

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
			<SimProgress />
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
					{(a?.mending ?? b?.mending) && (
						<p className="hint">
							<span className="tag-estimate">estimate</span> Prayer of Mending is not in the tables above: the simulator cannot cast it yet, so it is added by hand.{' '}
							{[a && a.mending && ['Equipped', a.mending] as const, b && b.mending && ['Planned', b.mending] as const]
								.filter(row => !!row)
								.map(([label, m]) => `${label}: ${Math.round(m.perCast).toLocaleString('en')} per cast at ${Math.round(m.healingPower)} healing power, ${Math.round(m.gross)} HPS, less ${Math.round(m.displaced)} HPS for the casts it replaces = +${Math.round(m.hps)} HPS.`)
								.join(' ')}{' '}
							Switch it off under "What kind of healing?".
						</p>
					)}
					<p className="hint">
						{a?.healing ?? b?.healing
							? 'Per spell: healing done over the fight and its part of all healing, casts per fight, how often it crit, and healing per second. "Out of mana" is the time the healer stood without mana to cast.'
							: 'Per spell: average DPS, its part of all damage, casts per fight, how often it crit and how often a cast missed. Effects that were up for the whole fight are left out; the Sim setup tab lists them.'}
					</p>
				</details>
			)}
			<p className="hint">
				{unit() === 'HPS'
					? 'Healing per second over the whole fight, from the WoWSims simulator: its spell data, talents, mana regeneration and consumables, with the healing scenario picked above. Time spent out of mana counts as time without healing. The first run downloads the simulator (6 MB) and takes a few seconds longer.'
					: 'Real DPS from the WoWSims simulator, including procs and set bonuses: full raid buffs, a 3-minute single-target fight, the default rotation, enchants as set on your gear. The first run downloads the simulator (6 MB) and takes a few seconds longer. Each number has a margin of about ±1 DPS.'}
			</p>
		</div>
	);
}
