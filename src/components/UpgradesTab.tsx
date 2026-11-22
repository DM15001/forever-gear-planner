import { useMemo, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import type { GameData } from '../lib/gameData';
import { type Guide, type GuideMark, guideMarks, guidePlan, markLabel, swapDelta } from '../lib/guides';
import { type Candidate, type Gear, plannedGear, scoreSet, slotCandidates, slotInUse, type SourceFilter, suggestPlan, usableSources } from '../lib/scoring';
import { pieceStats, STAT_LABELS, statLine, wowheadItemUrl } from '../lib/stats';
import { ContentPicker } from './ContentPicker';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
import { SourceLabel, SourceList } from './SourceLabel';
import { SimDelta, SimSummary } from './Sim';
import type { Character, Item, SpecConfig } from '../lib/types';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	onChange: (next: Character) => void;
	filter: SourceFilter;
	onFilterChange: (next: SourceFilter) => void;
	defaultWeights: SpecConfig['weights'];
	/** null resets to the defaults. */
	onWeightsChange: (weights: SpecConfig['weights'] | null) => void;
}

const SHORT_LIST = 6;
const LONG_LIST = 25;

export function UpgradesTab({ spec, character, data, onChange, filter, onFilterChange: setFilter, defaultWeights, onWeightsChange }: Props) {
	const [expanded, setExpanded] = useState<Set<number>>(new Set());
	const [guideNotice, setGuideNotice] = useState<{ title: string; skipped: string[] } | null>(null);
	const marks = useMemo(() => guideMarks(data.guides), [data]);
	const faction = spec.races.find(r => r.id === character.race)?.faction;

	const gear = useMemo(() => plannedGear(character, data), [character, data]);
	const equipped = useMemo(() => scoreSet(character.gear, character, data, spec), [character, data, spec]);
	const planned = useMemo(() => scoreSet(gear, character, data, spec), [gear, character, data, spec]);
	const slots = useMemo(() => {
		const options = { character, data, spec, filter };
		return GEAR_SLOTS.map((slot, index) => ({ slot, index, candidates: slotInUse(index, spec) ? slotCandidates(index, gear, options) : null }));
	}, [gear, character, data, spec, filter]);

	const planCount = Object.keys(character.plan ?? {}).length;
	const setPlan = (plan: Record<number, number>) => {
		setGuideNotice(null);
		onChange({ ...character, plan });
	};
	const planGuide = (guide: Guide) => {
		const { plan, skipped } = guidePlan(guide, character, data, spec);
		onChange({ ...character, plan });
		setGuideNotice({ title: guide.title, skipped });
	};
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
				<SimSummary equipped={character.gear} planned={gear} hasPlan={planCount > 0} />
				<div className="guide-sets">
					<span className="field-label">Or start from a guide</span>
					{data.guides.map(guide => (
						<span key={guide.id} className="guide-set">
							<button className="button" onClick={() => planGuide(guide)}>
								Plan the {guide.title}
							</button>
							<a className="guide-meta" href={guide.url} target="_blank" rel="noreferrer">
								{guide.author ? `by ${guide.author}, ` : ''}
								{guide.updated ? `updated ${guide.updated}` : 'source'}
							</a>
						</span>
					))}
				</div>
				{guideNotice && (
					<p className="guide-notice" role="status">
						Planned the {guideNotice.title}.
						{guideNotice.skipped.length > 0 && ` Left out: ${guideNotice.skipped.join('; ')}.`}
					</p>
				)}
				<p className="hint">
					The score adds up stats with the WoWSims weights for {spec.name}, in points (see Stat weights below), plus what the simulator measured for procs, on-use effects and set bonuses. Items marked
					"sim it" have an effect nobody measured and may be better or worse than their number. Each +/- shows how the whole set changes, so hit rating past the cap counts for nothing.
				</p>
				<p className="hint">
					<strong>"Sim this"</strong> next to an item runs the real simulator for that one swap and shows the DPS change. "Simulate equipped gear" above does it for your whole set.
				</p>
			</section>

			<details className="weights">
				<summary>Content (the same choice as on the Plan tab)</summary>
				<ContentPicker spec={spec} character={character} data={data} filter={filter} onChange={setFilter} />
			</details>

			<WeightsEditor weights={spec.weights} defaults={defaultWeights} onChange={onWeightsChange} />

			{slots.map(({ slot, index, candidates }) => {
				if (!candidates) return null;
				const equippedItem = character.gear[index] ? data.itemById.get(character.gear[index]!.id) : undefined;
				const plannedId = character.plan?.[index];
				const plannedItem = plannedId && plannedId !== character.gear[index]?.id ? data.itemById.get(plannedId) : undefined;
				const plannedSource = (item: Item) => <SourceLabel source={usableSources(item, faction, { ...filter, rep: true, pvp: true, unknown: true })[0] ?? item.sources?.[0]} data={data} />;
				const limit = expanded.has(index) ? LONG_LIST : SHORT_LIST;
				const upgrades = candidates.filter(c => c.delta > 0).length;
				return (
					<section key={slot.key} className="upgrade-slot" aria-labelledby={`slot-${slot.key}`}>
						<header className="upgrade-head">
							<h3 id={`slot-${slot.key}`}>{slot.label}</h3>
							<p className="upgrade-current">
								{plannedItem ? (
									<>
										<ItemName item={plannedItem} icon /> planned ({plannedSource(plannedItem)}), replacing {equippedItem ? <ItemName item={equippedItem} icon worn /> : 'an empty slot'}{' '}
										<button className="link" onClick={() => unplan(index)}>
											Undo
										</button>
									</>
								) : equippedItem ? (
									<>
										<ItemName item={equippedItem} icon worn /> equipped
									</>
								) : (
									'Empty'
								)}
								<span className="upgrade-count">
									{upgrades === 0 ? 'Nothing better with these filters' : `${upgrades} upgrade${upgrades === 1 ? '' : 's'}`}
								</span>
							</p>
						</header>
						<GuidePicks
							guides={data.guides}
							slotIndex={index}
							data={data}
							currentId={gear[index]?.id}
							deltaOf={itemId => swapDelta(index, itemId, gear, character, data, spec)}
							onPlan={itemId => planItem(index, itemId)}
						/>
						{upgrades > 0 && (
							<ul className="candidates">
								{candidates.slice(0, limit).map(candidate => (
									<CandidateRow key={candidate.item.id} candidate={candidate} marks={marks.get(candidate.item.id)} base={gear} variant={gear.map((piece, i) => (i === index ? (piece?.enchant ? { id: candidate.item.id, enchant: piece.enchant } : { id: candidate.item.id }) : piece))} data={data} faction={faction} filter={filter} onPlan={() => planItem(index, candidate.item.id)} />
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

function ItemName({ item, icon = false, worn = false }: { item: Item; icon?: boolean; worn?: boolean }) {
	return (
		<>
			{icon && <ItemIcon icon={item.icon} quality={item.quality} inline />}
			<a className={`quality-${item.quality}`} href={wowheadItemUrl(item.id)} target="_blank" rel="noreferrer">
				{item.name}
				{!worn && suffixText(item)}
			</a>
			{!worn && <SuffixNote item={item} />}
		</>
	);
}

interface RowProps {
	candidate: Candidate;
	marks?: GuideMark[];
	base: Gear;
	variant: Gear;
	data: GameData;
	faction: 'alliance' | 'horde' | undefined;
	filter: SourceFilter;
	onPlan: () => void;
}

function CandidateRow({ candidate, marks, base, variant, data, faction, filter, onPlan }: RowProps) {
	const { item, delta, incomplete } = candidate;
	const sources = usableSources(item, faction, filter);
	const stats = statLine(pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data));
	return (
		<li className="candidate">
			<span className={`candidate-delta num ${delta > 0 ? 'delta-up' : 'delta-down'}`}>{formatDelta(delta)}</span>
			<ItemIcon icon={item.icon} quality={item.quality} small />
			<span className="candidate-body">
				<span className="candidate-name">
					<ItemName item={item} />
					{marks?.map(mark => (
						<span key={mark.guide.id} className="badge badge-guide">
							{markLabel(mark)}
						</span>
					))}
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
					{guideSource(marks) ?? <SourceList sources={sources} data={data} />}
					{!guideSource(marks) && sources.length > 2 ? `, +${sources.length - 2} more` : ''}
				</span>
			</span>
			<span className="candidate-actions">
				<SimDelta base={base} variant={variant} />
				<button className="button button-small" onClick={onPlan}>
					Plan this
				</button>
			</span>
		</li>
	);
}

function badgeReason(item: Item): string {
	const reasons: string[] = [];
	if (item.effects?.length) reasons.push('has a proc or on-use effect');
	if (item.setId) reasons.push(`is part of the set ${item.setName}`);
	if (item.randomSuffixOptions?.length && !item.bestSuffix) reasons.push('has a random suffix that is not counted');
	return `Score incomplete: ${reasons.join(', ')}.`;
}

/** A source taken from a guide. It wins over the item data, which is missing or coarser for these items. */
function guideSource(marks: GuideMark[] | undefined): string | undefined {
	const mark = marks?.find(m => m.source);
	return mark ? `${mark.source} (per ${mark.guide.label})` : undefined;
}

interface GuidePicksProps {
	guides: Guide[];
	slotIndex: number;
	data: GameData;
	currentId: number | undefined;
	deltaOf: (itemId: number) => number;
	onPlan: (itemId: number) => void;
}

/** What the guides pick for this slot, whatever the filters say. */
function GuidePicks({ guides, slotIndex, data, currentId, deltaOf, onPlan }: GuidePicksProps) {
	const kind = GEAR_SLOTS[slotIndex].kind;
	const rows = guides
		.map(guide => ({ guide, entries: guide.entries.filter(e => (guide.fixedSet ? e.slotIndex === slotIndex : e.slot === kind)) }))
		.filter(row => row.entries.length > 0);
	if (rows.length === 0) return null;
	return (
		<dl className="guide-picks">
			{rows.map(({ guide, entries }) => (
				<div key={guide.id} className="guide-pick-row">
					<dt>{guide.label}</dt>
					<dd>
						{entries.map(entry => {
							const item = data.itemById.get(entry.itemId);
							if (!item) return null;
							const isCurrent = entry.itemId === currentId;
							const delta = isCurrent ? 0 : deltaOf(entry.itemId);
							return (
								<span key={`${entry.itemId}-${entry.rank}`} className="guide-pick">
									{!guide.fixedSet && <span className="guide-rank">{entry.rank}</span>}
									<ItemName item={item} icon />
									{isCurrent ? (
										<span className="guide-rank">in the set</span>
									) : (
										<>
											<span className={`num ${delta > 0 ? 'delta-up' : 'delta-down'}`}>{formatDelta(delta)}</span>
											<button className="link" onClick={() => onPlan(entry.itemId)}>
												Plan
											</button>
										</>
									)}
								</span>
							);
						})}
					</dd>
				</div>
			))}
		</dl>
	);
}

type Weights = SpecConfig['weights'];
const LONG_LABEL = new Map(STAT_LABELS.map(([key, , long]) => [key, long]));

/** Lets the user change the stat weights behind the score. Collapsed by default. */
function WeightsEditor({ weights, defaults, onChange }: { weights: Weights; defaults: Weights; onChange: (weights: Weights | null) => void }) {
	const changed = JSON.stringify(weights) !== JSON.stringify(defaults);
	const field = (id: string, label: string, value: number, apply: (value: number) => Weights) => (
		<label key={id} className="weight">
			<span>{label}</span>
			<input
				type="number"
				step="0.01"
				min="0"
				value={value}
				onChange={e => {
					const next = Number(e.target.value);
					if (Number.isFinite(next) && next >= 0) onChange(apply(next));
				}}
			/>
		</label>
	);
	return (
		<details className="weights">
			<summary>Stat weights{changed ? ' (changed)' : ''}</summary>
			<p className="hint">
				How much one point of each stat is worth, in attack power. The defaults are the WoWSims weights for this spec. Changing them changes every score on the site; the simulated DPS numbers
				are not affected.
			</p>
			<div className="weights-grid">
				{field('mainHandDps', 'Weapon DPS', weights.mainHandDps, v => ({ ...weights, mainHandDps: v }))}
				{Object.keys(defaults.stats).map(key => field(key, LONG_LABEL.get(key) ?? key, weights.stats[key] ?? 0, v => ({ ...weights, stats: { ...weights.stats, [key]: v } })))}
				{field('hitRatingOverCap', 'Hit rating past the cap', weights.hitRatingOverCap, v => ({ ...weights, hitRatingOverCap: v }))}
			</div>
			<button className="button" onClick={() => onChange(null)} disabled={!changed}>
				Reset to the WoWSims weights
			</button>
		</details>
	);
}
