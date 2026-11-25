import { SPECS } from '../lib/specs';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { unit } from '../lib/format';
import type { Gear } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { type SimActionId, type SimActionRow, simKey, type SimOutcome, actionKey, type SimTimeline } from '../lib/sim/request';
import type { SimSetupData } from '../lib/sim/setup';
import { wowheadItemUrl, wowheadSpellUrl, wowheadData } from '../lib/stats';
import type { Character } from '../lib/types';
import { type ActionLook, ActionName, AuraTable, CastTable, LogView, ResourceLane, ResourceTables } from './BreakdownTabs';
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

/** Icons for result rows that are neither a spell nor an item: plain attacks and the like. */
const OTHER_ICONS: Record<string, string> = {
	OtherActionAttack: 'ability_meleedamage',
	OtherActionShoot: 'ability_marksmanship',
	OtherActionPet: 'ability_hunter_pet_wolf',
	OtherActionManaRegen: 'spell_magic_managain',
	OtherActionPotion: 'inv_potion_76',
	OtherActionExplosives: 'inv_misc_bomb_05',
};

/** One colour per row of the breakdown, the same in the graph, the strip and the bar. */
const ROW_COLORS = ['#e8c170', '#b9a4f5', '#e4572e', '#4fb0c6', '#8fd694', '#f28fb0', '#f2d541', '#7d8cf0', '#c98b5a', '#5fd3bc', '#d96fd0', '#a3b35a', '#f29e4c', '#6fa8dc', '#c27ba0', '#93c47d'];
const rowColor = (index: number) => ROW_COLORS[index % ROW_COLORS.length];

const clock = (seconds: number) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

/**
 * One simulated fight over time, stacked by damage source, biggest source at the bottom. The
 * breakdown's numbers are averages over thousands of fights; this is a single one of them, so
 * procs and cooldowns show as the peaks they are.
 */
function TimelineGraph({ timeline, rows, lit, onLit, nameOf }: { timeline: SimTimeline; rows: SimActionRow[]; lit: number | null; onLit: (index: number | null) => void; nameOf: (id: SimActionId) => string }) {
	const WIDTH = 1000;
	const HEIGHT = 200;
	const slices = Math.max(1, ...Object.values(timeline.series).map(list => list.length));
	// A little smoothing, or five-second slices look like a comb.
	const smooth = (list: number[] | undefined) => Array.from({ length: slices }, (_, i) => ((list?.[i - 1] ?? list?.[i] ?? 0) + 2 * (list?.[i] ?? 0) + (list?.[i + 1] ?? list?.[i] ?? 0)) / 4);
	const layers = rows.map(row => smooth(timeline.series[actionKey(row.id)]));
	const totals = Array.from({ length: slices }, (_, i) => layers.reduce((sum, layer) => sum + layer[i], 0));
	const peak = Math.max(1, ...totals);
	const x = (i: number) => (slices === 1 ? WIDTH : (i / (slices - 1)) * WIDTH);
	const y = (value: number) => HEIGHT - (value / peak) * HEIGHT;
	const below = new Array<number>(slices).fill(0);
	const areas = layers.map(layer => {
		const lower = below.slice();
		layer.forEach((value, i) => (below[i] += value));
		const top = below.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`);
		const bottom = lower.map((value, i) => `${x(i).toFixed(1)},${y(value).toFixed(1)}`).reverse();
		return `M${top.join('L')}L${bottom.join('L')}Z`;
	});
	const marks = [0, 0.25, 0.5, 0.75, 1].map(part => part * timeline.seconds);
	return (
		<figure className="result-timeline">
			<div className="result-timeline-plot">
				<span className="result-timeline-peak num">{thousands(peak)}</span>
				<svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} preserveAspectRatio="none" role="img" aria-label={`${unit()} over the time of one simulated fight, by source`} onMouseLeave={() => onLit(null)}>
					{[0.25, 0.5, 0.75].map(part => (
						<line key={part} x1={0} x2={WIDTH} y1={HEIGHT * part} y2={HEIGHT * part} className="result-timeline-grid" />
					))}
					{areas.map((path, index) => (
						<path key={index} d={path} fill={rowColor(index)} opacity={lit === null || lit === index ? 0.9 : 0.15} onMouseEnter={() => onLit(index)}>
							<title>{nameOf(rows[index].id)}</title>
						</path>
					))}
				</svg>
			</div>
			<div className="result-axis num">
				{marks.map(mark => (
					<span key={mark}>{clock(mark)}</span>
				))}
			</div>
			<figcaption>
				{unit()} over time in one simulated fight, stacked by source. Point at a row below to pick it out{lit !== null ? `: ${nameOf(rows[lit].id)}` : ''}.
			</figcaption>
		</figure>
	);
}

/** Pixels per second of fight on the cast time line. */
const CAST_SCALE = 26;

/** Every cast of one simulated fight: a row per spell, its icon at each moment it was cast. Scrolls sideways. */
function CastTimeline({ timeline, nameOf, iconOf, neverCast, look }: { timeline: SimTimeline; nameOf: (id: SimActionId) => string; iconOf: (id: SimActionId) => string | undefined; look: ActionLook; /** Spells and items that do damage without ever being cast, by the simulator's own count (Ignite): procs and burns. */ neverCast: Set<number> }) {
	// Attacks and procs (extra swings, Windfury, weapon procs) are part of the picture; they can be switched off.
	const [everything, setEverything] = useState(true);
	// Effects that are simply up for the whole fight say little on a time line.
	const [constant, setConstant] = useState(false);
	// One row per spell: the engine tells combo point counts and the like apart, the reader does not need to.
	const merged = new Map<string, { id: SimActionId; times: number[] }>();
	for (const row of timeline.casts) {
		if (!everything && (!row.pressed || neverCast.has(row.id.spellId ?? row.id.itemId ?? -1))) continue;
		const key = row.id.spellId ? `s${row.id.spellId}` : row.id.itemId ? `i${row.id.itemId}` : actionKey(row.id);
		const known = merged.get(key);
		if (known) known.times.push(...row.times);
		else merged.set(key, { id: row.id.spellId || row.id.itemId ? { ...row.id, tag: undefined } : row.id, times: [...row.times] });
	}
	const shown = [...merged.values()].sort((x, y) => y.times.length - x.times.length);
	const width = Math.ceil(timeline.seconds) * CAST_SCALE + 40;
	// Health only moves when something heals the player; as a lane it is a flat bar.
	const lanes = timeline.resources.filter(resource => resource.name !== 'health');
	// Effects that come and go, on the player and on the target; the ones that are simply always up only on request.
	const effects = timeline.auras
		.map(row => ({ ...row, up: row.spans.reduce((sum, [start, end]) => sum + end - start, 0) }))
		.filter(row => constant || row.up < timeline.seconds * 0.98 || row.spans.length > 1)
		.sort((x, y) => Number(x.target) - Number(y.target) || y.spans.length - x.spans.length);
	const ticks = Array.from({ length: Math.floor(timeline.seconds) + 1 }, (_, second) => second);
	if (timeline.casts.length === 0) return <p className="hint">The log of this fight lists no casts.</p>;
	return (
		<figure className="cast-timeline">
			<div className="cast-timeline-frame">
				<div className="cast-names">
					<div className="cast-ruler-gap" />
					{lanes.map(resource => (
						<div key={resource.name} className="cast-name cast-name-resource" title={`${resource.name}, 0 to ${Math.round(resource.max)}`}>
							{resource.name.replace(/^./, letter => letter.toUpperCase())}
						</div>
					))}
					{shown.map(row => (
						<div key={actionKey(row.id)} className="cast-name" title={`${nameOf(row.id)}: ${row.times.length} cast${row.times.length === 1 ? '' : 's'}`}>
							<ActionIcon icon={iconOf(row.id)} />
							{row.id.spellId ? (
								<a href={wowheadSpellUrl(row.id.spellId)} data-wowhead={wowheadData('spell', row.id.spellId)} target="_blank" rel="noreferrer">
									{nameOf(row.id)}
								</a>
							) : (
								nameOf(row.id)
							)}
						</div>
					))}
					{effects.map(row => (
						<div key={`${row.target ? 't' : 'p'}${actionKey(row.id)}`} className="cast-name cast-name-effect" title={`${nameOf(row.id)}${row.target ? ' on the target' : ''}: up ${Math.round((row.up / timeline.seconds) * 100)}% of the fight`}>
							<ActionName id={row.id} look={look} />
							{row.target && <span className="slot-source">target</span>}
						</div>
					))}
				</div>
				<div className="cast-scroll" tabIndex={0} aria-label="Casts over the time of the fight; scroll sideways">
					<div style={{ width }}>
						<div className="cast-ruler num">
							{ticks.map(second => (
								<span key={second} className={second % 5 === 0 ? 'cast-tick cast-tick-major' : 'cast-tick'} style={{ left: second * CAST_SCALE }}>
									{second % 5 === 0 ? clock(second) : ''}
								</span>
							))}
						</div>
						{lanes.map(resource => (
							<div key={resource.name} className="cast-row" title={`${resource.name} over the fight, 0 to ${Math.round(resource.max)}`}>
								<ResourceLane points={resource.points} max={resource.max} seconds={timeline.seconds} scale={CAST_SCALE} width={width} />
							</div>
						))}
						{shown.map(row => (
							<div key={actionKey(row.id)} className="cast-row">
								{row.times.map((time, i) => (
									<span key={i} className="cast-mark" style={{ left: Math.max(0, time) * CAST_SCALE }} title={time < 0 ? `${nameOf(row.id)}, ${(-time).toFixed(1)} s before the pull` : `${nameOf(row.id)} at ${clock(time)} (${time.toFixed(1)} s)`}>
										<ActionIcon icon={iconOf(row.id)} />
									</span>
								))}
							</div>
						))}
						{effects.map(row => (
							<div key={`${row.target ? 't' : 'p'}${actionKey(row.id)}`} className="cast-row">
								{row.spans.map(([start, end], i) => (
									<span key={i} className={row.target ? 'cast-span cast-span-target' : 'cast-span'} style={{ left: start * CAST_SCALE, width: Math.max(2, (end - start) * CAST_SCALE) }} title={`${nameOf(row.id)}: ${clock(start)} to ${clock(end)} (${(end - start).toFixed(1)} s)`} />
								))}
							</div>
						))}
					</div>
				</div>
			</div>
			<figcaption>
				One simulated fight: resources on top, then what was pressed (most used first), then the effects that came and went on you and on the target. Scroll sideways to follow the fight.{' '}
				<label className="check cast-all">
					<input type="checkbox" checked={everything} onChange={e => setEverything(e.target.checked)} />
					Attacks and procs
				</label>{' '}
				<label className="check cast-all">
					<input type="checkbox" checked={constant} onChange={e => setConstant(e.target.checked)} />
					Effects that are up all fight
				</label>
			</figcaption>
		</figure>
	);
}

/** What a run is made of: damage per spell with bars, effects with their uptime, and how the fights spread. */
function Breakdown({ outcome, names, timeline }: { outcome: SimOutcome; names: SimSetupData | null; /** One logged fight, for the graph over time; undefined while it loads or if it failed. */ timeline?: SimTimeline }) {
	// The damage source under the pointer: its row, its bar and its part of the strip light up together.
	const [lit, setLit] = useState<number | null>(null);
	// Above the table: the damage over time, or every cast on a time line.
	const [view, setView] = useState<'graph' | 'timeline' | 'buffs' | 'debuffs' | 'casts' | 'resources' | 'log'>('graph');
	const iconOf = (id: SimActionId) => (id.spellId ? names?.spellIcons?.[id.spellId] : id.itemId ? names?.itemIcons?.[id.itemId] : OTHER_ICONS[String(id.otherId ?? '')]);
	const breakdown = outcome.breakdown;
	if (!breakdown) return null;
	const nameOf = (id: SimActionId) => {
		const base = id.spellId ? (names?.spells[id.spellId] ?? `Spell ${id.spellId}`) : id.itemId ? (names?.items[id.itemId] ?? `Item ${id.itemId}`) : String(id.otherId ?? 'Other').replace(/^OtherAction/, '').replace(/([a-z])([A-Z])/g, '$1 $2');
		// Plain attacks come once per hand, and once more for every effect that grants an extra swing.
		if (id.otherId === 'OtherActionAttack') {
			if (id.tag === 14) return 'Main-hand attack';
			if (id.tag === 15) return 'Off-hand attack';
			if (id.tag) return `Extra attack (${names?.spells[id.tag] ?? `effect ${id.tag}`})`;
		}
		return id.rank ? `${base} (Rank ${id.rank})` : base;
	};
	const top = breakdown.actions[0]?.share || 1;
	const look: ActionLook = { nameOf, icon: id => <ActionIcon icon={iconOf(id)} /> };
	const tabs: [typeof view, string, boolean][] = [
		['graph', 'Graph', true],
		['timeline', 'Timeline', Boolean(timeline)],
		['buffs', 'Buffs', true],
		['debuffs', 'Debuffs', true],
		['casts', 'Casts', true],
		['resources', 'Resources', true],
		['log', 'Log', Boolean(timeline)],
	];
	const table = view === 'graph' || view === 'timeline';
	return (
		<div className="breakdown">
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
			<div className="result-tabs" role="tablist" aria-label="What to show of the run">
				{tabs.map(([id, label, ready]) => (
					<button key={id} role="tab" aria-selected={view === id} className="result-tab" disabled={!ready} title={ready ? undefined : 'Needs the log of one fight, which is still loading'} onClick={() => setView(id)}>
						{label}
					</button>
				))}
			</div>
			{view === 'buffs' && <AuraTable rows={breakdown.auras} look={look} empty="No effect on the character was recorded." />}
			{view === 'debuffs' && <AuraTable rows={breakdown.targetAuras} look={look} empty="No effect on the target was recorded." />}
			{view === 'casts' && <CastTable rows={breakdown.casts} look={look} />}
			{view === 'resources' && <ResourceTables groups={breakdown.resources} look={look} />}
			{view === 'log' && timeline && <LogView timeline={timeline} look={look} named={Boolean(names)} />}
			{table && (
				<>
			{timeline && view === 'timeline' ? (
				<CastTimeline timeline={timeline} nameOf={nameOf} iconOf={iconOf} look={look} neverCast={new Set(breakdown.actions.filter(row => row.casts < 0.005).map(row => row.id.spellId ?? row.id.itemId ?? 0))} />
			) : timeline ? (
				<TimelineGraph timeline={timeline} rows={breakdown.actions} lit={lit} onLit={setLit} nameOf={nameOf} />
			) : (
				<div className="result-strip" role="img" aria-label="Share of the damage per source">
					{breakdown.actions.map((row, index) => (
						<span key={index} className={lit === index ? 'result-strip-part result-lit' : 'result-strip-part'} style={{ width: `${row.share * 100}%`, background: rowColor(index), opacity: lit === null || lit === index ? 1 : 0.3 }} title={`${nameOf(row.id)}: ${percent(row.share, 1)}`} onMouseEnter={() => setLit(index)} onMouseLeave={() => setLit(null)} />
					))}
				</div>
			)}
			<div className="result-scroll">
				<table className="result-table" onMouseLeave={() => setLit(null)}>
					<thead>
						<tr>
							<th scope="col">Name</th>
							<th scope="col">Amount</th>
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
							<th scope="col" className="num" title="The largest single hit or tick in any of the simulated fights, crits included">
								Max hit
							</th>
							<th scope="col" className="num">
								Miss %
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
									<ActionIcon icon={iconOf(row.id)} />
									{row.id.spellId ? (
										<a href={wowheadSpellUrl(row.id.spellId)} data-wowhead={wowheadData('spell', row.id.spellId)} target="_blank" rel="noreferrer">
											{nameOf(row.id)}
										</a>
									) : row.id.itemId ? (
										<a href={wowheadItemUrl(row.id.itemId)} data-wowhead={wowheadData('item', row.id.itemId)} target="_blank" rel="noreferrer">
											{nameOf(row.id)}
										</a>
									) : (
										nameOf(row.id)
									)}
									{row.pet && <span className="slot-source"> ({row.pet})</span>}
									{row.estimate && (
										<span className="tag-estimate" title="Worked out by hand: the simulator cannot cast this spell yet. The other rows are lowered by the casts it replaces.">
											estimate
										</span>
									)}
								</th>
								<td className="result-bar-cell">
									<span className="num result-share">{percent(row.share, 2)}</span>
									<span className="result-bar">
										<span style={{ width: `${(row.share / top) * 100}%`, background: rowColor(index) }} />
									</span>
									<span className="num result-total">{thousands(row.damage)}</span>
								</td>
								<td className="num">{row.casts >= 0.005 ? row.casts.toFixed(2) : ''}</td>
								<td className="num">{row.casts >= 0.005 ? thousands(row.damage / row.casts) : ''}</td>
								<td className="num">{row.hits.toFixed(2)}</td>
								<td className="num">{row.hits ? thousands(row.damage / row.hits) : ''}</td>
								<td className="num">{percent(row.crit, 2)}</td>
								<td className="num">{row.maxHit !== undefined ? thousands(row.maxHit) : '-'}</td>
								<td className="num">{row.miss !== undefined ? percent(row.miss, 2) : '-'}</td>
								<td className="num result-dps">{row.dps.toFixed(2)}</td>
							</tr>
						))}
					</tbody>
					<tfoot>
						<tr>
							<th scope="row">Total</th>
							<td className="result-bar-cell">
								<span className="num result-share">100%</span>
								<span className="result-bar" />
								<span className="num result-total">{thousands(breakdown.actions.reduce((sum, row) => sum + row.damage, 0))}</span>
							</td>
							<td colSpan={7} />
							<td className="num result-dps">{outcome.dps.toFixed(2)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
				</>
			)}
		</div>
	);
}

/** A window over the page, closed with the X, the Escape key or a click beside it. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onClose]);
	return (
		<div className="modal-veil" onMouseDown={event => event.target === event.currentTarget && onClose()}>
			<div className={wide ? 'modal modal-wide' : 'modal'} role="dialog" aria-modal="true" aria-label={title}>
				<header className="modal-head">
					<h2>{title}</h2>
					<button className="modal-close" onClick={onClose} aria-label="Close" title="Close">
						<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
							<path d="M3 3l12 12M15 3L3 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
						</svg>
					</button>
				</header>
				<div className="modal-body">{children}</div>
			</div>
		</div>
	);
}

/** The breakdown of one set in a window: a tab for the equipped and one for the planned gear, each with graph and timeline. */
export function BreakdownDialog({ equipped, planned, hasPlan, initial = 'equipped', onClose }: { equipped: Gear; planned: Gear; hasPlan: boolean; initial?: 'equipped' | 'planned'; onClose: () => void }) {
	const sim = useSim();
	const a = sim.result(equipped, SET_ITERATIONS);
	const b = hasPlan ? sim.result(planned, SET_ITERATIONS) : undefined;
	const [which, setWhich] = useState<'equipped' | 'planned'>(hasPlan ? initial : 'equipped');
	const [names, setNames] = useState<SimSetupData | null>(null);
	const [timelines, setTimelines] = useState<Record<string, SimTimeline | undefined>>({});
	useEffect(() => {
		simClient.setup().then(setNames, () => undefined);
	}, []);
	const character = sim.character;
	const keyA = simKey(character, equipped, -1);
	const keyB = simKey(character, planned, -1);
	// The graph over time needs one logged fight per set.
	useEffect(() => {
		if (!SIM_AVAILABLE) return;
		for (const [key, gear, wanted] of [[keyA, equipped, Boolean(a)], [keyB, planned, Boolean(b)]] as const) {
			if (!wanted || key in timelines) continue;
			setTimelines(old => ({ ...old, [key]: undefined }));
			simClient.timeline(character, gear).then(
				timeline => setTimelines(old => ({ ...old, [key]: timeline })),
				() => undefined,
			);
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [keyA, keyB, Boolean(a), Boolean(b)]);
	const outcome = which === 'planned' ? b : a;
	const gear = which === 'planned' ? planned : equipped;
	const running = sim.isRunning(gear, SET_ITERATIONS);
	const healing = Boolean(a?.healing ?? b?.healing);
	const label = (text: string, result: typeof a) => `${text}${result ? `, ${result.dps.toFixed(0)} ${unit()}` : ''}`;
	return (
		<Modal title={healing ? 'Healing breakdown' : 'Damage breakdown'} onClose={onClose} wide>
			<div className="gear-tabs" role="tablist" aria-label="Which gear">
				<button role="tab" aria-selected={which === 'equipped'} className="gear-tab gear-tab-equipped" onClick={() => setWhich('equipped')}>
					{label('Equipped gear', a)}
				</button>
				{hasPlan && (
					<button role="tab" aria-selected={which === 'planned'} className="gear-tab gear-tab-planned" onClick={() => setWhich('planned')}>
						{label('Planned gear', b)}
					</button>
				)}
			</div>
			{!SIM_AVAILABLE ? (
				<p className="hint">The simulator is not part of this preview copy.</p>
			) : outcome ? (
				<Breakdown key={which} outcome={outcome} names={names} timeline={timelines[which === 'planned' ? keyB : keyA]} />
			) : (
				<div className="breakdown-missing">
					<p>This set has not been simulated yet.</p>
					<button className="button button-primary" disabled={running} onClick={() => sim.run(gear, SET_ITERATIONS)}>
						{running ? 'Simulating…' : `Simulate the ${which} gear`}
					</button>
					<SimProgress />
				</div>
			)}
			{outcome?.mending && (
				<p className="hint">
					<span className="tag-estimate">estimate</span> The simulator cannot cast Prayer of Mending yet, so its row is worked out by hand and the other rows are lowered by the casts it replaces: {Math.round(outcome.mending.perCast).toLocaleString('en')} per cast at{' '}
					{Math.round(outcome.mending.healingPower)} healing power, {Math.round(outcome.mending.gross)} HPS, less {Math.round(outcome.mending.displaced)} HPS for the casts it replaces = +{Math.round(outcome.mending.hps)} HPS.
				</p>
			)}
			{outcome && (
				<p className="hint">
					{healing
						? 'Per spell: healing done over the fight and its part of all healing, casts per fight, how often it crit, and healing per second. "Out of mana" is the time the healer stood without mana to cast.'
						: 'Per spell: average DPS, its part of all damage, casts per fight, how often it crit and how often a cast missed. Effects that were up for the whole fight are left out; Sim setup (top right) lists them.'}
				</p>
			)}
		</Modal>
	);
}

/** Simulated DPS of the equipped and the planned gear, side by side. */
export function SimSummary({ equipped, planned, hasPlan, auto = false, estimated }: { equipped: Gear; planned: Gear; hasPlan: boolean; auto?: boolean; /** The plan's gain as the lists estimate it, to warn when the simulator disagrees. */ estimated?: number }) {
	const sim = useSim();
	const a = sim.result(equipped, SET_ITERATIONS);
	const b = hasPlan ? sim.result(planned, SET_ITERATIONS) : undefined;
	const runningNow = sim.isRunning(equipped, SET_ITERATIONS) || sim.isRunning(planned, SET_ITERATIONS);
	const complete = Boolean(a && (!hasPlan || b));
	const [breakdownOpen, setBreakdownOpen] = useState(false);
	// The lists' weights were measured with the build's own talents; a character with others gets less exact estimates.
	const talentsDiffer = Boolean(sim.character.talents) && sim.character.talents !== SPECS.find(spec => spec.id === sim.character.specId)?.talents;
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
			{hasPlan && a && b && b.dps < a.dps - 1 && (
				<p className="notice notice-error sim-verdict" role="alert">
					<strong>The simulator says this plan is worse than what you wear</strong> ({signed(b.dps - a.dps, 0)} {unit()}). Do not farm for it as it stands. Press "Check the plan with the simulator" below: it tries the closest alternatives with real simulations and keeps what is better.
				</p>
			)}
			{hasPlan && a && b && b.dps >= a.dps - 1 && estimated !== undefined && Math.abs(estimated - (b.dps - a.dps)) > Math.max(10, 0.35 * Math.abs(estimated)) && (
				<p className="notice sim-verdict" role="status">
					<strong>Estimate and simulator are far apart:</strong> the lists estimate {signed(estimated, 0)} {unit()}, the simulator measures {signed(b.dps - a.dps, 0)}. The simulator is the one to trust. "Check the plan with the simulator" below goes through the plan with real simulations.
					{talentsDiffer && <> Your talents are not the build's standard ones, and the estimate assumes those: "Measure for my character" under Stat weights below makes it fit your talents.</>}
				</p>
			)}
			{sim.error && (
				<p className="field-error" role="alert">
					The simulator failed: {sim.error}
				</p>
			)}
			{(a?.breakdown || b?.breakdown) && (
				<p className="breakdown-open">
					<button className="button button-primary" onClick={() => setBreakdownOpen(true)}>
						{(a?.healing ?? b?.healing) ? 'Healing breakdown' : 'Damage breakdown'}
					</button>
					<span className="slot-source">Every spell, a graph and a timeline, for the equipped or the planned gear.</span>
				</p>
			)}
			{import.meta.env.VITE_CHANNEL === 'dev' && (
				<p className="breakdown-open">
					<button className="button" onClick={() => window.dispatchEvent(new Event('fgp-sim-setup'))}>
						Sim setup
					</button>
					<span className="slot-source">Buffs, consumables, talents and rotation the simulation uses.</span>
				</p>
			)}
			{breakdownOpen && <BreakdownDialog equipped={equipped} planned={planned} hasPlan={hasPlan} onClose={() => setBreakdownOpen(false)} />}
			<p className="hint">
				{unit() === 'HPS'
					? 'Healing per second over the whole fight, from the WoWSims simulator: its spell data, talents, mana regeneration and consumables, with the healing scenario picked above. Time spent out of mana counts as time without healing. The first run downloads the simulator (6 MB) and takes a few seconds longer.'
					: 'Real DPS from the WoWSims simulator, including procs and set bonuses: full raid buffs, a 3-minute single-target fight, the default rotation, enchants as set on your gear. The first run downloads the simulator (6 MB) and takes a few seconds longer. Each number has a margin of about ±1 DPS.'}
			</p>
		</div>
	);
}
