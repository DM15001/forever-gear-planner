import type { CSSProperties } from 'react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { sourceKind } from '../lib/farm';
import { FightPicker } from './FightPicker';
import { formatDps, unit } from '../lib/format';
import type { GameData } from '../lib/gameData';
import { type Guide, type GuideMark, guideMarks, guidePlan, markLabel, swapDelta } from '../lib/guides';
import { applicableEnchants } from '../lib/enchants';
import { EVERYTHING, type Candidate, clash, type Gear, oneRandomRoll, pairedSlot, plannedGear, scoreSet, setChanges, setStandings, slotCandidates, slotInUse, type SourceFilter, usableSources, withItem } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { measureWeights, weightRuns } from '../lib/sim/live';
import { conditionalLines, matchesFight, pieceStats, STAT_LABELS, statLine, wowheadItemUrl, wowheadData } from '../lib/stats';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
import { SourceLabel, SourceList } from './SourceLabel';
import { MeasuredNote } from './MeasuredNote';
import { SET_ITERATIONS, SimDelta, SWAP_ITERATIONS, useSim } from './Sim';
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
	/** 'sim': content, stat weights and the simulation. 'list': the possible upgrades per slot. */
	part: 'tools' | 'list';
	/** The tools sit inside another panel (on trial on Dev: inside "Your plan"): no frame, no heading, no second count of the plan. */
	embedded?: boolean;
	/** Opens the page with the planned items and the lists. */
	onShowList?: () => void;
}

/** How many items the list for a picked enemy or terrain shows. */
const FIGHT_PICKS = 12;
const SHORT_LIST = 6;
/** One plain picture per kind of slot, the same for everybody: the bar names slots, it does not show your items. */
const SLOT_ICONS: Record<string, string> = {
	head: 'inv_helmet_03',
	neck: 'inv_jewelry_necklace_01',
	shoulder: 'inv_shoulder_02',
	back: 'inv_misc_cape_02',
	chest: 'inv_chest_chain',
	wrist: 'inv_bracer_02',
	hands: 'inv_gauntlets_04',
	waist: 'inv_belt_03',
	legs: 'inv_pants_02',
	feet: 'inv_boots_05',
	finger: 'inv_jewelry_ring_03',
	trinket: 'inv_jewelry_talisman_01',
	weapon: 'inv_sword_04',
	ranged: 'inv_weapon_bow_02',
};

/** How many of a slot's best upgrades "Check the top with the simulator" runs. */
const VERIFY_TOP = 5;
/** How many next-best items a slot lists below its upgrades. */
const ALTERNATIVES = 5;
const LONG_LIST = 25;

/** The layout of 26 Nov (first tried on Dev). */
const NEW_LAYOUT = true;

export function UpgradesTab({ spec, character, data, onChange, filter, onFilterChange: setFilter, defaultWeights, onWeightsChange, part, onShowList, embedded = false }: Props) {
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
		// The layout of 26 Nov (first tried on Dev), where Customize comes before the simulator check: an item picked by hand is locked, so the check builds around it.
		const picked = NEW_LAYOUT ? [...new Set([...(character.planLocks ?? []), index])] : character.planLocks;
		// A ring or trinket that excludes the planned one in the other slot takes its place.
		const other = pairedSlot(index);
		if (other !== undefined && next[other] !== undefined && clash(data.itemById.get(itemId), data.itemById.get(next[other]))) delete next[other];
		// A weapon that cannot carry the slot's enchant is planned with the best one that fits, as the list counted it.
		const enchant = withItem(gear, index, itemId, data, { character, spec })[index]?.enchant;
		if (enchant && enchant !== gear[index]?.enchant) {
			setGuideNotice(null);
			setUndo(null);
			onChange({ ...character, plan: next, planEnchants: { ...character.planEnchants, [index]: enchant }, planLocks: picked });
			return;
		}
		if (NEW_LAYOUT) {
			setGuideNotice(null);
			setUndo(null);
			onChange({ ...character, plan: next, planLocks: picked });
			return;
		}
		setPlan(next);
	};
	/** True if the item cannot go into the slot because of what is worn in the other ring or trinket slot. */
	const blocked = (index: number, itemId: number) => {
		const other = pairedSlot(index);
		return other !== undefined && character.plan?.[other] === undefined && clash(data.itemById.get(itemId), data.itemById.get(character.gear[other]?.id ?? -1));
	};
	/** Hides the planned item: out of the plan and out of every list, in one step, with a way back. */
	const hidePlanned = (index: number, item: Item) => {
		const { [index]: _removed, ...rest } = character.plan ?? {};
		const before = character;
		setGuideNotice(null);
		setUndo({ label: `${item.name} hidden and taken out of the plan`, back: () => onChange(before) });
		// The content choice lives on the character, so plan and hidden list change together.
		onChange({ ...character, plan: rest, content: { ...filter, hiddenItems: [...filter.hiddenItems, item.id] } });
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
			{part === 'tools' && (
				<>
			<WeightsEditor
				weights={spec.weights}
				defaults={defaultWeights}
				onChange={onWeightsChange}
				runs={weightRuns({ ...spec, weights: defaultWeights })}
				measuring={measuring}
				measureError={measureError}
				onMeasure={import.meta.env.VITE_NO_SIM ? undefined : measure}
			/>

			<section className={embedded ? 'summary plan-tools' : 'panel summary'} aria-label="Other ways to fill the plan">
				{!embedded && <h2 id="upgrades-title">Other ways to fill the plan</h2>}
				<div className="actions">
					<button className="button" onClick={() => setPlan({}, 'Plan cleared')} disabled={planCount === 0}>
						Clear plan{planCount > 0 ? ` (${planCount})` : ''}
					</button>
				</div>
				{planCount > 0 && !embedded && (
					<p className="plan-done" role="status">
						{planCount === 1 ? 'One slot is' : `${planCount} slots are`} planned, {formatDelta(gain)} over your equipped gear.{' '}
						{onShowList && (
							<button className="link" onClick={onShowList}>
								Show the planned items
							</button>
						)}
					</p>
				)}
				<p className="hidden-note">
					Too expensive, or you just do not want it? "Hide" next to an item leaves it out of every list and out of "Rebuild the plan".
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
				</>
			)}

			{part === 'list' && (
				<>
			<MeasuredNote specId={spec.id} />
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
										variant={withItem(gear, index, candidate.item.id, data, { character, spec })}
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

			<SetStatus worn={character.gear} planned={gear} data={data} />
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
			<nav className={NEW_LAYOUT ? 'slot-nav slot-strip' : 'slot-nav'} style={NEW_LAYOUT ? ({ '--slots': slots.filter(row => row.candidates).length } as CSSProperties) : undefined} aria-label="Jump to a slot" ref={nav}>
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
							{NEW_LAYOUT ? (
								<>
									{isPlanned && (
										<b className="slot-chip-check" aria-hidden="true">
											✓
										</b>
									)}
									<ItemIcon icon={data.itemById.get(character.plan?.[index] ?? character.gear[index]?.id ?? -1)?.icon ?? SLOT_ICONS[slot.kind]} quality={data.itemById.get(character.plan?.[index] ?? character.gear[index]?.id ?? -1)?.quality} />
									<strong>{slot.label}</strong>
									<span className="slot-chip-state">{isPlanned ? 'planned' : best > 0 ? <span className="num">{formatDelta(best).replace(` ${unit()}`, '')} open</span> : 'best worn'}</span>
								</>
							) : (
								<>
							<ItemIcon icon={SLOT_ICONS[slot.kind]} quality={undefined} inline />
							<strong>{slot.label}</strong>
							{best > 0 ? <span className="num delta-up">{formatDelta(best).replace(` ${unit()}`, '')}</span> : isPlanned ? <span className="slot-chip-mark">planned</span> : null}
								</>
							)}
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
				// The first few can be checked with the real simulator in one go; once all are in, they are sorted by it.
				const top = upgradeRows.list.slice(0, VERIFY_TOP);
				const baseSim = sim.result(gear, SWAP_ITERATIONS);
				const simOf = (candidate: Candidate) => sim.result(withItem(gear, index, candidate.item.id, data, { character, spec }), SWAP_ITERATIONS);
				const verified = Boolean(baseSim) && top.length > 1 && top.every(candidate => simOf(candidate));
				const checking = !verified && top.some(candidate => sim.isRunning(withItem(gear, index, candidate.item.id, data, { character, spec }), SWAP_ITERATIONS));
				const shownUpgrades = verified ? [...[...top].sort((a, b) => simOf(b)!.dps - simOf(a)!.dps), ...upgradeRows.list.slice(VERIFY_TOP)] : upgradeRows.list;
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
						variant={withItem(gear, index, candidate.item.id, data, { character, spec })}
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
// The enchant this slot ends up with: the planned one if there is a plan for it, else the one worn.
const slotPiece = gear[index];
const slotItem = slotPiece ? data.itemById.get(slotPiece.id) : undefined;
const slotEnchantFound = slotPiece?.enchant && slotItem ? applicableEnchants(index, slotItem, data).find(e => e.effectId === slotPiece.enchant) : undefined;
const slotEnchant = slotEnchantFound ? { name: slotEnchantFound.name, open: character.gear[index]?.enchant !== slotEnchantFound.effectId || character.gear[index]?.id !== slotPiece?.id } : undefined;
				const wornScore = plannedItem
					? scoreSet(
							gear.map((piece, i) => (i === index ? character.gear[index] : piece)),
							character,
							data,
							spec,
						).score
					: planned.score;
				return (
					<section key={slot.key} className={NEW_LAYOUT ? 'panel upgrade-slot' : 'card upgrade-slot'} aria-labelledby={`slot-${slot.key}`}>
						<header className="upgrade-head">
							<h3 id={`slot-${slot.key}`}>{slot.label}</h3>
							<p className="upgrade-current">
								{plannedItem ? (
									<>
										<ItemName item={plannedItem} icon /> planned ({plannedSource(plannedItem)}), replacing {equippedItem ? <ItemName item={equippedItem} icon worn /> : 'an empty slot'}{' '}
										<span className={`num ${planned.score - wornScore >= 0 ? 'delta-up' : 'delta-down'}`} title="What this one swap is worth: your plan against the same plan with the worn item in this slot.">({formatDelta(planned.score - wornScore)} over it)</span>{' '}
										<button className="link" onClick={() => unplan(index)}>
											Undo
										</button>{' '}
										<button className="link hide-item" onClick={() => hidePlanned(index, plannedItem)} title="Takes it out of the plan and leaves it out of every list and out of 'Rebuild the plan'. Bring it back under 'What content do you do?', at the bottom.">
											Hide
										</button>
									</>
								) : equippedItem ? (
									<>
										<ItemName item={equippedItem} icon worn /> equipped{' '}
										{!filter.hiddenItems.includes(equippedItem.id) && (
											<button className="link hide-item" onClick={() => hide(equippedItem)} title="You keep wearing it, but it is left out of the lists, the guide picks and 'Rebuild the plan': for an item you are about to replace anyway.">
												Hide
											</button>
										)}
									</>
								) : (
									'Empty'
								)}
								<span className="upgrade-count">{upgrades === 0 ? 'Nothing better with these filters' : `${upgrades} upgrade${upgrades === 1 ? '' : 's'}`}</span>
							</p>
							{slotEnchant && (
								<p className={slotEnchant.open ? 'plan-enchant plan-enchant-open' : 'plan-enchant'}>
									{slotEnchant.name}
									<span className="plan-enchant-state">{slotEnchant.open ? 'enchant to get' : 'enchant, you have it'}</span>
								</p>
							)}
						</header>
						<GuidePicks
							guides={data.guides}
							slotIndex={index}
							data={data}
							currentId={gear[index]?.id}
							deltaOf={itemId => swapDelta(index, itemId, gear, character, data, spec)}
							onPlan={itemId => planItem(index, itemId)}
							hidden={filter.hiddenItems}
							onHide={hide}
							blocked={itemId => blocked(index, itemId)}
							otherId={pairedSlot(index) !== undefined ? gear[pairedSlot(index)!]?.id : undefined}
						/>
						{upgrades > 1 && (
							<p className="verify-line">
								{verified ? (
									<span className="verify-done">The top {top.length} are checked with the simulator and sorted by it.</span>
								) : (
									<button
										className="button button-small"
										disabled={checking}
										title="Runs the real simulator for each of them against your current gear, then sorts them by the result."
										onClick={() => {
											if (!baseSim) sim.run(gear, SWAP_ITERATIONS);
											for (const candidate of top) if (!simOf(candidate)) sim.run(withItem(gear, index, candidate.item.id, data, { character, spec }), SWAP_ITERATIONS);
										}}>
										{checking ? 'Checking…' : `Check the top ${top.length} with the simulator`}
									</button>
								)}
							</p>
						)}
						{upgrades > 0 && (
							<ul className="candidates">
								{shownUpgrades.slice(0, limit).map(candidate => (
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
													variant={withItem(gear, index, candidate.item.id, data, { character, spec })}
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
											const overWorn = plannedItem ? scoreSet(withItem(gear, index, candidate.item.id, data, { character, spec }), character, data, spec).score - wornScore : undefined;
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
				</>
			)}
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

/** For a set piece: how many pieces the set would have, what its bonuses are worth for this build, and whether one is in the row's number. */
function setOutlook(setId: number | undefined, base: Gear, variant: Gear, data: GameData): string | null {
	const standing = setId ? setStandings(variant, data).get(setId) : undefined;
	if (!standing) return null;
	const worn = `${standing.name}: ${standing.count} piece${standing.count === 1 ? '' : 's'} with this item`;
	if (standing.ignored) return `${worn}. You switched its set bonuses off, so the number is the item alone.`;
	if (!standing.measured) return `${worn}. Its set bonuses are not measured for this build, so the number is the item alone.`;
	if (standing.steps.length === 0) return `${worn}. Its set bonuses do nothing for this build, so the number is the item alone.`;
	const byCount = data.simValues.sets.get(standing.setId)!;
	const bonuses = standing.steps.map(step => `${step} pieces ${formatDelta(byCount.get(step)!)}`).join(', ');
	const next = standing.steps.find(step => step > standing.count);
	const before = setStandings(base, data).get(standing.setId)?.reached ?? 0;
	const missing = next ? next - standing.count : 0;
	const toNext = next ? `; ${missing} more piece${missing === 1 ? '' : 's'} for the ${next}-piece bonus` : '';
	const state =
		standing.reached > before
			? `This item completes the ${standing.reached}-piece bonus, and the number counts it.`
			: standing.reached < before
				? ''
				: standing.reached > 0
					? `You keep the ${standing.reached}-piece bonus${toNext}.`
					: `The number is the item alone${toNext}.`;
	return `${worn}. Set bonuses for this build, in total: ${bonuses}. ${state}`.trim();
}

/** A line of stats with the caster stats told apart: spell damage and healing each in their own colour. */
function StatText({ text }: { text: string }) {
	return (
		<>
			{text.split(', ').map((part, index) => (
				<span key={index}>
					{index > 0 && ', '}
					<span className={/healing/i.test(part) ? 'stat-healing' : /spell (dmg|damage)|spell power/i.test(part) ? 'stat-spell' : undefined}>{part}</span>
				</span>
			))}
		</>
	);
}

/** A stat comparison with what you gain in green and what you lose in red. */
function DiffText({ text }: { text: string }) {
	return (
		<>
			{text.split(', ').map((part, index) => (
				<span key={index}>
					{index > 0 && <span className="diff-sep">, </span>}
					<span className={`diff-part ${/^[-−–]/.test(part) ? 'diff-down' : 'diff-up'}${/healing/i.test(part) ? ' diff-healing' : /spell (dmg|damage)|spell power/i.test(part) ? ' diff-spell' : ''}`}>{part}</span>
				</span>
			))}
		</>
	);
}

function CandidateRow({ candidate, note, current, healWeights, marks, base, variant, data, faction, filter, onPlan, onHide }: RowProps) {
	const { item, delta, incomplete } = candidate;
	const sets = setChanges(base, variant, data);
	const setLine = setOutlook(item.setId, base, variant, data);
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
		<li className={`candidate candidate-${item.quality ?? 'common'}`}>
			<span className={`candidate-delta num ${delta > 0 ? 'delta-up' : 'delta-down'}`} title={NEW_LAYOUT ? [stats, current ? `Against your item: ${statChange(pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data), current)}` : ''].filter(Boolean).join('\n') || undefined : undefined}>
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
				<span className={current ? 'slot-stats slot-stats-compared' : 'slot-stats'} title={stats || undefined}>
					{item.weapon?.dps ? `${item.weapon.dps.toFixed(1)} DPS, ${item.weapon.speed?.toFixed(2)} speed${stats ? ', ' : ''}` : ''}
					{stats ? <StatText text={stats} /> : item.weapon?.dps ? '' : 'No stats'}
				</span>
				{current && statChange(pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data), current) && (
					<span className="stat-diff">
						<span className="stat-diff-label">Against your item: </span>
						<DiffText text={statChange(pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data), current)} />
					</span>
				)}
				{current && healWeights && <HealSplit next={pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data)} now={current} weights={healWeights} />}
				{conditionalLines(item, data.fight).map(line => (
					<span key={line.text} className={line.active ? 'slot-versus slot-versus-on' : 'slot-versus'} title={line.active ? 'Counted: it matches the enemy type or terrain you picked.' : 'Not counted. Pick this enemy type or terrain at the top of the page to count it.'}>
						{line.text}
						{line.active ? ' (counted)' : ''}
					</span>
				))}
				{setLine && <span className="set-outlook">{setLine}</span>}
				{sets.map(change => (
					<span key={change.name + change.kind} className={`set-change set-change-${change.kind}`}>
						{change.kind === 'breaks' && `Breaks the ${change.step}-piece bonus of ${change.name} (${change.before} → ${change.after} pieces): ${formatDelta(change.worth)}, already in the number.`}
						{change.kind === 'activates' && `Activates the ${change.step}-piece bonus of ${change.name} (${change.before} → ${change.after} pieces): ${formatDelta(change.worth)}, already in the number.`}
						{change.kind === 'loosens' && `Takes a piece out of ${change.name} (${change.before} → ${change.after}). Its set bonuses are not measured for this build, so they are not in the number: sim it.`}
					</span>
				))}
				<span className="slot-source">
					{guideSource(marks) ?? <SourceList sources={sources} data={data} item={candidate.item} />}
					{!guideSource(marks) && sources.length > 2 ? `, +${sources.length - 2} more` : ''}
				</span>
			</span>
			<span className="candidate-actions">
				<SimDelta base={base} variant={variant} />
				<button className="button button-small button-plan" onClick={onPlan}>
					Plan
				</button>
				<button className="link hide-item" onClick={onHide} title="Leave this item out of every list and out of 'Rebuild the plan', for example because it is too expensive or not in the game yet. Bring it back under Plan, Content.">
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
	/** Items the user has hidden: they are not shown as picks either. */
	hidden: number[];
	onHide: (item: Item) => void;
}

/** What the guides pick for this slot, whatever the filters say. */
function GuidePicks({ guides, slotIndex, data, currentId, deltaOf, onPlan, blocked, otherId, hidden, onHide }: GuidePicksProps) {
	const kind = GEAR_SLOTS[slotIndex].kind;
	const rows = guides
		.map(guide => ({
			guide,
			entries: guide.entries.filter(e => (guide.fixedSet ? e.slotIndex === slotIndex : e.slot === kind) && !hidden.includes(e.itemId)),
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
									)}{' '}
									<button className="link hide-item guide-hide" onClick={() => onHide(item)} title="Leaves this item out of every list, the guide picks and 'Rebuild the plan'. Bring it back under 'What content do you do?', at the bottom.">
										Hide
									</button>
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

/** The item sets in the worn and the planned gear, and a warning when the plan gives up a bonus the worn gear has. */
function SetStatus({ worn, planned, data }: { worn: Gear; planned: Gear; data: GameData }) {
	const now = setStandings(worn, data);
	const then = setStandings(planned, data);
	const rows = [...new Set([...now.keys(), ...then.keys()])]
		.map(setId => ({ was: now.get(setId), will: then.get(setId) }))
		.filter(({ was, will }) => Math.max(was?.count ?? 0, will?.count ?? 0) >= 2);
	if (rows.length === 0) return null;
	const samePlan = worn.every((piece, i) => piece?.id === planned[i]?.id);
	return (
		<section className="panel set-status" aria-label="Set bonuses">
			<h3>Set bonuses</h3>
			<ul className="plain-list">
				{rows.map(({ was, will }) => {
					const set = (will ?? was)!;
					const broken = (was?.reached ?? 0) > (will?.reached ?? 0);
					const steps = set.steps.length ? set.steps.map(step => `${step}`).join(', ') : undefined;
					return (
						<li key={set.setId} className={broken ? 'set-row set-row-broken' : 'set-row'}>
							<strong>{set.name}</strong>: {samePlan ? `${was?.count ?? 0} pieces worn` : `${was?.count ?? 0} worn, ${will?.count ?? 0} planned`}.{' '}
							{set.ignored
								? 'You switched its bonus off under Content, so the lists do not count it.'
								: !set.measured
									? 'Bonuses not measured for this build yet, so the lists do not count them.'
								: !steps
									? 'Its bonuses are worth nothing measurable for this build.'
									: (will?.reached ?? 0) > 0
										? `${will!.reached}-piece bonus active (${formatDelta(will!.worth)}). Bonuses that count for this build at: ${steps} pieces.`
										: `No bonus active. Bonuses that count for this build at: ${steps} pieces.`}
							{broken && ` Your plan gives up the ${was!.reached}-piece bonus you have now (${formatDelta((will?.worth ?? 0) - was!.worth)}); the numbers below already include that.`}
						</li>
					);
				})}
			</ul>
		</section>
	);
}
