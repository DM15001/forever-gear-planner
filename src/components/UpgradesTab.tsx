import { useMemo, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { sourceKind } from '../lib/farm';
import { formatDps } from '../lib/format';
import type { GameData } from '../lib/gameData';
import { type Guide, type GuideMark, guideMarks, guidePlan, markLabel, swapDelta } from '../lib/guides';
import { type Candidate, clash, type Gear, pairedSlot, plannedGear, scoreSet, slotCandidates, slotInUse, type SourceFilter, suggestPlan, usableSources, withItem } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { measureWeights, weightRuns } from '../lib/sim/live';
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
/** How many next-best items a slot lists below its upgrades. */
const ALTERNATIVES = 5;
const LONG_LIST = 25;

export function UpgradesTab({ spec, character, data, onChange, filter, onFilterChange: setFilter, defaultWeights, onWeightsChange }: Props) {
	const [expanded, setExpanded] = useState<Set<number>>(new Set());
	const [guideNotice, setGuideNotice] = useState<{
		title: string;
		skipped: string[];
	} | null>(null);
	// The last change that can be taken back: what it was called and how to undo it.
	const [undo, setUndo] = useState<{ label: string; back: () => void } | null>(null);
	// Measuring the stat weights for this character with the simulator.
	const [measuring, setMeasuring] = useState<string | null>(null);
	const [measureError, setMeasureError] = useState<string | null>(null);
	const measure = async () => {
		setMeasuring('Starting the simulator…');
		setMeasureError(null);
		try {
			const measured = await measureWeights(character, { ...spec, weights: defaultWeights }, simClient, (done, total) => setMeasuring(`Run ${done} of ${total}…`));
			onWeightsChange(measured);
		} catch (err) {
			setMeasureError(err instanceof Error ? err.message : 'The simulator failed.');
		} finally {
			setMeasuring(null);
		}
	};
	const marks = useMemo(() => guideMarks(data.guides), [data]);
	const faction = spec.races.find(r => r.id === character.race)?.faction;

	const gear = useMemo(() => plannedGear(character, data), [character, data]);
	const equipped = useMemo(() => scoreSet(character.gear, character, data, spec), [character, data, spec]);
	const planned = useMemo(() => scoreSet(gear, character, data, spec), [gear, character, data, spec]);
	const slots = useMemo(() => {
		const options = { character, data, spec, filter };
		return GEAR_SLOTS.map((slot, index) => ({
			slot,
			index,
			candidates: slotInUse(index, spec) ? slotCandidates(index, gear, options) : null,
		}));
	}, [gear, character, data, spec, filter]);

	const planCount = Object.keys(character.plan ?? {}).length;
	const setPlan = (plan: Record<number, number>, label?: string) => {
		setGuideNotice(null);
		const before = character.plan ?? {};
		setUndo(label ? { label, back: () => onChange({ ...character, plan: before }) } : null);
		onChange({ ...character, plan });
	};
	const hide = (item: Item) => {
		const before = filter;
		setUndo({ label: `${item.name} hidden`, back: () => setFilter(before) });
		setFilter({ ...filter, hiddenItems: [...filter.hiddenItems, item.id] });
	};
	const planGuide = (guide: Guide) => {
		const { plan, skipped } = guidePlan(guide, character, data, spec);
		onChange({ ...character, plan });
		setGuideNotice({ title: guide.title, skipped });
	};
	const planItem = (index: number, itemId: number) => {
		const next: Record<number, number> = { ...character.plan, [index]: itemId };
		// A ring or trinket that excludes the planned one in the other slot takes its place.
		const other = pairedSlot(index);
		if (other !== undefined && next[other] !== undefined && clash(data.itemById.get(itemId), data.itemById.get(next[other]))) delete next[other];
		setPlan(next);
	};
	/** True if the item cannot go into the slot because of what is worn in the other ring or trinket slot. */
	const blocked = (index: number, itemId: number) => {
		const other = pairedSlot(index);
		return other !== undefined && character.plan?.[other] === undefined && clash(data.itemById.get(itemId), data.itemById.get(character.gear[other]?.id ?? -1));
	};
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
						<span className="field-label">Your plan, estimated</span>
						<span className={`score num ${gain >= 0 ? 'delta-up' : 'delta-down'}`}>{planCount > 0 ? formatDelta(gain) : 'No plan yet'}</span>
						<span className="summary-hit">
							{hitText(equipped.hit)} now
							{planCount > 0 ? `, ${hitText(planned.hit)} planned` : ''}
						</span>
					</div>
				</div>
				<div className="actions">
					<button
						className="button button-primary"
						onClick={() =>
							setPlan(
								suggestPlan({
									character: { ...character, plan: {} },
									data,
									spec,
									filter,
								}),
								'Best set planned',
							)
						}
					>
						Plan the best set
					</button>
					<button className="button" onClick={() => setPlan({}, 'Plan cleared')} disabled={planCount === 0}>
						Clear plan{planCount > 0 ? ` (${planCount})` : ''}
					</button>
				</div>
				<p className="hidden-note">
					Too expensive, or you just do not want it? "Hide" next to an item leaves it out of every list and out of "Plan the best set".
					{filter.hiddenItems.length > 0 && (
						<>
							{' '}
							{filter.hiddenItems.length} hidden.{' '}
							<button className="link" onClick={() => setFilter({ ...filter, hiddenItems: [] })}>
								Show them again
							</button>
						</>
					)}
				</p>
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
						Planned the {guideNotice.title}.{guideNotice.skipped.length > 0 && ` Left out: ${guideNotice.skipped.join('; ')}.`}
					</p>
				)}
				<details className="explain">
					<summary>How is this calculated?</summary>
					<p className="hint">
						Every "DPS" number in the lists is an estimate: the item's stats times what each stat is worth for {spec.name} (see Stat weights below), plus what the simulator measured for procs, on-use effects and set bonuses. Items marked
						"sim it" have an effect nobody measured and may be better or worse than their number. Each +/- shows how the whole set changes, so hit rating past the cap counts for nothing.
					</p>
					<p className="hint">
						<strong>"Sim this"</strong> next to an item runs the real simulator for that one swap and shows the DPS change. "Simulate equipped gear" above does it for your whole set.
					</p>
				</details>
			</section>

			<details className="weights">
				<summary>Content (the same choice as on the Plan tab)</summary>
				<ContentPicker spec={spec} character={character} data={data} filter={filter} onChange={setFilter} />
			</details>

			<WeightsEditor
				weights={spec.weights}
				defaults={defaultWeights}
				onChange={onWeightsChange}
				runs={weightRuns({ ...spec, weights: defaultWeights })}
				measuring={measuring}
				measureError={measureError}
				onMeasure={import.meta.env.VITE_NO_SIM ? undefined : measure}
			/>

			<nav className="slot-nav" aria-label="Jump to a slot">
				{slots.map(({ slot, index, candidates }) => {
					if (!candidates) return null;
					const best = candidates[0]?.delta ?? 0;
					const isPlanned = character.plan?.[index] !== undefined && character.plan[index] !== character.gear[index]?.id;
					return (
						<a
							key={slot.key}
							href={`#slot-${slot.key}`}
							className={isPlanned ? 'slot-chip slot-chip-planned' : best > 0 ? 'slot-chip slot-chip-open' : 'slot-chip'}
							title={isPlanned ? 'Planned' : best > 0 ? 'An upgrade is available' : 'Nothing better with these filters'}
						>
							{slot.label}
							{best > 0 ? <span className="num delta-up">{formatDelta(best).replace(' DPS', '')}</span> : isPlanned ? <span className="slot-chip-mark">planned</span> : null}
						</a>
					);
				})}
			</nav>
			{undo && (
				<p className="undo-toast" role="status">
					{undo.label}.{' '}
					<button
						className="link"
						onClick={() => {
							undo.back();
							setUndo(null);
						}}
					>
						Undo
					</button>
					<button className="link undo-close" aria-label="Dismiss" onClick={() => setUndo(null)}>
						×
					</button>
				</p>
			)}

			{slots.map(({ slot, index, candidates }) => {
				if (!candidates) return null;
				const equippedItem = character.gear[index] ? data.itemById.get(character.gear[index]!.id) : undefined;
				const plannedId = character.plan?.[index];
				const plannedItem = plannedId && plannedId !== character.gear[index]?.id ? data.itemById.get(plannedId) : undefined;
				const plannedSource = (item: Item) => (
					<SourceLabel
						source={
							usableSources(item, faction, {
								...filter,
								rep: true,
								pvp: true,
								unknown: true,
							})[0] ?? item.sources?.[0]
						}
						data={data}
					/>
				);
				const limit = expanded.has(index) ? LONG_LIST : SHORT_LIST;
				const upgrades = candidates.filter(c => c.delta > 0).length;
				// What comes next if the planned or worn item stays out of reach: the best items that are not upgrades over it.
				const alternatives = candidates.filter(c => c.delta <= 0 && c.item.id !== character.gear[index]?.id && usableSources(c.item, faction, filter).some(source => sourceKind(source) !== 'unknown')).slice(0, ALTERNATIVES);
				const wornScore = plannedItem
					? scoreSet(
							gear.map((piece, i) => (i === index ? character.gear[index] : piece)),
							character,
							data,
							spec,
						).score
					: planned.score;
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
								<span className="upgrade-count">{upgrades === 0 ? 'Nothing better with these filters' : `${upgrades} upgrade${upgrades === 1 ? '' : 's'}`}</span>
							</p>
						</header>
						<GuidePicks
							guides={data.guides}
							slotIndex={index}
							data={data}
							currentId={gear[index]?.id}
							deltaOf={itemId => swapDelta(index, itemId, gear, character, data, spec)}
							onPlan={itemId => planItem(index, itemId)}
							blocked={itemId => blocked(index, itemId)}
							otherId={pairedSlot(index) !== undefined ? gear[pairedSlot(index)!]?.id : undefined}
						/>
						{upgrades > 0 && (
							<ul className="candidates">
								{candidates.slice(0, limit).map(candidate => (
									<CandidateRow
										key={candidate.item.id}
										candidate={candidate}
										marks={marks.get(candidate.item.id)}
										base={gear}
										variant={withItem(gear, index, candidate.item.id, data)}
										data={data}
										faction={faction}
										filter={filter}
										onPlan={() => planItem(index, candidate.item.id)}
										onHide={() => hide(candidate.item)}
									/>
								))}
							</ul>
						)}
						{upgrades > SHORT_LIST && (
							<button className="link" onClick={() => toggle(index)}>
								{expanded.has(index) ? 'Show fewer' : `Show ${Math.min(LONG_LIST, candidates.length)} items`}
							</button>
						)}
						{alternatives.length > 0 && (
							<details className="alternatives" open={Boolean(plannedItem)}>
								<summary>
									Next best {alternatives.length === 1 ? 'alternative' : `${alternatives.length} alternatives`}
									<span className="alternatives-why"> if {plannedItem ? 'the planned item does not drop' : 'you want a backup'}</span>
								</summary>
								<ul className="candidates">
									{alternatives.map(candidate => {
										const variant = withItem(gear, index, candidate.item.id, data);
										const overWorn = plannedItem ? scoreSet(variant, character, data, spec).score - wornScore : undefined;
										return (
											<CandidateRow
												key={candidate.item.id}
												candidate={candidate}
												note={overWorn !== undefined ? `${formatDelta(overWorn)} over what you wear` : undefined}
												marks={marks.get(candidate.item.id)}
												base={gear}
												variant={variant}
												data={data}
												faction={faction}
												filter={filter}
												onPlan={() => planItem(index, candidate.item.id)}
												onHide={() => hide(candidate.item)}
											/>
										);
									})}
								</ul>
							</details>
						)}
					</section>
				);
			})}
		</div>
	);
}

const formatDelta = formatDps;

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
	/** A second line under the gain, for example how the item compares with the worn one. */
	note?: string;
	marks?: GuideMark[];
	base: Gear;
	variant: Gear;
	data: GameData;
	faction: 'alliance' | 'horde' | undefined;
	filter: SourceFilter;
	onPlan: () => void;
	onHide: () => void;
}

function CandidateRow({ candidate, note, marks, base, variant, data, faction, filter, onPlan, onHide }: RowProps) {
	const { item, delta, incomplete } = candidate;
	const sources = usableSources(item, faction, filter);
	const stats = statLine(
		pieceStats(
			item,
			{
				id: item.id,
				...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}),
			},
			data,
		),
	);
	return (
		<li className="candidate">
			<span className={`candidate-delta num ${delta > 0 ? 'delta-up' : 'delta-down'}`}>
				{formatDelta(delta)}
				{note && <span className="candidate-note">{note}</span>}
			</span>
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
					Plan
				</button>
				<button className="link hide-item" onClick={onHide} title="Leave this item out of every list and out of 'Plan the best set', for example because it is too expensive or not in the game yet. Bring it back under Plan, Content.">
					Hide
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
	blocked: (itemId: number) => boolean;
	/** What sits in the other ring or trinket slot. */
	otherId: number | undefined;
}

/** What the guides pick for this slot, whatever the filters say. */
function GuidePicks({ guides, slotIndex, data, currentId, deltaOf, onPlan, blocked, otherId }: GuidePicksProps) {
	const kind = GEAR_SLOTS[slotIndex].kind;
	const rows = guides
		.map(guide => ({
			guide,
			entries: guide.entries.filter(e => (guide.fixedSet ? e.slotIndex === slotIndex : e.slot === kind)),
		}))
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
									) : clash(item, data.itemById.get(otherId ?? -1)) ? (
										<span className="guide-rank" title="Only one of these can be worn at a time.">
											{entry.itemId === otherId ? 'in the other slot' : 'excluded by the other slot'}
											{!blocked(entry.itemId) && (
												<>
													{' '}
													<button className="link" onClick={() => onPlan(entry.itemId)}>
														Move here
													</button>
												</>
											)}
										</span>
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
function WeightsEditor({
	weights,
	defaults,
	onChange,
	runs,
	measuring,
	measureError,
	onMeasure,
}: {
	weights: Weights;
	defaults: Weights;
	onChange: (weights: Weights | null) => void;
	runs: number;
	measuring: string | null;
	measureError: string | null;
	onMeasure?: () => void;
}) {
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
				How much DPS one point of each stat is worth. The defaults are the weights of the build, turned into DPS with one simulator measurement on its preset gear. Changing them changes every score on the site; the simulated DPS numbers are
				not affected.
			</p>
			<div className="weights-grid">
				{field('mainHandDps', 'Weapon DPS', weights.mainHandDps, v => ({
					...weights,
					mainHandDps: v,
				}))}
				{Object.keys(defaults.stats).map(key => field(key, LONG_LABEL.get(key) ?? key, weights.stats[key] ?? 0, v => ({ ...weights, stats: { ...weights.stats, [key]: v } })))}
				{field('hitRatingOverCap', 'Hit rating past the cap', weights.hitRatingOverCap, v => ({ ...weights, hitRatingOverCap: v }))}
			</div>
			{onMeasure && (
				<div className="measure">
					<button className="button button-primary" onClick={onMeasure} disabled={measuring !== null}>
						{measuring ?? 'Measure for my character'}
					</button>
					<p className="hint">
						Runs the simulator {runs} times on your equipped gear, once per stat, and replaces the weights with what comes out for you: your gear, talents, consumables and buffs. It takes from half a minute to a few minutes, and the scores
						on every tab follow.
					</p>
					{measureError && (
						<p className="field-error" role="alert">
							{measureError}
						</p>
					)}
				</div>
			)}
			<button className="button" onClick={() => onChange(null)} disabled={!changed}>
				Reset to the build's own weights
			</button>
		</details>
	);
}
