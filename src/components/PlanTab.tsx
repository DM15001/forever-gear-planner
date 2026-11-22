import { useEffect, useMemo, useRef, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { formatDps } from '../lib/format';
import { applicableEnchants } from '../lib/enchants';
import type { GameData } from '../lib/gameData';
import { guideMarks, markLabel } from '../lib/guides';
import { buildPlan, fallbacks, gotEnchant, gotItem, type PlanStep, planSteps } from '../lib/plan';
import { EMPTY_SLOT, EVERYTHING, isUnmeasured, plannedGear, scoreSet, slotInUse, type SourceFilter, usableSources, withItem } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { REFINE_DEPTH, refinePlan } from '../lib/sim/live';
import { wowheadItemUrl } from '../lib/stats';
import type { Character, Item, SpecConfig } from '../lib/types';
import { ContentPicker } from './ContentPicker';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
import { SourceLabel } from './SourceLabel';
import { ItemPicker } from './ItemPicker';
import { SimSummary } from './Sim';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
	onFilterChange: (next: SourceFilter) => void;
	onChange: (next: Character) => void;
}

const formatGain = formatDps;

/** The guided view: pick your content, get one plan, tick it off. */
export function PlanTab({ spec, character, data, filter, onFilterChange, onChange }: Props) {
	const options = useMemo(() => ({ character, data, spec, filter }), [character, data, spec, filter]);
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const marks = useMemo(() => guideMarks(data.guides), [data]);

	const rebuild = (nextFilter = filter) => onChange({ ...character, ...buildPlan({ character, data, spec, filter: nextFilter }) });

	// A character that has never had a plan gets one right away.
	const built = useRef(false);
	useEffect(() => {
		if (!built.current && character.plan === undefined) rebuild();
		built.current = true;
	});

	const gear = useMemo(() => plannedGear(character, data), [character, data]);
	// Checking the plan with the simulator, slot by slot.
	const [refining, setRefining] = useState<string | null>(null);
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
				p => setRefining(`${p.slot}, slot ${p.done + 1} of ${p.total} (${p.dps.toFixed(0)} DPS so far)`),
				() => stopRefine.current,
			);
			onChange({ ...character, plan: result.plan });
			setRefineNote(
				result.changes === 0
					? `The simulator agrees with the plan: none of the ${REFINE_DEPTH} best-scored items per slot does better (${result.before.toFixed(0)} DPS).`
					: `The simulator changed ${result.changes} ${result.changes === 1 ? 'slot' : 'slots'}: ${result.before.toFixed(0)} to ${result.after.toFixed(0)} DPS.`,
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
		const next = withItem(gear, index, itemId, data);
		const plan = { ...(character.plan ?? {}) };
		next.forEach((piece, slot) => {
			if (piece?.id === gear[slot]?.id) return;
			// Planning what is already worn takes the slot out of the plan.
			if (piece?.id === character.gear[slot]?.id) delete plan[slot];
			else plan[slot] = piece?.id ?? EMPTY_SLOT;
		});
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
				return { slot, index, equippedItem, goalItem, goalEnchant, isChange: goalItem?.id !== equippedItem?.id, enchantOpen: Boolean(goalPiece?.enchant && character.gear[index]?.enchant !== goalPiece.enchant), others: fallbacks(index, options) };
			}).filter(row => row !== null),
		[character, gear, data, spec, options],
	);

	const sourceOf = (item: Item) => {
		const guide = marks.get(item.id)?.find(m => m.source);
		if (guide) return `${guide.source} (per ${guide.guide.label})`;
		return <SourceLabel source={usableSources(item, faction, filter, character.professions)[0] ?? usableSources(item, faction, EVERYTHING)[0]} data={data} />;
	};

	return (
		<div className="plan">
			<section aria-labelledby="plan-result">
				<h2 id="plan-result">Your plan</h2>
				<div className="panel summary">
					<div className="summary-scores">
						<div>
							<span className="field-label">The plan, estimated</span>
							<span className="score num delta-up">{hasPlan ? formatGain(planned.score - equipped.score) : 'Nothing to change'}</span>
							<span className="summary-hit">
								{equipped.hit.total.toFixed(1)}% hit now, {planned.hit.total.toFixed(1)}% of {planned.hit.cap}% planned
							</span>
						</div>
						<div>
							<span className="field-label">Still to do</span>
							<span className="score num">{openCount}</span>
							<span className="summary-hit">{openCount === 1 ? 'change' : 'changes'}</span>
						</div>
					</div>
					<SimSummary equipped={character.gear} planned={gear} hasPlan={hasPlan} auto />
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
					{refining && (
						<p className="hint" role="status">
							Simulating: {refining}
						</p>
					)}
					{refineNote && (
						<p className="refine-note" role="status">
							{refineNote}
						</p>
					)}
					<p className="hint">
						"Check the plan with the simulator" runs the {REFINE_DEPTH} best-scored items of every slot through the real simulator and keeps the one with the highest DPS. Use it when procs, on-use
						trinkets or set bonuses matter, which the quick score only knows for the Enhancement Shaman. It takes a few minutes.
					</p>
					<p className="hint">
						The estimate is stats times the build's stat weights, in DPS, plus what the simulator measured for procs, on-use effects, proc enchants and set bonuses. To change a
						single slot by hand, click its icon.
					</p>
				</div>
				<details className="content-fold">
					<summary>
						What content do you do?<span className="slot-source">Dungeons, reputations, PvP, crafting and more. The plan is rebuilt on every change.</span>
					</summary>
					<ContentPicker
						spec={spec}
						character={character}
						data={data}
						filter={filter}
						onChange={next => {
							onFilterChange(next);
							rebuild(next);
						}}
					/>
				</details>

				<ul className="plain-list plan-slots">
					{slots.map(({ slot, index, equippedItem, goalItem, goalEnchant, isChange, enchantOpen, others }) => (
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
										{isUnmeasured(goalItem, data) && (
											<span className="badge" title="Part of this item's worth is not in the score. Use Sim on the Upgrades tab to check it.">
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
									</span>
								)}
								{goalEnchant && (
									<span className="slot-source">
										Enchant: {goalEnchant.name}
										{enchantOpen ? '' : ' (done)'}
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
				{picking !== null && <ItemPicker slotIndex={picking} gear={gear} character={character} data={data} spec={spec} filter={filter} onPick={id => pickItem(picking, id)} onClose={() => setPicking(null)} />}
			</section>

			<section aria-labelledby="plan-todo">
				<h2 id="plan-todo">3. To do, biggest gain first</h2>
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
		</div>
	);
}

function ItemLink({ item }: { item: Item }) {
	return (
		<a className={`item-link quality-${item.quality}`} href={wowheadItemUrl(item.id)} target="_blank" rel="noreferrer">
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
