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
import { REFINE_DEPTH, REFINE_DEPTHS } from '../lib/sim/live';
import { planKeyOf, refineJob, useRefineJob } from '../lib/sim/refineJob';
import { sourceLine, statLine, wowheadItemUrl, wowheadData, wowheadEnchantUrl, wowheadSourceLink } from '../lib/stats';
import type { Character, Enchant, Item, SpecConfig } from '../lib/types';
import { ContentPicker, useContentOpen } from './ContentPicker';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
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
	// It runs as a job of its own: it goes on while another tab is open, and the app takes its result.
	const job = useRefineJob();
	const refining = job.running ? (job.label ?? '') : null;
	const refineSteps = { done: job.done, total: job.total };
	const refineNote = job.note;
	const checkedPlan = job.checkedKey;
	const planKey = planKeyOf(character);
	// How deep the check looks into each slot's list: the visitor's choice, kept in this browser.
	const [depth, setDepthState] = useState(() => {
		try {
			const saved = Number(localStorage.getItem('fgp.refineDepth'));
			return REFINE_DEPTHS.some(option => option.depth === saved) ? saved : REFINE_DEPTH;
		} catch {
			return REFINE_DEPTH;
		}
	});
	const setDepth = (next: number) => {
		setDepthState(next);
		try {
			localStorage.setItem('fgp.refineDepth', String(next));
		} catch {
			/* private mode: kept for this visit */
		}
	};
	const refine = () => void refineJob.start({ character, data, spec, filter }, depth);
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

	/** The word "Source": where the item comes from as a tooltip, and a click to that source on Wowhead. */
	const sourceWord = (item: Item) => {
		const guide = marks.get(item.id)?.find(m => m.source);
		const source = usableSources(item, faction, filter, character.professions)[0] ?? usableSources(item, faction, EVERYTHING)[0];
		const text = guide ? `${guide.source} (per ${guide.guide.label})` : sourceLine(source, data);
		const link = wowheadSourceLink(source);
		return link ? (
			<a className="plan-source" href={link.url} title={text} target="_blank" rel="noreferrer">
				Source
			</a>
		) : (
			<span className="plan-source" title={text} tabIndex={0}>
				Source
			</span>
		);
	};
	/** What an enchant gives: its stats, or the DPS the simulator measured for its effect. */
	const enchantGives = (enchant: Enchant) => {
		const measured = data.simValues.enchants.get(enchant.effectId);
		return statLine(enchant.stats ?? {}) || (measured !== undefined ? `${formatGain(measured)} from its effect` : '');
	};

	// What the estimate does not know about this character: said next to it, before anybody wonders.
	const caveats = estimateCaveats(character, spec);
	// An empty string means "the build's own talents".
	const talentsDiffer = Boolean(character.talents && spec.talents && character.talents !== spec.talents);
	const standardTalents = () => onChange({ ...character, talents: '' });
	const staleCount = slots.filter(row => row.isChange && row.goalItem && !isObtainable(row.goalItem, character, faction, filter, spec)).length;

	return (
		<div className="plan">
			{/* First what counts, then the plan and its simulation. */}
			{(
				<details className="content-fold fold" inert={refining !== null} open={contentOpen} onToggle={event => setContentOpen(event.currentTarget.open)}>
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
							{talentsDiffer && (
								<button type="button" className="button button-small standard-talents" title="Sets your talents to the ones this build was measured with. You can change them again under Sim setup." onClick={standardTalents}>
									Use the build's standard talents
								</button>
							)}
						</div>
						<div>
							<span className="field-label">Still to do</span>
							<span className="score num">{openCount}</span>
							<span className="summary-hit">{openCount === 1 ? 'change' : 'changes'}</span>
						</div>
					</div>
					<SimSummary equipped={character.gear} planned={gear} hasPlan={hasPlan} auto estimated={hasPlan ? planned.score - equipped.score : undefined} caveats={caveats} onStandardTalents={talentsDiffer ? standardTalents : undefined} />
					{staleCount > 0 && (
						<p className="notice" role="status">
							{staleCount === 1 ? 'One planned item comes' : `${staleCount} planned items come`} from content that is switched off above (marked "not in your content" below). The plan was made before
							that choice. "Rebuild the plan" replaces {staleCount === 1 ? 'it' : 'them'}.
						</p>
					)}
					{!import.meta.env.VITE_NO_SIM && hasPlan && !refining && checkedPlan !== planKey && (
						<p className="check-callout" role="note">
							<svg className="check-callout-sign" viewBox="0 0 24 22" aria-hidden="true">
								<path d="M12 1.5 23 20.5H1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
								<path d="M12 8v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
								<circle cx="12" cy="17.2" r="1.3" fill="currentColor" />
							</svg>
							<span>
								<strong>This plan is an estimate.</strong> For the best result, press "Check the plan with the simulator": it tests the plan and its alternatives with real simulations and swaps in whatever
								is really better. It takes a few minutes and you only need it once per plan.
							</span>
						</p>
					)}
					<div className="actions">
						{!import.meta.env.VITE_NO_SIM && (
							<button className="button button-primary" onClick={refine} disabled={refining !== null}>
								Check the plan with the simulator
							</button>
						)}
						{!import.meta.env.VITE_NO_SIM && (
							<label className="refine-depth">
								How thorough
								<select value={depth} onChange={event => setDepth(Number(event.target.value))} disabled={refining !== null}>
									{REFINE_DEPTHS.map(option => (
										<option key={option.depth} value={option.depth}>
											{option.label}: {option.note}
										</option>
									))}
								</select>
							</label>
						)}
						{refining && (
							<button className="button" onClick={() => refineJob.stop()}>
								Stop
							</button>
						)}
						<button className="button" title="Throws away your own changes and the simulator's, and builds the plan again from the estimate. Use it after changing what you wear." onClick={() => rebuild()} disabled={refining !== null}>
							Rebuild the plan
						</button>
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
					{!import.meta.env.VITE_NO_SIM && (
						<p className="hint powered">
							<span className="powered-by" tabIndex={0}>
								Powered by{' '}
								<a href="https://wowsims.com" target="_blank" rel="noreferrer">
									WoWSims
								</a>
								<span className="powered-mark" aria-hidden="true">
									?
								</span>
								<span className="powered-pop" role="tooltip">
									<strong>What "Check the plan with the simulator" does</strong>
									<ol>
										<li>It runs your plan, the guides' sets and what you wear against each other and starts from the best.</li>
										<li>Slot by slot it tries the best items (as many as "How thorough" says), then the enchants.</li>
										<li>It tries slots that only pay off together: both rings, both trinkets, both hands, and slots that trade hit rating.</li>
										<li>A change stays only when the {unit()} really goes up. The result is never below what you wear.</li>
									</ol>
									It takes several minutes.
								</span>
							</span>
						</p>
					)}
				</div>
					</>
				)}

				{(
					<>
				<MeasuredNote specId={spec.id} />
				<ul className="plain-list plan-slots" inert={refining !== null}>
					{slots.map(({ slot, index, equippedItem, goalItem, goalEnchant, isChange, overWorn, others }) => (
						<li key={slot.key} className={`plan-slot${isChange ? '' : ' plan-slot-done'}`}>
							<button className="slot-button" onClick={() => setPicking(index)} title={`Change the planned ${slot.label.toLowerCase()} item`} aria-label={`Change the planned ${slot.label.toLowerCase()} item`}>
								<ItemIcon icon={goalItem?.icon} quality={goalItem?.quality} small />
							</button>
							<div className="plan-slot-body">
								<span className="slot-label">{slot.label}</span>
								{goalItem ? (
									<span className="plan-row plan-goal">
										<ItemLink item={goalItem} />
										{isChange && sourceWord(goalItem)}
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
									<span className="plan-row plan-goal plan-empty">Nothing to wear here</span>
								)}
								<span className="plan-row plan-enchant-row">
									{goalEnchant ? (
										<>
											{wowheadEnchantUrl(goalEnchant) ? (
												<a className="plan-enchant-name" href={wowheadEnchantUrl(goalEnchant)} target="_blank" rel="noreferrer">
													{goalEnchant.name}
												</a>
											) : (
												<span className="plan-enchant-name">{goalEnchant.name}</span>
											)}
											<span className="slot-source">{enchantGives(goalEnchant)}</span>
										</>
									) : (
										<span className="slot-source">{goalItem && applicableEnchants(index, goalItem, data).length > 0 ? 'No enchant planned' : '\u00a0'}</span>
									)}
								</span>
								<span className="plan-row plan-replaces">
									{!goalItem ? (
										'\u00a0'
									) : !isChange ? (
										'You wear it'
									) : equippedItem ? (
										<>
											replaces <ItemLink item={equippedItem} />
											<span className={`num ${overWorn >= 0 ? 'delta-up' : 'delta-down'}`}>({formatDps(overWorn)} over it)</span>
										</>
									) : (
										<>
											fills an empty slot <span className={`num ${overWorn >= 0 ? 'delta-up' : 'delta-down'}`}>({formatDps(overWorn)})</span>
										</>
									)}
								</span>
								{[0, 1].map(n => {
									const other = isChange ? others[n] : undefined;
									return (
										<span key={n} className="plan-row plan-option">
											{other ? (
												<>
													<span className="plan-option-label">Option {n + 1}:</span>
													<button type="button" className="plan-option-pick" title={`Plan ${other.item.name} for this slot instead`} aria-label={`Plan ${other.item.name} instead`} onClick={() => pickItem(index, other.item.id)}>
														<ItemIcon icon={other.item.icon} quality={other.item.quality} inline />
													</button>
													<ItemLink item={other.item} />
													<span className="num" title={`${formatGain(other.delta)} against the planned item, estimated`}>{formatGain(other.delta).replace(` ${unit()}`, '')}</span>
													{sourceWord(other.item)}
												</>
											) : (
												'\u00a0'
											)}
										</span>
									);
								})}
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
					<ol className="plain-list todo" inert={refining !== null}>
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
						{entry.enchant ? <ItemIcon icon={entry.enchant.icon ?? entry.item?.icon} quality={entry.enchant.quality} small /> : <ItemIcon icon={entry.item?.icon} quality={entry.item?.quality} small />}
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
