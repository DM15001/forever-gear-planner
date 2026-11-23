import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { sourceKind } from '../lib/farm';
import { FightPicker } from './FightPicker';
import { formatDps, unit } from '../lib/format';
import type { GameData } from '../lib/gameData';
import { type Guide, type GuideMark, guideMarks, guidePlan, markLabel, swapDelta } from '../lib/guides';
import { EVERYTHING, type Candidate, clash, type Gear, oneRandomRoll, pairedSlot, plannedGear, scoreSet, slotCandidates, slotInUse, type SourceFilter, suggestPlan, usableSources, withItem } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { measureWeights, weightRuns } from '../lib/sim/live';
import { conditionalLines, matchesFight, pieceStats, STAT_LABELS, statLine, wowheadItemUrl, wowheadData } from '../lib/stats';
import { ContentPicker } from './ContentPicker';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
import { SourceLabel, SourceList } from './SourceLabel';
import { SET_ITERATIONS, SimDelta, SimSummary, useSim } from './Sim';
import type { Character, Item, SpecConfig, Stats } from '../lib/types';

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

/** The yes/no parts of the content choice, as chips above the lists. */
const FILTER_CHIPS: [key: 'quest' | 'crafted' | 'rep' | 'vendor' | 'currency' | 'drop' | 'pvp' | 'randomSuffix' | 'unknown' | 'notYetAvailable', label: string][] = [
	['quest', 'Quests'],
	['crafted', 'Crafted'],
	['rep', 'Reputation'],
	['vendor', 'Vendors'],
	['currency', 'Currency vendors'],
	['drop', 'World drops'],
	['pvp', 'PvP'],
	['randomSuffix', 'Random suffix'],
	['unknown', 'Unknown source'],
	['notYetAvailable', 'Not in game yet'],
];
/** How many items the list for a picked enemy or terrain shows. */
const FIGHT_PICKS = 12;
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

	// With an enemy type, creature or terrain picked: every usable item that has a bonus for it, once, in its best slot.
	const fightPicks = useMemo(() => {
		if (!data.fight) return null;
		const best = new Map<number, { index: number; candidate: Candidate }>();
		for (const { index, candidates } of slots) {
			for (const candidate of candidates ?? []) {
				if (!matchesFight(candidate.item, data.fight)) continue;
				const known = best.get(candidate.item.id);
				if (!known || candidate.delta > known.candidate.delta) best.set(candidate.item.id, { index, candidate });
			}
		}
		return [...best.values()].sort((a, b) => b.candidate.delta - a.candidate.delta);
	}, [slots, data.fight]);

	// Slots with nothing better in the lists: what the content choice leaves out there. Worked out after
	// the page is drawn, since it looks at every item again.
	const [outside, setOutside] = useState<Map<number, Candidate[]>>(new Map());
	const [shownOutside, setShownOutside] = useState<Set<number>>(new Set());
	useEffect(() => {
		setOutside(new Map());
		const timer = setTimeout(() => {
			const wide = { character, data, spec, filter: { ...EVERYTHING, unknown: true, hiddenItems: filter.hiddenItems } };
			const found = new Map<number, Candidate[]>();
			for (const { index, candidates } of slots) {
				if (!candidates || candidates.some(c => c.delta > 0)) continue;
				const listed = new Set(candidates.map(c => c.item.id));
				const better = slotCandidates(index, gear, wide).filter(c => c.delta > 0 && !listed.has(c.item.id));
				if (better.length) found.set(index, better);
			}
			setOutside(found);
		}, 60);
		return () => clearTimeout(timer);
	}, [slots, gear, character, data, spec, filter.hiddenItems]);

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
	// For a healer, each row says how much of its worth is output and how much is mana.
	const healWeights = spec.role === 'healer' ? spec.weights.stats : undefined;
	const sim = useSim();
	const simEquipped = sim.result(character.gear, SET_ITERATIONS);
	const simPlanned = sim.result(gear, SET_ITERATIONS);
	const hitText = (hit: typeof planned.hit) => `${hit.total.toFixed(1)}% of ${hit.cap}% hit${hit.ratingOver ? `, ${hit.ratingOver} rating over the cap` : ''}`;

	// The slot being read: the bar marks its chip and keeps it in view while the page scrolls.
	const nav = useRef<HTMLElement>(null);
	const [here, setHere] = useState<string | null>(null);
	useEffect(() => {
		let frame = 0;
		const find = () => {
			frame = 0;
			// A slot counts as "here" once its card has reached the lower edge of the sticky bar.
			const edge = (nav.current?.getBoundingClientRect().bottom ?? 0) + 96;
			let current: string | null = null;
			for (const heading of document.querySelectorAll<HTMLElement>('.upgrade-slot h3[id^="slot-"]')) {
				if (heading.closest('.upgrade-slot')!.getBoundingClientRect().top <= edge) current = heading.id.slice(5);
				else break;
			}
			setHere(current);
		};
		const onScroll = () => {
			if (!frame) frame = requestAnimationFrame(find);
		};
		find();
		window.addEventListener('scroll', onScroll, { passive: true });
		window.addEventListener('resize', onScroll);
		return () => {
			window.removeEventListener('scroll', onScroll);
			window.removeEventListener('resize', onScroll);
			if (frame) cancelAnimationFrame(frame);
		};
	}, []);
	useEffect(() => {
		const bar = nav.current;
		const chip = here ? bar?.querySelector<HTMLElement>(`[data-slot="${here}"]`) : null;
		if (!bar || !chip) return;
		// Only the row of chips moves, never the page.
		bar.scrollTo({ left: chip.offsetLeft - bar.offsetLeft - (bar.clientWidth - chip.offsetWidth) / 2, behavior: 'smooth' });
	}, [here]);

	return (
		<div className="upgrades">
			<section className="panel summary" aria-labelledby="upgrades-title">
				<h2 id="upgrades-title">Pick your upgrades</h2>
				<div className="summary-scores">
					<div>
						<span className="field-label">Your plan, estimated</span>
						<span className={`score num ${gain >= 0 ? 'delta-up' : 'delta-down'}`}>{planCount > 0 ? formatDelta(gain) : 'No plan yet'}</span>
						{spec.hitCapPercent > 0 && (
							<span className="summary-hit">
								{hitText(equipped.hit)} now
								{planCount > 0 ? `, ${hitText(planned.hit)} planned` : ''}
							</span>
						)}
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
				{spec.role !== 'healer' && <FightPicker character={character} onChange={onChange} />}
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
				<details className="explain fold">
					<summary>How is this calculated?</summary>
					<p className="hint">
						Every "{unit()}" number in the lists is an estimate: the item's stats times what each stat is worth for {spec.name} (see Stat weights below), plus what the simulator measured for procs, on-use effects and set bonuses. Items marked
						"sim it" have an effect nobody measured and may be better or worse than their number. Each +/- shows how the whole set changes, so hit rating past the cap counts for nothing.
					</p>
					<p className="hint">
						<strong>"Sim this"</strong> next to an item runs the real simulator for that one swap and shows the {unit()} change. "Simulate equipped gear" above does it for your whole set.
					</p>
				</details>
			</section>

			<details className="weights fold">
				<summary>Content: dungeons, reputations, crafting and more</summary>
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

			{fightPicks && (
				<section className="panel fight-picks" aria-label="Items for this fight">
					<h3>Items with a bonus for this fight</h3>
					{fightPicks.length === 0 ? (
						<p className="slot-source">No item you can use has a bonus for what you picked, with the current content choice.</p>
					) : (
						<>
							<p className="slot-source">Every item with a bonus for the enemy, creature or terrain you picked, best first. The number is the estimated change against your current item in that slot; use "Sim this" for items with an effect.</p>
							<ul className="candidates">
								{fightPicks.slice(0, FIGHT_PICKS).map(({ index, candidate }) => (
									<CandidateRow
											healWeights={healWeights}
										key={`${index}-${candidate.item.id}`}
										candidate={candidate}
										note={GEAR_SLOTS[index].label}
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
						</>
					)}
				</section>
			)}

			<div className="filter-chips" role="group" aria-label="What the lists include">
				<span className="field-label">Showing</span>
				{FILTER_CHIPS.map(([key, label]) => (
					<button key={key} className="chip" aria-pressed={filter[key]} title={filter[key] ? `Leave out: ${label}` : `Include: ${label}`} onClick={() => setFilter({ ...filter, [key]: !filter[key] })}>
						{label}
					</button>
				))}
				<span className="slot-source">Dungeons and reputations: under Content above.</span>
			</div>

			<div className="slot-bar">
				<p className="slot-bar-summary">
					<span>
						Plan <strong className={gain >= 0 ? 'num delta-up' : 'num delta-down'}>{planCount > 0 ? formatDelta(gain) : 'none yet'}</strong> <span className="slot-source">estimated</span>
					</span>
					{simEquipped && (
						<span>
							Simulated <strong className="num">{Math.round(simEquipped.dps)}</strong>
							{simPlanned && planCount > 0 && (
								<>
									{' '}
									to <strong className="num">{Math.round(simPlanned.dps)}</strong>
								</>
							)}{' '}
							{unit()}
						</span>
					)}
					{!import.meta.env.VITE_NO_SIM && (
						<button
							className="button button-small"
							disabled={sim.busy}
							onClick={() => {
								sim.run(character.gear, SET_ITERATIONS);
								if (planCount > 0) sim.run(gear, SET_ITERATIONS);
							}}>
							{sim.busy ? 'Simulating…' : simEquipped ? 'Simulate again' : 'Simulate'}
						</button>
					)}
				</p>
			<nav className="slot-nav" aria-label="Jump to a slot" ref={nav}>
				{slots.map(({ slot, index, candidates }) => {
					if (!candidates) return null;
					const best = candidates[0]?.delta ?? 0;
					const isPlanned = character.plan?.[index] !== undefined && character.plan[index] !== character.gear[index]?.id;
					return (
						<a
							key={slot.key}
							href={`#slot-${slot.key}`}
							data-slot={slot.key}
							aria-current={here === slot.key ? 'location' : undefined}
							className={`${isPlanned ? 'slot-chip slot-chip-planned' : best > 0 ? 'slot-chip slot-chip-open' : 'slot-chip'}${here === slot.key ? ' slot-chip-here' : ''}`}
							title={isPlanned ? 'Planned' : best > 0 ? 'An upgrade is available' : 'Nothing better with these filters'}
						>
							{slot.label}
							{best > 0 ? <span className="num delta-up">{formatDelta(best).replace(` ${unit()}`, '')}</span> : isPlanned ? <span className="slot-chip-mark">planned</span> : null}
						</a>
					);
				})}
			</nav>
			</div>
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
				// Random-suffix items take one row of a short list; "Show all" brings every one of them back.
				const better = candidates.filter(c => c.delta > 0);
				const upgradeRows = expanded.has(index) ? { list: better, others: new Map<number, Candidate[]>() } : oneRandomRoll(better);
				const upgrades = better.length;
				const currentPiece = gear[index];
				const currentItemNow = currentPiece ? data.itemById.get(currentPiece.id) : undefined;
				const currentStats = currentItemNow && currentPiece ? pieceStats(currentItemNow, currentPiece, data) : {};
				// What comes next if the planned or worn item stays out of reach: the best items that are not upgrades over it.
				// With something else planned, the worn item is one of them: it is what you fall back to.
				const wornId = character.gear[index]?.id;
				// One row for the best random-suffix item, so the other rows are real alternatives.
				const backups = oneRandomRoll(candidates.filter(c => c.delta <= 0 && (c.item.id === wornId || usableSources(c.item, faction, filter).some(source => sourceKind(source) !== 'unknown'))), wornId);
				const alternatives = backups.list.slice(0, ALTERNATIVES);
				const rowFor = (candidate: Candidate, note?: string) => (
					<CandidateRow
						healWeights={healWeights}
						current={currentStats}
						key={candidate.item.id}
						candidate={candidate}
						note={note}
						marks={marks.get(candidate.item.id)}
						base={gear}
						variant={withItem(gear, index, candidate.item.id, data)}
						data={data}
						faction={faction}
						filter={filter}
						onPlan={() => planItem(index, candidate.item.id)}
						onHide={() => hide(candidate.item)}
					/>
				);
				// Under the one random-suffix row: every other random-suffix item of this slot, a row each.
				const randomFold = (others: Candidate[] | undefined) =>
					others?.length ? (
						<li className="random-rolls">
							<details>
								<summary>
									{others.length} more random-roll item{others.length === 1 ? '' : 's'} for this slot<span className="alternatives-why"> required level 50 to 60, each with its best roll</span>
								</summary>
								<ul className="candidates">{others.map(other => rowFor(other))}</ul>
							</details>
						</li>
					) : null;
				const wornScore = plannedItem
					? scoreSet(
							gear.map((piece, i) => (i === index ? character.gear[index] : piece)),
							character,
							data,
							spec,
						).score
					: planned.score;
				return (
					<section key={slot.key} className="card upgrade-slot" aria-labelledby={`slot-${slot.key}`}>
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
								{upgradeRows.list.slice(0, limit).map(candidate => (
										<Fragment key={candidate.item.id}>
											{rowFor(candidate)}
											{randomFold(upgradeRows.others.get(candidate.item.id))}
										</Fragment>
									))}
								</ul>
						)}
						{(upgrades > SHORT_LIST || upgradeRows.list.length < upgrades) && (
							<button className="link" onClick={() => toggle(index)}>
								{expanded.has(index) ? 'Show fewer' : `Show all ${Math.min(LONG_LIST, upgrades)} upgrades${upgradeRows.list.length < upgrades ? ', every random-suffix item included' : ''}`}
							</button>
						)}
						{outside.has(index) && (
							<div className="outside">
								<p className="outside-note">
									{outside.get(index)!.length} better item{outside.get(index)!.length === 1 ? ' exists' : 's exist'} outside your content choice.{' '}
									<button className="link" onClick={() => setShownOutside(old => new Set(old.has(index) ? [...old].filter(i => i !== index) : [...old, index]))}>
										{shownOutside.has(index) ? 'Hide them' : 'Show them'}
									</button>
								</p>
								{shownOutside.has(index) && (
									<ul className="candidates">
										{outside
											.get(index)!
											.slice(0, ALTERNATIVES)
											.map(candidate => (
												<CandidateRow
											healWeights={healWeights}
													key={candidate.item.id}
													current={currentStats}
													candidate={candidate}
													marks={marks.get(candidate.item.id)}
													base={gear}
													variant={withItem(gear, index, candidate.item.id, data)}
													data={data}
													faction={faction}
													filter={{ ...EVERYTHING, unknown: true }}
													onPlan={() => planItem(index, candidate.item.id)}
													onHide={() => hide(candidate.item)}
												/>
											))}
									</ul>
								)}
							</div>
						)}
						{alternatives.length > 0 && (
							<details className="alternatives" open={Boolean(plannedItem)}>
								<summary>
									Next best {alternatives.length === 1 ? 'alternative' : `${alternatives.length} alternatives`}
									<span className="alternatives-why"> if {plannedItem ? 'the planned item does not drop' : 'you want a backup'}</span>
								</summary>
								<ul className="candidates">
									{alternatives.map(candidate => {
											const overWorn = plannedItem ? scoreSet(withItem(gear, index, candidate.item.id, data), character, data, spec).score - wornScore : undefined;
											return (
												<Fragment key={candidate.item.id}>
													{rowFor(candidate, candidate.item.id === wornId ? 'what you wear now' : overWorn !== undefined ? `${formatDelta(overWorn)} over what you wear` : undefined)}
													{randomFold(backups.others.get(candidate.item.id))}
												</Fragment>
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
			<a className={`quality-${item.quality}`} href={wowheadItemUrl(item.id)} data-wowhead={wowheadData('item', item.id)} target="_blank" rel="noreferrer">
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
	/** The stats of the item in the slot now, to show what changes. */
	current?: Stats;
	/** A healer's stat weights: splits the row's worth into output and mana. */
	healWeights?: Record<string, number>;
	marks?: GuideMark[];
	base: Gear;
	variant: Gear;
	data: GameData;
	faction: 'alliance' | 'horde' | undefined;
	filter: SourceFilter;
	onPlan: () => void;
	onHide: () => void;
}

function CandidateRow({ candidate, note, current, healWeights, marks, base, variant, data, faction, filter, onPlan, onHide }: RowProps) {
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
				{current && statChange(pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data), current) && (
					<span className="stat-diff">Against your item: {statChange(pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data), current)}</span>
				)}
				{current && healWeights && <HealSplit next={pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data)} now={current} weights={healWeights} />}
				{conditionalLines(item, data.fight).map(line => (
					<span key={line.text} className={line.active ? 'slot-versus slot-versus-on' : 'slot-versus'} title={line.active ? 'Counted: it matches the enemy type or terrain you picked.' : 'Not counted. Pick this enemy type or terrain at the top of the page to count it.'}>
						{line.text}
						{line.active ? ' (counted)' : ''}
					</span>
				))}
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

/** "+5 Spell dmg, −7 Int": what changes when `next` replaces `now`; empty if nothing does. */
function statChange(next: Stats, now: Stats): string {
	return STAT_LABELS.filter(([key]) => key !== 'armor' && (next[key] ?? 0) !== (now[key] ?? 0))
		.map(([key, short]) => {
			const change = (next[key] ?? 0) - (now[key] ?? 0);
			return `${change > 0 ? '+' : '−'}${Math.abs(change)} ${short}`;
		})
		.join(', ');
}

const OUTPUT_STATS = ['healingPower', 'critRating', 'hasteRating'];
const MANA_STATS = ['intellect', 'spirit', 'mp5'];

/**
 * For a healer: how much of an item's worth comes from healing more per cast (healing power, crit,
 * haste) and how much from having more mana to cast with (intellect, spirit, MP5). Intellect is
 * filed under mana, though a little of its worth is the crit it gives.
 */
function HealSplit({ next, now, weights }: { next: Stats; now: Stats; weights: Record<string, number> }) {
	const worth = (keys: string[]) => keys.reduce((sum, key) => sum + ((next[key] ?? 0) - (now[key] ?? 0)) * (weights[key] ?? 0), 0);
	const parts = (keys: string[]) =>
		keys
			.filter(key => (next[key] ?? 0) !== (now[key] ?? 0) && weights[key])
			.map(key => `${(next[key] ?? 0) - (now[key] ?? 0) > 0 ? '+' : '−'}${Math.abs((next[key] ?? 0) - (now[key] ?? 0))} ${LONG_LABEL.get(key) ?? key} × ${weights[key]}`)
			.join(', ');
	const output = worth(OUTPUT_STATS);
	const mana = worth(MANA_STATS);
	if (!output && !mana) return null;
	return (
		<span className="heal-split" title={`Output: ${parts(OUTPUT_STATS) || 'no change'}\nMana: ${parts(MANA_STATS) || 'no change'}\nEach number is the stat change times what one point is worth in this healing scenario.`}>
			Of that: <span className={output >= 0 ? 'delta-up' : 'delta-down'}>{formatDelta(output)}</span> from output, <span className={mana >= 0 ? 'delta-up' : 'delta-down'}>{formatDelta(mana)}</span> from mana
		</span>
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
	// A healer's weights have no weapon damage and no hit cap in them.
	const healer = defaults.stats.healingPower !== undefined && !defaults.mainHandDps;
	return (
		<details className="weights fold">
			<summary>
				Stat weights{changed ? ' (changed)' : ''}
				<span className="slot-source">For checking the maths: what one point of each stat is worth</span>
			</summary>
			<p className="hint">
				How much {unit()} one point of each stat is worth. The defaults are the weights of the build, measured with the simulator on its preset gear. Changing them changes every score on the site; the simulated numbers are not affected.
			</p>
			<div className="weights-grid">
				{!healer &&
					field('mainHandDps', 'Weapon DPS', weights.mainHandDps, v => ({
						...weights,
						mainHandDps: v,
					}))}
				{Object.keys(defaults.stats).map(key => field(key, LONG_LABEL.get(key) ?? key, weights.stats[key] ?? 0, v => ({ ...weights, stats: { ...weights.stats, [key]: v } })))}
				{!healer && field('hitRatingOverCap', 'Hit rating past the cap', weights.hitRatingOverCap, v => ({ ...weights, hitRatingOverCap: v }))}
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
