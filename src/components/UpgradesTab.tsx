import { useMemo, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import type { GameData } from '../lib/gameData';
import { type Candidate, DEFAULT_FILTER, plannedGear, scoreSet, slotCandidates, type SourceFilter, suggestPlan, usableSources } from '../lib/scoring';
import { iconUrl, sourceLine, statLine, wowheadItemUrl } from '../lib/stats';
import type { Character, Item, SpecConfig } from '../lib/types';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	onChange: (next: Character) => void;
}

const FILTER_LABELS: [keyof SourceFilter, string][] = [
	['drop', 'Dungeon and world drops'],
	['quest', 'Quests'],
	['crafted', 'Crafted'],
	['vendor', 'Vendors and reputation'],
	['pvp', 'PvP rewards'],
	['unknown', 'Unknown source'],
];
const SHORT_LIST = 6;
const LONG_LIST = 25;

export function UpgradesTab({ spec, character, data, onChange }: Props) {
	const [filter, setFilter] = useState<SourceFilter>(DEFAULT_FILTER);
	const [expanded, setExpanded] = useState<Set<number>>(new Set());
	const faction = spec.races.find(r => r.id === character.race)?.faction;

	const gear = useMemo(() => plannedGear(character), [character]);
	const equipped = useMemo(() => scoreSet(character.gear, character, data, spec), [character, data, spec]);
	const planned = useMemo(() => scoreSet(gear, character, data, spec), [gear, character, data, spec]);
	const slots = useMemo(() => {
		const options = { character, data, spec, filter };
		return GEAR_SLOTS.map((slot, index) => ({ slot, index, candidates: spec.weaponSetup === 'twoHand' && slot.key === 'offHand' ? null : slotCandidates(index, gear, options) }));
	}, [gear, character, data, spec, filter]);

	const planCount = Object.keys(character.plan ?? {}).length;
	const setPlan = (plan: Record<number, number>) => onChange({ ...character, plan });
	const planItem = (index: number, itemId: number) => setPlan({ ...character.plan, [index]: itemId });
	const unplan = (index: number) => {
		const { [index]: _removed, ...rest } = character.plan ?? {};
		setPlan(rest);
	};
	const toggle = (index: number) =>
		setExpanded(old => {
			const next = new Set(old);
			if (!next.delete(index)) next.add(index);
			return next;
		});

	const gain = planned.score - equipped.score;
	const hitText = (hit: typeof planned.hit) => `${hit.total.toFixed(1)}% of ${hit.cap}% hit${hit.ratingOver ? `, ${hit.ratingOver} rating over the cap` : ''}`;

	return (
		<div className="upgrades">
			<section className="panel summary" aria-label="Plan summary">
				<div className="summary-scores">
					<div>
						<span className="field-label">Equipped</span>
						<span className="score num">{Math.round(equipped.score).toLocaleString('en')}</span>
						<span className="summary-hit">{hitText(equipped.hit)}</span>
					</div>
					<div>
						<span className="field-label">Planned</span>
						<span className="score num">
							{Math.round(planned.score).toLocaleString('en')}
							{planCount > 0 && <span className={gain >= 0 ? 'delta-up' : 'delta-down'}> {formatDelta(gain)}</span>}
						</span>
						<span className="summary-hit">{hitText(planned.hit)}</span>
					</div>
				</div>
				<div className="actions">
					<button className="button button-primary" onClick={() => setPlan(suggestPlan({ character: { ...character, plan: {} }, data, spec, filter }))}>
						Plan the best set
					</button>
					<button className="button" onClick={() => setPlan({})} disabled={planCount === 0}>
						Clear plan{planCount > 0 ? ` (${planCount})` : ''}
					</button>
				</div>
				<p className="hint">
					The score adds up stats with the WoWSims weights for {spec.name}, in attack-power equivalents. Procs, on-use effects and set bonuses are not counted; items marked "sim it" may be better
					or worse than their number. Each +/- shows how the whole set changes, so hit rating past the cap counts for nothing.
				</p>
			</section>

			<fieldset className="filters">
				<legend>Show items from</legend>
				{FILTER_LABELS.map(([key, label]) => (
					<label key={key} className="check">
						<input type="checkbox" checked={filter[key]} onChange={e => setFilter({ ...filter, [key]: e.target.checked })} />
						{label}
					</label>
				))}
				{!faction && <p className="field-error">Pick a race on the Character tab to hide the other faction's items.</p>}
			</fieldset>

			{slots.map(({ slot, index, candidates }) => {
				if (!candidates) return null;
				const equippedItem = character.gear[index] ? data.itemById.get(character.gear[index]!.id) : undefined;
				const plannedId = character.plan?.[index];
				const plannedItem = plannedId && plannedId !== character.gear[index]?.id ? data.itemById.get(plannedId) : undefined;
				const plannedSource = (item: Item) => sourceLine(usableSources(item, faction, { ...filter, pvp: true, unknown: true })[0] ?? item.sources?.[0], data);
				const limit = expanded.has(index) ? LONG_LIST : SHORT_LIST;
				const upgrades = candidates.filter(c => c.delta > 0).length;
				return (
					<section key={slot.key} className="upgrade-slot" aria-labelledby={`slot-${slot.key}`}>
						<header className="upgrade-head">
							<h3 id={`slot-${slot.key}`}>{slot.label}</h3>
							<p className="upgrade-current">
								{plannedItem ? (
									<>
										<ItemName item={plannedItem} /> planned ({plannedSource(plannedItem)}), replacing {equippedItem ? <ItemName item={equippedItem} /> : 'an empty slot'}{' '}
										<button className="link" onClick={() => unplan(index)}>
											Undo
										</button>
									</>
								) : equippedItem ? (
									<>
										<ItemName item={equippedItem} /> equipped
									</>
								) : (
									'Empty'
								)}
								<span className="upgrade-count">
									{upgrades === 0 ? 'Nothing better with these filters' : `${upgrades} upgrade${upgrades === 1 ? '' : 's'}`}
								</span>
							</p>
						</header>
						{upgrades > 0 && (
							<ul className="candidates">
								{candidates.slice(0, limit).map(candidate => (
									<CandidateRow key={candidate.item.id} candidate={candidate} data={data} faction={faction} filter={filter} onPlan={() => planItem(index, candidate.item.id)} />
								))}
							</ul>
						)}
						{upgrades > SHORT_LIST && (
							<button className="link" onClick={() => toggle(index)}>
								{expanded.has(index) ? 'Show fewer' : `Show ${Math.min(LONG_LIST, candidates.length)} items`}
							</button>
						)}
					</section>
				);
			})}
		</div>
	);
}

const formatDelta = (value: number) => `${value >= 0 ? '+' : '−'}${Math.abs(Math.round(value)).toLocaleString('en')}`;

function ItemName({ item }: { item: Item }) {
	return (
		<a className={`quality-${item.quality}`} href={wowheadItemUrl(item.id)} target="_blank" rel="noreferrer">
			{item.name}
		</a>
	);
}

interface RowProps {
	candidate: Candidate;
	data: GameData;
	faction: 'alliance' | 'horde' | undefined;
	filter: SourceFilter;
	onPlan: () => void;
}

function CandidateRow({ candidate, data, faction, filter, onPlan }: RowProps) {
	const { item, delta, incomplete } = candidate;
	const sources = usableSources(item, faction, filter);
	const stats = statLine(item.stats ?? {});
	return (
		<li className="candidate">
			<span className={`candidate-delta num ${delta > 0 ? 'delta-up' : 'delta-down'}`}>{formatDelta(delta)}</span>
			<span className={`slot-icon slot-icon-small quality-border-${item.quality}`} aria-hidden="true">
				{item.icon && <img src={iconUrl(item.icon)} alt="" loading="lazy" onError={e => (e.currentTarget.style.display = 'none')} />}
			</span>
			<span className="candidate-body">
				<span className="candidate-name">
					<ItemName item={item} />
					{incomplete && (
						<span className="badge" title={badgeReason(item)}>
							sim it
						</span>
					)}
				</span>
				<span className="slot-stats">
					{item.weapon?.dps ? `${item.weapon.dps.toFixed(1)} DPS, ${item.weapon.speed?.toFixed(2)} speed${stats ? ', ' : ''}` : ''}
					{stats || (item.weapon?.dps ? '' : 'No stats')}
				</span>
				<span className="slot-source">
					{sources.length === 0
						? 'Source unknown'
						: sources
								.slice(0, 2)
								.map(s => sourceLine(s, data))
								.join(' or ')}
					{sources.length > 2 ? `, +${sources.length - 2} more` : ''}
				</span>
			</span>
			<button className="button button-small" onClick={onPlan}>
				Plan this
			</button>
		</li>
	);
}

function badgeReason(item: Item): string {
	const reasons: string[] = [];
	if (item.effects?.length) reasons.push('has a proc or on-use effect');
	if (item.setId) reasons.push(`is part of the set ${item.setName}`);
	if (item.randomSuffixOptions?.length) reasons.push('has a random suffix that is not counted');
	return `Score incomplete: ${reasons.join(', ')}.`;
}
