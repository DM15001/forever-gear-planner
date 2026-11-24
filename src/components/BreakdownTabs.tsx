import { type ReactNode, useMemo, useState } from 'react';
import { LOG_TOKEN, logAction, type SimActionId, type SimAuraRow, type SimCastRow, type SimResourceRow, type SimTimeline } from '../lib/sim/request';
import { wowheadData, wowheadItemUrl, wowheadSpellUrl } from '../lib/stats';

/** How the breakdown names an action and finds its icon; the tables and the log share it. */
export interface ActionLook {
	nameOf: (id: SimActionId) => string;
	icon: (id: SimActionId) => ReactNode;
}

/** An action by name, with the Wowhead tooltip where there is a spell or an item behind it. */
export function ActionName({ id, look, bare = false }: { id: SimActionId; look: ActionLook; /** No icon in front. */ bare?: boolean }) {
	const name = look.nameOf(id);
	return (
		<>
			{!bare && look.icon(id)}
			{id.spellId ? (
				<a href={wowheadSpellUrl(id.spellId)} data-wowhead={wowheadData('spell', id.spellId)} target="_blank" rel="noreferrer">
					{name}
				</a>
			) : id.itemId ? (
				<a href={wowheadItemUrl(id.itemId)} data-wowhead={wowheadData('item', id.itemId)} target="_blank" rel="noreferrer">
					{name}
				</a>
			) : (
				name
			)}
		</>
	);
}

const fixed = (value: number, digits = 2) => value.toFixed(digits);

/** Buffs on the character, or debuffs on the target: how often gained, per minute, and how much of the fight they were up. */
export function AuraTable({ rows, look, empty }: { rows: SimAuraRow[]; look: ActionLook; empty: string }) {
	if (rows.length === 0) return <p className="hint">{empty}</p>;
	return (
		<div className="result-scroll">
			<table className="result-table result-table-plain">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col" className="num" title="How often the effect was gained in one fight, on average">
							Procs
						</th>
						<th scope="col" className="num" title="Gains per minute">
							PPM
						</th>
						<th scope="col" className="num" title="Part of the fight the effect was up">
							Uptime
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={index}>
							<th scope="row">
								<ActionName id={row.id} look={look} />
							</th>
							<td className="num">{fixed(row.procs)}</td>
							<td className="num">{fixed(row.ppm)}</td>
							<td className="result-bar-cell">
								<span className="result-bar">
									<span style={{ width: `${row.uptime * 100}%` }} />
								</span>
								<span className="num result-total">{fixed(row.uptime * 100)}%</span>
							</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Everything cast or swung in a fight, damaging or not. */
export function CastTable({ rows, look }: { rows: SimCastRow[]; look: ActionLook }) {
	if (rows.length === 0) return <p className="hint">Nothing was cast.</p>;
	return (
		<div className="result-scroll">
			<table className="result-table result-table-plain">
				<thead>
					<tr>
						<th scope="col">Name</th>
						<th scope="col" className="num" title="Per fight, on average">
							Casts
						</th>
						<th scope="col" className="num" title="Casts per minute">
							CPM
						</th>
					</tr>
				</thead>
				<tbody>
					{rows.map((row, index) => (
						<tr key={index}>
							<th scope="row">
								<ActionName id={row.id} look={look} />
								{row.pet && <span className="slot-source"> ({row.pet})</span>}
							</th>
							<td className="num">{fixed(row.casts, 1)}</td>
							<td className="num">{fixed(row.cpm, 1)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

/** Per resource (mana, rage, energy, combo points, health): where it came from and where it went. */
export function ResourceTables({ groups, look }: { groups: { type: string; rows: SimResourceRow[] }[]; look: ActionLook }) {
	if (groups.length === 0) return <p className="hint">This fight used no resource the simulator tracks.</p>;
	return (
		<>
			{groups.map(group => (
				<section key={group.type} className="result-group">
					<h4>{group.type}</h4>
					<div className="result-scroll">
						<table className="result-table result-table-plain">
							<thead>
								<tr>
									<th scope="col">Name</th>
									<th scope="col" className="num" title="How often it gave or took the resource in one fight">
										Casts
									</th>
									<th scope="col" className="num" title="Per fight; negative for a cost">
										Gain
									</th>
									<th scope="col" className="num">
										Gain / s
									</th>
									<th scope="col" className="num">
										Avg gain
									</th>
									<th scope="col" className="num" title="The part that went over the cap and was lost">
										Wasted gain
									</th>
								</tr>
							</thead>
							<tbody>
								{group.rows.map((row, index) => (
									<tr key={index}>
										<th scope="row">
											<ActionName id={row.id} look={look} />
										</th>
										<td className="num">{fixed(row.events, 1)}</td>
										<td className={row.gain < 0 ? 'num result-cost' : 'num'}>{fixed(row.gain, 1)}</td>
										<td className={row.gain < 0 ? 'num result-cost' : 'num'}>{fixed(row.perSecond, 1)}</td>
										<td className="num">{fixed(row.average, 1)}</td>
										<td className={row.wasted >= 0.05 ? 'num result-warn' : 'num'}>{fixed(row.wasted, 1)}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>
			))}
		</>
	);
}

const stamp = (seconds: number) => {
	const sign = seconds < 0 ? '-' : '';
	const abs = Math.abs(seconds);
	const whole = Math.floor(abs);
	return `${sign}${String(Math.floor(whole / 60)).padStart(2, '0')}:${String(whole % 60).padStart(2, '0')}.${String(Math.round((abs - whole) * 1000)).padStart(3, '0')}`;
};

/** Lines the rotation writes while it waits; they bury everything else. */
const WAITING = /^(Pausing rotation|No available actions|Queueing up)/;
const LOG_PAGE = 400;

// The engine prints stat changes as {"FireResistance": -75.000,}; read as "-75 Fire Resistance".
const tidy = (text: string) =>
	text.replace(/\{((?:"\w+": -?[\d.]+,?\s*)+)\}/g, (_, list: string) =>
		[...list.matchAll(/"(\w+)": (-?[\d.]+)/g)].map(([, stat, value]) => `${Number(value)} ${stat.replace(/([a-z])([A-Z])/g, '$1 $2')}`).join(', '),
);

/** The whole log of one simulated fight, searchable, with every spell and item named and linked. */
export function LogView({ timeline, look, named }: { timeline: SimTimeline; look: ActionLook; /** False until the spell and item names are loaded; the search text is built again then. */ named: boolean }) {
	const [query, setQuery] = useState('');
	const [waits, setWaits] = useState(false);
	const [limit, setLimit] = useState(LOG_PAGE);
	// The text a search runs over has the names in it, not the engine's numbers.
	const lines = useMemo(
		() =>
			timeline.log.map(line => ({
				...line,
				plain: tidy(line.text).replace(LOG_TOKEN, (_, kind: string, id: string, tag?: string) => look.nameOf(logAction(kind, id, tag))),
			})),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[timeline, named],
	);
	const wanted = query.trim().toLowerCase();
	const shown = useMemo(() => lines.filter(line => (waits || !WAITING.test(line.text)) && (!wanted || line.plain.toLowerCase().includes(wanted) || line.who.toLowerCase().includes(wanted))), [lines, waits, wanted]);
	const render = (text: string): ReactNode[] => {
		const parts: ReactNode[] = [];
		let last = 0;
		for (const match of text.matchAll(LOG_TOKEN)) {
			if (match.index > last) parts.push(text.slice(last, match.index));
			parts.push(
				<span key={match.index} className="log-action">
					<ActionName id={logAction(match[1], match[2], match[3])} look={look} />
				</span>,
			);
			last = match.index + match[0].length;
		}
		if (last < text.length) parts.push(text.slice(last));
		return parts;
	};
	return (
		<div className="log-view">
			<div className="log-tools">
				<input
					type="search"
					value={query}
					placeholder="Search the log…"
					aria-label="Search the log"
					onChange={event => {
						setQuery(event.target.value);
						setLimit(LOG_PAGE);
					}}
				/>
				<label className="check">
					<input type="checkbox" checked={waits} onChange={event => setWaits(event.target.checked)} />
					Also show the rotation waiting
				</label>
				<span className="slot-source">
					{shown.length.toLocaleString('en')} of {lines.length.toLocaleString('en')} lines, one simulated fight
				</span>
			</div>
			<div className="log-scroll" tabIndex={0}>
				<table className="log-table">
					<thead>
						<tr>
							<th scope="col">Time</th>
							<th scope="col">Event</th>
						</tr>
					</thead>
					<tbody>
						{shown.slice(0, limit).map((line, index) => (
							<tr key={index}>
								<td className="num">{stamp(line.time)}</td>
								<td>
									<span className={line.who.startsWith('Target') ? 'log-who log-who-target' : 'log-who'}>[{line.who.replace(/ \(#\d+\)/, '')}]</span> {render(tidy(line.text))}
								</td>
							</tr>
						))}
					</tbody>
				</table>
				{shown.length > limit && (
					<p className="log-more">
						<button className="button" onClick={() => setLimit(limit + LOG_PAGE * 3)}>
							Show {Math.min(LOG_PAGE * 3, shown.length - limit).toLocaleString('en')} more lines
						</button>
					</p>
				)}
				{shown.length === 0 && <p className="hint">No line matches.</p>}
			</div>
		</div>
	);
}

/** One resource over the fight as a filled step line, on the timeline's own scale. */
export function ResourceLane({ points, max, seconds, scale, width }: { points: [number, number][]; max: number; seconds: number; scale: number; width: number }) {
	const height = 24;
	const y = (value: number) => (height - 2 - (Math.max(0, Math.min(max, value)) / (max || 1)) * (height - 4)).toFixed(1);
	let path = `M0 ${height}`;
	let previous = points[0]?.[1] ?? 0;
	path += ` L0 ${y(previous)}`;
	for (const [time, value] of points) {
		const x = (Math.min(seconds, time) * scale).toFixed(1);
		path += ` L${x} ${y(previous)} L${x} ${y(value)}`;
		previous = value;
	}
	path += ` L${(seconds * scale).toFixed(1)} ${y(previous)} L${(seconds * scale).toFixed(1)} ${height} Z`;
	return (
		<svg className="cast-resource" width={width} height={height} aria-hidden="true">
			<path d={path} />
		</svg>
	);
}
