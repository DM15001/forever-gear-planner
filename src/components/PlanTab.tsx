import { estimateCaveats } from '../lib/caveats';
import { MeasuredNote } from './MeasuredNote';
import { useEffect, useMemo, useRef, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { formatDps, unit } from '../lib/format';
import { applicableEnchants } from '../lib/enchants';
import type { GameData } from '../lib/gameData';
import { guideMarks, markLabel } from '../lib/guides';
import { buildPlan, fallbacks, gotEnchant, gotItem, type PlanStep, planSteps } from '../lib/plan';
import { EMPTY_SLOT, EVERYTHING, isUnmeasured, plannedGear, scoreSet, slotInUse, type SourceFilter, usableSources, withItem, isObtainable } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { REFINE_DEPTH, refinePlan } from '../lib/sim/live';
import { wowheadItemUrl, wowheadData } from '../lib/stats';
import type { Character, Item, SpecConfig } from '../lib/types';
import { ContentPicker, useContentOpen } from './ContentPicker';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
import { SourceLabel } from './SourceLabel';
import { ItemPicker } from './ItemPicker';
import { SimSummary, ProgressBar } from './Sim';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
	onFilterChange: (next: SourceFilter) => void;
	onChange: (next: Character) => void;
	/** 'sim': the plan's numbers, the simulation and the content choice. 'list': the planned items and the to-do list. */
	part?: 'all';
}

const formatGain = formatDps;

/** The guided view: pick your content, get one plan, tick it off. */
export function PlanTab({ spec, character, data, filter, onFilterChange, onChange }: Props) {
	const [contentOpen, setContentOpen] = useContentOpen();
	const options = useMemo(() => ({ character, data, spec, filter }), [character, data, spec, filter]);
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const marks = useMemo(() => guideMarks(data.guides), [data]);

	const rebuild = (nextFilter = filter) => onChange({ ...character, ...buildPlan({ character, data, spec, filter: nextFilter }) });

	// A change of the content choice comes back as a new filter (and item data, when sets were switched): then the plan is rebuilt.
	const rebuildAfterChange = useRef(false);
	useEffect(() => {
		if (!rebuildAfterChange.current) return;
		rebuildAfterChange.current = false;
		rebuild(filter);
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter, data]);

	// A character that has never had a plan gets one right away.
	const built = useRef(false);
	useEffect(() => {
		if (!built.current && character.plan === undefined) rebuild();
		built.current = true;
	});

	const gear = useMemo(() => plannedGear(character, data), [character, data]);
	// Checking the plan with the simulator, slot by slot.
	const [refining, setRefining] = useState<string | null>(null);
	const [refineSteps, setRefineSteps] = useState({ done: 0, total: 1 });
	const [refineNote, setRefineNote] = useState<string | null>(null);
	const stopRefine = useRef(false);
	const refine = async () => {
		stopRefine.current = false;
		setRefineNote(null);
		setRefining('Starting the simulator…');
		try {
			const result = await refinePlan(
				{ character, data, spec, filter },
				simClient,
				p => {
					setRefineSteps({ done: p.done, total: p.total });
					setRefining(`${p.slot}, step ${p.done + 1} of ${p.total} (${p.dps.toFixed(0)} ${unit()} so far)`);
				},
				() => stopRefine.current,
			);
			onChange({ ...character, plan: result.plan, planEnchants: result.planEnchants });
			const kept = Object.keys(result.plan).length + Object.keys(result.planEnchants).length === 0;
			const second = result.runnerUp
				? result.runnerUp.equal
					? ` Next best: ${result.runnerUp.label} at ${result.runnerUp.dps.toFixed(0)} ${unit()}. The two are equal within the margin: take whichever is easier to get.`
					: ` Next best: ${result.runnerUp.label} at ${result.runnerUp.dps.toFixed(0)} ${unit()}.`
				: '';
			setRefineNote(
				(kept && result.changes > 0
					? `The simulator found nothing better than what you wear (${result.after.toFixed(0)} ${unit()}; the plan came to ${result.before.toFixed(0)}). The plan is empty now.`
					: result.changes === 0
						? `The simulator agrees with the plan (${result.after.toFixed(0)} ${unit()}): no other start, item, enchant or pair it tried does better.`
						: `The simulator changed the plan in ${result.changes} ${result.changes === 1 ? 'place' : 'places'}: ${result.before.toFixed(0)} to ${result.after.toFixed(0)} ${unit()}${result.startedFrom === 'the plan' ? '' : `, starting from ${result.startedFrom}`}.`) + second,
			);
		} catch (err) {
			setRefineNote(`The check failed: ${err instanceof Error ? err.message : 'the simulator did not answer'}`);
		} finally {
			setRefining(null);
		}
	};
	// The slot whose planned item is being swapped by hand, if any.
	const [picking, setPicking] = useState<number | null>(null);
	const pickItem = (index: number, itemId: number | null) => {
		// A two-hander empties the off hand and the other way round, so more than one slot can change.
		const next = withItem(gear, index, itemId, data, { character, spec });
		const plan = { ...(character.plan ?? {}) };
		next.forEach((piece, slot) => {
			if (piece?.id === gear[slot]?.id) return;
			// Planning what is already worn takes the slot out of the plan.
			if (piece?.id === character.gear[slot]?.id) delete plan[slot];
			else plan[slot] = piece?.id ?? EMPTY_SLOT;
		});
		// A weapon that cannot carry the slot's enchant comes with the best one that fits.
		const enchant = next[index]?.enchant;
		if (itemId !== null && enchant && enchant !== gear[index]?.enchant) {
			onChange({ ...character, plan, planEnchants: { ...character.planEnchants, [index]: enchant } });
			setPicking(null);
			return;
		}
		onChange({ ...character, plan });
		setPicking(null);
	};
	const equipped = useMemo(() => scoreSet(character.gear, character, data, spec), [character, data, spec]);
	const planned = useMemo(() => scoreSet(gear, character, data, spec), [gear, character, data, spec]);
	const steps = useMemo(() => planSteps(options), [options]);
	const openCount = steps.reduce((sum, step) => sum + step.items.length, 0);
	const hasPlan = openCount > 0;

	const slots = useMemo(
		() =>
			GEAR_SLOTS.map((slot, index) => {
				if (!slotInUse(index, spec)) return null;
				const equippedItem = character.gear[index] ? data.itemById.get(character.gear[index]!.id) : undefined;
				const goalPiece = gear[index];
				const goalItem = goalPiece ? data.itemById.get(goalPiece.id) : undefined;
				const goalEnchant = goalPiece?.enchant && goalItem ? applicableEnchants(index, goalItem, data).find(e => e.effectId === goalPiece.enchant) : undefined;
				const isChange = goalItem?.id !== equippedItem?.id;
				// What this one swap is worth: the plan against the plan with this slot as it is worn now.
				const overWorn = isChange ? planned.score - scoreSet(gear.map((piece, i) => (i === index ? character.gear[index] : piece)), character, data, spec).score : 0;
				return { slot, index, equippedItem, goalItem, goalEnchant, overWorn, isChange, enchantOpen: Boolean(goalPiece?.enchant && character.gear[index]?.enchant !== goalPiece.enchant), others: fallbacks(index, options) };
			}).filter(row => row !== null),
		[character, gear, data, spec, options, planned],
	);

	const sourceOf = (item: Item) => {
		const guide = marks.get(item.id)?.find(m => m.source);
		if (guide) return `${guide.source} (per ${guide.guide.label})`;
		return <SourceLabel source={usableSources(item, faction, filter, character.professions)[0] ?? usableSources(item, faction, EVERYTHING)[0]} data={data} item={item} />;
	};

	// What the estimate does not know about this character: said next to it, before anybody wonders.
	const caveats = estimateCaveats(character, spec);
	const staleCount = slots.filter(row => row.isChange && row.goalItem && !isObtainable(row.goalItem, character, faction, filter, spec)).length;

	return (
		<div className="plan">
			{/* First what counts, then the plan and its simulation. */}
			{(
				<details className="content-fold fold" open={contentOpen} onToggle={event => setContentOpen(event.currentTarget.open)}>
					<summary>
						What content do you do?<span className="slot-source">Dungeons, reputations, PvP, crafting and more. The plan is rebuilt on every change.</span>
						<span className="content-fold-toggle">{contentOpen ? 'Hide' : 'Show'}</span>
					</summary>
					<ContentPicker
						spec={spec}
						character={character}
						data={data}
						filter={filter}
						onChange={next => {
							// The plan is rebuilt once the new choice has arrived (see the effect above): rebuilding here would
							// save the character as it was before the change and undo it.
							rebuildAfterChange.current = true;
							onFilterChange(next);
						}}
					/>
				</details>
			)}
			<section className="panel" aria-labelledby="plan-result">
				<h2 id="plan-result">Your plan</h2>
				{(
					<>
				<div className="summary">
					<div className="summary-scores">
						<div>
							<span className="field-label">The plan, estimated</span>
							<span className="score num delta-up">{hasPlan ? formatGain(planned.score - equipped.score) : 'Nothing to change'}</span>
							{spec.hitCapPercent > 0 && (
								<span className="summary-hit">
									{equipped.hit.total.toFixed(1)}% hit now, {planned.hit.total.toFixed(1)}% of {planned.hit.cap}% planned
								</span>
							)}
							{caveats.length > 0 && (
								<span className="summary-hit estimate-caveat" title={`${caveats.join('; ')}.`}>
									less exact for you: {caveats.slice(0, -1).join('; ')}
								</span>
							)}
						</div>
						<div>
							<span className="field-label">Still to do</span>
							<span className="score num">{openCount}</span>
							<span className="summary-hit">{openCount === 1 ? 'change' : 'changes'}</span>
						</div>
					</div>
					<SimSummary equipped={character.gear} planned={gear} hasPlan={hasPlan} auto estimated={hasPlan ? planned.score - equipped.score : undefined} caveats={caveats} />
					{staleCount > 0 && (
						<p className="notice" role="status">
							{staleCount === 1 ? 'One planned item comes' : `${staleCount} planned items come`} from content that is switched off above (marked "not in your content" below). The plan was made before
							that choice. "Rebuild the plan" replaces {staleCount === 1 ? 'it' : 'them'}.
						</p>
					)}
					<div className="actions">
						<button className="button" onClick={() => rebuild()} disabled={refining !== null}>
							Rebuild the plan
						</button>
						{!import.meta.env.VITE_NO_SIM && (
							<button className="button button-primary" onClick={refine} disabled={refining !== null}>
								Check the plan with the simulator
							</button>
						)}
						{refining && (
							<button className="button" onClick={() => (stopRefine.current = true)}>
								Stop
							</button>
						)}
					</div>
					{refining && <ProgressBar done={refineSteps.done} total={refineSteps.total} label={`Checking the plan: ${refining}`} />}
					{character.planTier && character.planTier.asked > 0 && (
						<p className={character.planTier.count < character.planTier.asked ? 'notice notice-error' : 'notice'} role="status">
							{character.planTier.count < character.planTier.asked
								? `You asked for at least ${character.planTier.asked} set pieces, but only ${character.planTier.count} fit the slots you ticked and the content you chose.`
								: `Built with at least ${character.planTier.asked} set pieces as you asked: ${character.planTier.count} are in the plan.`}{' '}
							{character.planTier.cost >= 0.05 ? `That costs ${formatGain(-character.planTier.cost)} against the free choice (estimated).` : 'That costs nothing against the free choice.'}
						</p>
					)}
					{refineNote && (
						<p className="refine-note" role="status">
							{refineNote}
						</p>
					)}
					<p className="hint">
						"Check the plan with the simulator" looks for the best set with the real simulator. It first runs your plan, the guides' sets and your worn gear against each other and goes on from the best. Then
						it tries the {REFINE_DEPTH} best-scored items of every slot (twice when the first round changed something), the enchants, and pairs of slots changed together (both rings, both trinkets, both hands, slots that trade hit rating). Every
						candidate gets a short run first and a longer one only when it is close, and the winner and the runner-up get a long run at the end. It keeps a change only when the {unit()} really goes up,
						never ends below what you wear, and takes several minutes.
					</p>
					<p className="hint">
						The estimate is stats times the build's stat weights, in {unit()}, plus what the simulator measured for procs, on-use effects, proc enchants and set bonuses. To change a
						single slot by hand, click its icon.
					</p>
				</div>
					</>
				)}

				{(
					<>
				<MeasuredNote specId={spec.id} />
				<ul className="plain-list plan-slots">
					{slots.map(({ slot, index, equippedItem, goalItem, goalEnchant, isChange, overWorn, enchantOpen, others }) => (
						<li key={slot.key} className={`plan-slot${isChange ? '' : ' plan-slot-done'}`}>
							<button className="slot-button" onClick={() => setPicking(index)} title={`Change the planned ${slot.label.toLowerCase()} item`} aria-label={`Change the planned ${slot.label.toLowerCase()} item`}>
								<ItemIcon icon={goalItem?.icon} quality={goalItem?.quality} small />
							</button>
							<div className="plan-slot-body">
								<span className="slot-label">
									{slot.label}
									<button className="link slot-change" onClick={() => setPicking(index)}>
										Change
									</button>
								</span>
								{goalItem ? (
									<span className="plan-goal">
										<ItemLink item={goalItem} />
										{isChange && <SuffixNote item={goalItem} />}
										{marks.get(goalItem.id)?.map(mark => (
											<span key={mark.guide.id} className="badge badge-guide">
												{markLabel(mark)}
											</span>
										))}
										{isChange && !isObtainable(goalItem, character, faction, filter, spec) && (
											<span className="badge badge-stale" title="This item comes from content you have switched off above, or you hid it. It is still here because it was planned before. 'Rebuild the plan' replaces it.">
												not in your content
											</span>
										)}
										{isUnmeasured(goalItem, data) && (
											<span className="badge" title="Part of this item's worth is not in the score. Use Simulate above to check it.">
												sim it
											</span>
										)}
									</span>
								) : (
									<span className="plan-goal plan-empty">Nothing to wear here</span>
								)}
								{goalItem && (
									<span className="slot-source">
										{isChange ? sourceOf(goalItem) : 'You have it'}
										{isChange && equippedItem && `, replaces ${equippedItem.name}`}
										{isChange && equippedItem && <span className={`num ${overWorn >= 0 ? 'delta-up' : 'delta-down'}`}> ({formatDps(overWorn)} over it)</span>}
									</span>
								)}
								{goalEnchant && (
									<span className={enchantOpen ? 'plan-enchant plan-enchant-open' : 'plan-enchant'}>
										{goalEnchant.name}
										<span className="plan-enchant-state">{enchantOpen ? 'enchant to get' : 'enchant, you have it'}</span>
									</span>
								)}
								{isChange && others.length > 0 && (
									<span className="slot-source plan-others">
										Otherwise:{' '}
										{others.map((c, i) => (
											<span key={c.item.id}>
												{i > 0 && ', '}
												<ItemIcon icon={c.item.icon} quality={c.item.quality} inline />
												<ItemLink item={c.item} /> ({formatGain(c.delta)}, {sourceOf(c.item)})
											</span>
										))}
									</span>
								)}
							</div>
						</li>
					))}
				</ul>
				{picking !== null && <ItemPicker slotIndex={picking} gear={gear} character={character} data={data} spec={spec} filter={filter} onPick={id => pickItem(picking, id)} onEnchant={effectId => { onChange({ ...character, planEnchants: { ...(character.planEnchants ?? {}), [picking]: effectId ?? 0 } }); setPicking(null); }} onClose={() => setPicking(null)} />}
					</>
				)}
			</section>

			{(
			<section className="panel" aria-labelledby="plan-todo">
				<h2 id="plan-todo">To do, biggest gain first</h2>
				{steps.length === 0 ? (
					<p className="farm-empty">Nothing left to do with the content you picked. Switch more content on above to see what else there is.</p>
				) : (
					<ol className="plain-list todo">
						{steps.map(step => (
							<TodoStep key={step.key} step={step} onGotItem={slotIndex => onChange(gotItem(character, slotIndex))} onGotEnchant={slotIndex => onChange(gotEnchant(character, slotIndex))} />
						))}
					</ol>
				)}
			</section>
			)}
		</div>
	);
}

function ItemLink({ item }: { item: Item }) {
	return (
		<a className={`item-link quality-${item.quality}`} href={wowheadItemUrl(item.id)} data-wowhead={wowheadData('item', item.id)} target="_blank" rel="noreferrer">
			{item.name}
			{suffixText(item)}
		</a>
	);
}

function TodoStep({ step, onGotItem, onGotEnchant }: { step: PlanStep; onGotItem: (slotIndex: number) => void; onGotEnchant: (slotIndex: number) => void }) {
	return (
		<li className="todo-step">
			<div className="todo-head">
				<h3>{step.title}</h3>
				<span className="num delta-up">{formatGain(step.gain)}</span>
			</div>
			<ul className="plain-list">
				{step.items.map(entry => (
					<li key={`${entry.slotIndex}-${entry.enchant?.effectId ?? entry.item?.id}`} className="todo-item">
						<span className="todo-main">
							{entry.enchant ? <span className="todo-enchant">{entry.enchant.name}</span> : entry.item && <ItemLink item={entry.item} />}
							<span className="slot-source">
								{GEAR_SLOTS[entry.slotIndex].label}
								{entry.enchant && entry.item ? ` (${entry.item.name})` : ''}, {entry.detail}
								{entry.effort && <span className="effort"> {entry.effort}</span>}
							</span>
						</span>
						<span className={`num ${entry.gain >= 0 ? 'delta-up' : 'delta-down'}`}>{formatGain(entry.gain)}</span>
						<button
							className="button button-small"
							disabled={!entry.ready}
							title={entry.ready ? undefined : 'Get the item first'}
							onClick={() => (entry.enchant ? onGotEnchant(entry.slotIndex) : onGotItem(entry.slotIndex))}>
							Got it
						</button>
					</li>
				))}
			</ul>
		</li>
	);
}
