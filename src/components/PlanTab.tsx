import type { ReactNode } from 'react';
import { reportSource } from './ReportSource';
import { estimateCaveats } from '../lib/caveats';
import { MeasuredNote } from './MeasuredNote';
import { useEffect, useMemo, useRef, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { formatDps, unit } from '../lib/format';
import { applicableEnchants } from '../lib/enchants';
import type { GameData } from '../lib/gameData';
import { guideMarks } from '../lib/guides';
import { DepthArt } from './DepthArt';
import { buildPlan, fallbacks, gotEnchant, gotItem, type PlanStep, planSteps } from '../lib/plan';
import { EMPTY_SLOT, EVERYTHING, isUnmeasured, lockedSlots, plannedGear, scoreSet, slotInUse, type SourceFilter, usableSources, withItem, isObtainable } from '../lib/scoring';
import { simClient } from '../lib/sim/client';
import { measureWeights, REFINE_DEPTH, REFINE_DEPTHS, weightRuns } from '../lib/sim/live';
import { planKeyOf, refineJob, useRefineJob } from '../lib/sim/refineJob';
import { sourceLine, statLine, wowheadItemUrl, wowheadData, wowheadEnchantUrl, wowheadEnchantData, wowheadSourceLink } from '../lib/stats';
import type { Character, Enchant, Item, SpecConfig } from '../lib/types';
import { ContentPicker, useContentOpen } from './ContentPicker';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
import { ItemPicker } from './ItemPicker';
import { SimSummary, ProgressBar } from './Sim';

interface Props {
	/** How many earlier plans can be gone back to, and the way back. */
	undoSteps?: number;
	onUndo?: () => void;
	/** The build's own weights, and a way to replace them by ones measured for this character. */
	defaultWeights?: SpecConfig['weights'];
	onWeightsChange?: (weights: SpecConfig['weights'] | null) => void;
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
	onFilterChange: (next: SourceFilter) => void;
	onChange: (next: Character) => void;
	/** 'sim': the plan's numbers, the simulation and the content choice. 'list': the planned items and the to-do list. */
	part?: 'all';
	/** The content choice has a page of its own. */
	hideContent?: boolean;
	/** The layout of 26 Nov (first tried on Dev): what used to be panels of their own, now parts of the plan. The tools (fight, guides, weights) and the enchants and professions. */
	tools?: ReactNode;
	extras?: ReactNode;
}

const formatGain = formatDps;

/** The guided view: pick your content, get one plan, tick it off. */
/** The layout of 26 Nov (first tried on Dev). */
const NEW_LAYOUT = true;

/** The head of the plan as "before → after" with the simulator check as the next step (first tried on Dev, on both copies since 26 Nov). */
const NEW_HEAD = true;

/** What the button that builds the plan anew is called: the texts that point at it use the same name. */
const REBUILD = NEW_HEAD ? 'Reset to the automatic plan' : 'Rebuild the plan';

export function PlanTab({ spec, character, data, filter, onFilterChange, onChange, undoSteps = 0, onUndo, defaultWeights, onWeightsChange, hideContent = false, tools, extras }: Props) {
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
	// How deep the check looks into each slot's list. Every visit starts on Normal: a choice remembered from last time looked like a wrong default.
	const [depth, setDepth] = useState(REFINE_DEPTH);
	useEffect(() => {
		try {
			localStorage.removeItem('fgp.refineDepth');
		} catch {
			/* nothing was saved */
		}
	}, []);
	const refine = () => void refineJob.start({ character, data, spec, filter }, depth);
	// Stat weights for these talents: measured with the simulator, then the plan is built again with them.
	const [measuring, setMeasuring] = useState<string | null>(null);
	const measuredForMe = /^Measured for this character/.test(spec.weights.source ?? '');
	const rebuildWithNewWeights = useRef(false);
	useEffect(() => {
		if (!rebuildWithNewWeights.current) return;
		rebuildWithNewWeights.current = false;
		rebuild();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [spec]);
	const measureForMe = async () => {
		if (!defaultWeights || !onWeightsChange) return;
		setMeasuring('Starting the simulator…');
		try {
			const measured = await measureWeights(character, { ...spec, weights: defaultWeights }, simClient, (done, total) => setMeasuring(`Measuring, run ${done} of ${total}…`));
			rebuildWithNewWeights.current = true;
			onWeightsChange(measured);
		} catch {
			// The button is back; the estimate stays as it was.
		} finally {
			setMeasuring(null);
		}
	};
	// The hit the plan aims for.
	const hitChoices = spec.hitCapPercent > 0 ? [...new Set([spec.hitCapPercent, ...Array.from({ length: Math.ceil(spec.hitCapPercent) - 1 }, (_, n) => Math.ceil(spec.hitCapPercent) - 1 - n), 0])] : [];
	const setHitTarget = (value: number) => {
		const next = { ...character, hitTarget: value >= spec.hitCapPercent ? undefined : value };
		onChange({ ...next, ...buildPlan({ character: next, data, spec, filter }) });
	};
	// Locked slots: their planned item stays, and the rest is built around it.
	const locks = lockedSlots(character);
	const toggleLock = (index: number) => {
		const held = lockedSlots({ planLocks: [index] });
		const next = locks.includes(index) ? locks.filter(slot => !held.includes(slot)) : [...new Set([...locks, ...held])];
		onChange({ ...character, planLocks: next.length ? next : undefined });
	};
	// What the locks cost against a plan with every slot free, as the lists estimate it.
	const lockCost = useMemo(() => {
		if (locks.length === 0) return 0;
		const free = { ...character, planLocks: undefined };
		const freePlan = buildPlan({ character: free, data, spec, filter });
		const freeScore = scoreSet(plannedGear({ ...free, ...freePlan }, data), character, data, spec).score;
		// Against the best plan the locks still allow, not against the plan as it happens to stand.
		const lockedPlan = buildPlan({ character, data, spec, filter });
		return Math.max(0, freeScore - scoreSet(plannedGear({ ...character, ...lockedPlan }, data), character, data, spec).score);
	}, [character, data, spec, filter]); // eslint-disable-line react-hooks/exhaustive-deps
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
		// No source, or only a guess: the word asks for the real one.
		if (!guide && (!source || source.assumed || source.kind === 'unknown')) {
			return (
				<button type="button" className="plan-source plan-source-ask" title={`${text}. Know where it really comes from? Click to tell us.`} onClick={() => reportSource(item)}>
					Source?
				</button>
			);
		}
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
		// Plain stats are in the enchant's own tooltip; only what the tooltip cannot say is written out: the measured worth of a proc.
		return statLine(enchant.stats ?? {}) ? '' : measured !== undefined ? `${formatGain(measured)} from its effect` : '';
	};

	// What the estimate does not know about this character: said next to it, before anybody wonders.
	const caveats = estimateCaveats(character, spec);
	// An empty string means "the build's own talents".
	const talentsDiffer = Boolean(character.talents && spec.talents && character.talents !== spec.talents);
	const standardTalents = () => onChange({ ...character, talents: '' });
	const stale = slots.filter(row => row.isChange && row.goalItem && !isObtainable(row.goalItem, character, faction, filter, spec));
	const staleCount = stale.length;
	// A locked slot keeps its item whatever the content says: then "Rebuild the plan" cannot replace it.
	const staleLocked = stale.filter(row => lockedSlots(character).includes(row.index)).length;

	// The parts of the plan's head: the same ones on both copies, laid out differently on the Dev copy.
	const scores = (
		<>
			<div className="summary-scores">
				<div>
					<span className="field-label">The plan, estimated</span>
					<span className="score num delta-up">{hasPlan ? formatGain(planned.score - equipped.score) : 'Nothing to change'}</span>
					{spec.hitCapPercent > 0 && (
						<span className="summary-hit">
							{equipped.hit.total.toFixed(1)}% hit now, {planned.hit.total.toFixed(1)}% of {planned.hit.cap}% planned
						</span>
					)}
					{hitChoices.length > 0 && (
						<label className="hit-target" title="How much hit the plan aims for. WoWSims and the guides plan to the cap; a lower target makes the planner stop paying for hit earlier and spend those slots on other stats. Changing it rebuilds the plan.">
							Hit target
							<select value={character.hitTarget !== undefined && character.hitTarget < spec.hitCapPercent ? character.hitTarget : spec.hitCapPercent} disabled={refining !== null} onChange={event => setHitTarget(Number(event.target.value))}>
								{hitChoices.map(value => (
									<option key={value} value={value}>
										{value === spec.hitCapPercent ? `The cap, ${value}% (as WoWSims)` : value === 0 ? 'None: hit counts for nothing' : `${value}%`}
									</option>
								))}
							</select>
						</label>
					)}
					{caveats.length > 0 && (
						<span className="summary-hit estimate-caveat" title={`${caveats.join('; ')}.`}>
							less exact for you: {caveats.slice(0, -1).join('; ')}
						</span>
					)}
					{talentsDiffer && !measuredForMe && defaultWeights && onWeightsChange && (
						<button
							type="button"
							className="button button-small standard-talents"
							disabled={measuring !== null || refining !== null}
							title={`Runs the simulator ${weightRuns(spec)} times with your talents and gear, a few minutes in all, and rebuilds the plan with what it finds. The numbers in the lists then fit your talents.`}
							onClick={measureForMe}>
							{measuring ?? 'Fit the estimate to my talents'}
						</button>
					)}
					{measuredForMe && talentsDiffer && <span className="summary-hit">The estimate is measured for your talents.</span>}
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
		</>
	);
	const simSummary = (
		<>
			<SimSummary equipped={character.gear} planned={gear} hasPlan={hasPlan} auto estimated={hasPlan ? planned.score - equipped.score : undefined} caveats={caveats} onStandardTalents={talentsDiffer ? standardTalents : undefined} />
		</>
	);
	const callout = !import.meta.env.VITE_NO_SIM && hasPlan && !refining && checkedPlan !== planKey && (
						<p className="check-callout" role="note">
							<svg className="check-callout-sign" viewBox="0 0 24 22" aria-hidden="true">
								<path d="M12 1.5 23 20.5H1Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
								<path d="M12 8v6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
								<circle cx="12" cy="17.2" r="1.3" fill="currentColor" />
							</svg>
							<span>
								<strong>This plan is an estimate.</strong> "Check the plan with the simulator" tests it for real and swaps in what is better. A few minutes, once per plan.
							</span>
						</p>
					);
	const checkButtons = (
		<>
			{!import.meta.env.VITE_NO_SIM && (
				<button className="button button-primary" onClick={refine} disabled={refining !== null}>
					Check the plan with the simulator
				</button>
			)}
			{!import.meta.env.VITE_NO_SIM && NEW_HEAD && (
				<div className="depth-pick" role="radiogroup" aria-label="How thorough the check is">
					<span className="depth-pick-label">How thorough</span>
					<div className="depth-pick-row">
						{REFINE_DEPTHS.map((option, step) => (
							<button key={option.depth} type="button" role="radio" aria-checked={depth === option.depth} className={depth === option.depth ? 'depth-option depth-option-on' : 'depth-option'} disabled={refining !== null} title={`${option.label}: ${option.note}`} onClick={() => setDepth(option.depth)}>
								<DepthArt step={step} />
								<strong>{option.label}</strong>
							</button>
						))}
					</div>
					<span className="depth-pick-note">{REFINE_DEPTHS.find(option => option.depth === depth)?.note ?? ''}</span>
				</div>
			)}
			{!import.meta.env.VITE_NO_SIM && !NEW_HEAD && (
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
		</>
	);
	const toolButtons = (
		<>
			{onUndo && (
				<button className="button" disabled={undoSteps === 0 || refining !== null} title={undoSteps === 0 ? 'Nothing to take back yet' : `Takes back the last change of the plan (${undoSteps} ${undoSteps === 1 ? 'step' : 'steps'} kept)`} onClick={onUndo}>
					{NEW_HEAD ? (
						<span className="tool-button">
							<svg viewBox="0 0 20 20" aria-hidden="true">
								<path d="M8 4 3.500 8.500 8 13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
								<path d="M4 8.500h7.500a4.500 4.500 0 0 1 0 9H8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
							</svg>
							<span>
								<strong>Undo</strong>
								<small>{undoSteps === 0 ? 'Nothing to take back' : 'Take back the last change'}</small>
							</span>
						</span>
					) : (
						'Undo'
					)}
				</button>
			)}
			<button className="button" title="Throws away your own changes and the simulator's, and builds the plan again from the estimate. Locked slots stay. Use it after changing what you wear." onClick={() => rebuild()} disabled={refining !== null}>
				{NEW_HEAD ? (
					<span className="tool-button">
						<svg viewBox="0 0 20 20" aria-hidden="true">
							<path d="M16.500 10a6.500 6.500 0 1 1-2-4.700" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
							<path d="M16.800 2.500v3.800H13" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
						</svg>
						<span>
							<strong>Reset to the automatic plan</strong>
							<small>Drops your and the simulator's changes. Locked slots stay.</small>
						</span>
					</span>
				) : (
					'Rebuild the plan'
				)}
			</button>
		</>
	);
	const progress = refining && <ProgressBar done={refineSteps.done} total={refineSteps.total} label={`Checking the plan: ${refining}`} />;

	return (
		<div className="plan">
			{/* First what counts, then the plan and its simulation. */}
			{!hideContent && (
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
				<div className={NEW_HEAD ? 'summary plan-hero' : 'summary'}>
					{NEW_HEAD ? (
						<div className="plan-hero-grid">
							<div className="plan-hero-main">
								{simSummary}
								{scores}
								<div className="actions plan-hero-tools">{toolButtons}</div>
							</div>
							<aside className={checkedPlan === planKey && !refining ? 'plan-next plan-next-done' : 'plan-next'} aria-label="Check the plan with the simulator">
								<h3>{refining ? 'Checking the plan…' : checkedPlan === planKey ? 'Checked with the simulator' : 'Next: check it for real'}</h3>
								<p>
									{checkedPlan === planKey && !refining
										? 'This plan was tested with real simulations. Check again after you change it.'
										: 'This plan is an estimate. The simulator tests it and swaps in what is better. A few minutes, once per plan.'}
								</p>
								<div className="plan-next-actions">{checkButtons}</div>
								{progress}
							</aside>
						</div>
					) : (
						<>
							{scores}
							{simSummary}
						</>
					)}
					{staleCount > 0 && (
						<p className="notice" role="status">
							{staleCount === 1 ? 'One planned item comes' : `${staleCount} planned items come`} from content that is switched off in Content Selection (marked "not in your content" below).{' '}
							{staleLocked === staleCount
								? `${staleCount === 1 ? 'Its slot is' : 'Their slots are'} locked, so the plan keeps ${staleCount === 1 ? 'it' : 'them'}: unlock to have ${staleCount === 1 ? 'it' : 'them'} replaced.`
								: staleLocked > 0
									? `"${REBUILD}" replaces the unlocked ones; ${staleLocked} ${staleLocked === 1 ? 'is' : 'are'} in a locked slot and stay until you unlock.`
									: `"${REBUILD}" replaces ${staleCount === 1 ? 'it' : 'them'}.`}
						</p>
					)}
					{!NEW_HEAD && callout}
					{!NEW_HEAD && (
						<div className="actions">
							{checkButtons}
							{toolButtons}
						</div>
					)}
					{!NEW_HEAD && progress}
					{character.planTier && character.planTier.asked > 0 && (
						<p className={character.planTier.count < character.planTier.asked ? 'notice notice-error' : 'notice'} role="status">
							{character.planTier.count < character.planTier.asked
								? `You asked for at least ${character.planTier.asked} set pieces, but only ${character.planTier.count} fit the slots you ticked and the content you chose.`
								: `Built with at least ${character.planTier.asked} set pieces as you asked: ${character.planTier.count} are in the plan.`}{' '}
							{character.planTier.cost >= 0.05 ? `That costs ${formatGain(-character.planTier.cost)} against the free choice (estimated).` : 'That costs nothing against the free choice.'}
						</p>
					)}
					{locks.length > 0 && (
						<p className="lock-note" role="status">
							<strong className="lock-count" tabIndex={0} title={`Locked: ${locks.map(slot => GEAR_SLOTS[slot].label).join(', ')}`}>
								{locks.length} {locks.length === 1 ? 'slot' : 'slots'} locked
							</strong>
							. The plan is built around {locks.length === 1 ? 'it' : 'them'}
							{lockCost >= 0.05 ? `, which costs ${formatGain(-lockCost)} (estimated)` : ', at no cost'}.{' '}
							<button className="link" onClick={() => onChange({ ...character, planLocks: undefined })} disabled={refining !== null}>
								Unlock all
							</button>
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
				{tools && (
					<details className="fold plan-tools-fold">
						<summary>
							More options<span className="slot-source">What you are fighting, clear the plan, stat weights</span>
						</summary>
						{tools}
					</details>
				)}
				<MeasuredNote specId={spec.id} />
				{NEW_LAYOUT && (
					<header className="plan-gear-head">
						<h3>Your planned gear</h3>
					</header>
				)}
				<ul className="plain-list plan-slots" inert={refining !== null}>
					{slots.map(({ slot, index, equippedItem, goalItem, goalEnchant, isChange, overWorn, others }) => (
						<li key={slot.key} className={`plan-slot${isChange ? '' : ' plan-slot-done'}`}>
							<button className="slot-button" onClick={() => setPicking(index)} title={`Change the planned ${slot.label.toLowerCase()} item`} aria-label={`Change the planned ${slot.label.toLowerCase()} item`}>
								<ItemIcon icon={goalItem?.icon} quality={goalItem?.quality} small />
							</button>
							<div className="plan-slot-body">
								<span className="slot-label">
									{slot.label}
									{goalItem && (
										<button
											type="button"
											className={`plan-lock${locks.includes(index) ? ' plan-lock-on' : ''}`}
											aria-pressed={locks.includes(index)}
											title={locks.includes(index) ? `${goalItem.name} is locked: "${REBUILD}" and the simulator check keep it and fit the other slots around it. Click to unlock.` : `Lock ${goalItem.name}: the plan keeps it and is built around it`}
											onClick={() => toggleLock(index)}>
											<svg viewBox="0 0 16 16" aria-hidden="true">
												<rect x="3" y="7" width="10" height="7" rx="1.2" fill="currentColor" />
												<path d={locks.includes(index) ? 'M5 7V5a3 3 0 0 1 6 0v2' : 'M5 7V5a3 3 0 0 1 5.6-1.5'} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
											</svg>
											{locks.includes(index) ? 'Locked' : 'Lock'}
										</button>
									)}
								</span>
								{goalItem ? (
									<span className="plan-row plan-goal">
										<ItemLink item={goalItem} />
										{isChange && sourceWord(goalItem)}
										{isChange && <SuffixNote item={goalItem} />}
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
											{NEW_LAYOUT && <ItemIcon icon={goalEnchant.icon ?? 'trade_engraving'} quality={goalEnchant.quality} inline />}
											{wowheadEnchantUrl(goalEnchant) ? (
												<a className="plan-enchant-name" href={wowheadEnchantUrl(goalEnchant)} data-wowhead={wowheadEnchantData(goalEnchant)} target="_blank" rel="noreferrer">
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
										NEW_LAYOUT ? (
											<span className="plan-worn">
												<svg viewBox="0 0 16 16" aria-hidden="true">
													<path d="M3 8.5l3.2 3.2L13 5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
												</svg>
												You wear it
											</span>
										) : (
											'You wear it'
										)
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
				{extras && <div className="plan-extras">{extras}</div>}
				{picking !== null && <ItemPicker slotIndex={picking} gear={gear} character={character} data={data} spec={spec} filter={filter} onPick={id => pickItem(picking, id)} onEnchant={effectId => { onChange({ ...character, planEnchants: { ...(character.planEnchants ?? {}), [picking]: effectId ?? 0 } }); setPicking(null); }} onClose={() => setPicking(null)} />}
					</>
				)}
			</section>

			{/* The layout of 26 Nov (first tried on Dev): where to get the plan is Farm it's job ("How to get your plan"), so the list is not repeated here. */}
			{!NEW_LAYOUT && (
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
