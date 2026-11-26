import { Help } from './Help';
import { useMemo, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { formatDps, unit } from '../lib/format';
import { bestEnchants, enchantOverview, professionValues } from '../lib/enchants';
import type { GameData } from '../lib/gameData';
import { type Gear, plannedGear, scoreSet, type SourceFilter } from '../lib/scoring';
import { statLine, wowheadEnchantUrl, wowheadEnchantData, wowheadItemUrl, wowheadData } from '../lib/stats';
import type { Character, Enchant, SpecConfig } from '../lib/types';
import { ItemIcon } from './ItemIcon';
import { SourceSymbol } from './Ornaments';
import { SimDelta, SWAP_ITERATIONS, useSim } from './Sim';
import { SourceList } from './SourceLabel';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
	onChange: (next: Character) => void;
	/** As a part of the plan's own panel: one line per slot, the options behind a click, the explanations behind question marks. */
	compact?: boolean;
}

const OPTIONS_SHOWN = 3;
const CRAFTS_SHOWN = 6;
const formatDelta = formatDps;

export function EnchantsTab({ spec, character, data, filter, onChange, compact = false }: Props) {
	// In the compact list: the slots whose options are open.
	const [openSlots, setOpenSlots] = useState<Set<number>>(new Set());
	const gear = useMemo(() => plannedGear(character, data), [character, data]);
	const overview = useMemo(() => enchantOverview(gear, character, data, spec), [gear, character, data, spec]);
	const professions = useMemo(() => professionValues({ character, data, spec, filter }), [character, data, spec, filter]);
	const hasPlan = Object.keys(character.plan ?? {}).length > 0;
	const sim = useSim();
	// Slots whose enchants are all shown and simulated against each other.
	const [comparing, setComparing] = useState<Set<number>>(new Set());

	const setEnchants = (changes: Record<number, number | undefined>) =>
		onChange({
			...character,
			gear: character.gear.map((piece, i) => {
				if (!piece || !(i in changes)) return piece;
				const { enchant: _old, ...rest } = piece;
				return changes[i] ? { ...rest, enchant: changes[i] } : rest;
			}),
		});

	/** `gear` with the slot's enchant replaced (or removed). */
	const withEnchant = (slotIndex: number, effectId?: number): Gear =>
		gear.map((piece, i) => {
			if (i !== slotIndex || !piece) return piece;
			const { enchant: _old, ...rest } = piece;
			return effectId ? { ...rest, enchant: effectId } : rest;
		});

	const enchanted = overview.filter(s => s.current).length;
	const best = useMemo(() => bestEnchants(gear, character, data, spec), [gear, character, data, spec]);
	const bestGain = useMemo(() => {
		const after = gear.map((p, i) => (p && best[i] ? { ...p, enchant: best[i] } : p));
		return scoreSet(after, character, data, spec).score - scoreSet(gear, character, data, spec).score;
	}, [gear, best, character, data, spec]);
	const ownProfessionsWithoutCrafts = character.professions.filter(p => !professions.some(v => v.profession === p));

	return (
		<div className={compact ? 'enchants enchants-compact' : 'enchants'}>
			<section className="panel" aria-labelledby="enchants-title">
				<h2 id="enchants-title">
					Enchants
					{compact && (
						<>
							<span className="enchants-count">
								{enchanted} of {overview.length} slots
							</span>
							<Help label="How the enchant numbers work">
								Numbers show the change in set score for your {hasPlan ? 'planned' : 'equipped'} gear. Enchants that only add a proc, such as Crusader, cannot be scored; "Sim" runs the real simulator for an enchant and shows
								its {unit()} against the bare item. The source is where the enchant or its recipe comes from.
							</Help>
						</>
					)}
				</h2>
				<p className="hint enchants-hint" hidden={compact}>
					{enchanted} of {overview.length} enchantable slots have an enchant. Numbers show the change in set score for your {hasPlan ? 'planned' : 'equipped'} gear. Enchants that only add a
					proc, such as Crusader, cannot be scored; "Sim" runs the real simulator for an enchant and shows its {unit()} against the bare item. The source is where the enchant or its recipe comes from.
				</p>
				<div className="actions">
					<button className="button button-primary" onClick={() => setEnchants(best)} disabled={Object.keys(best).length === 0}>
						{Object.keys(best).length === 0 ? 'Best stat enchants applied' : `Apply the best stat enchants (${formatDelta(bestGain)})`}
					</button>
				</div>

				<ul className="plain-list enchant-slots">
					{overview.map(slot => (
						<li key={slot.slotIndex} className={`card enchant-slot${slot.current ? '' : ' enchant-slot-open'}`}>
							<div className="enchant-slot-head">
								<ItemIcon icon={slot.item.icon} quality={slot.item.quality} small />
								<span className="enchant-item">
									<h3>{GEAR_SLOTS[slot.slotIndex].label}</h3>
									<a className={`item-link quality-${slot.item.quality}`} href={wowheadItemUrl(slot.item.id)} data-wowhead={wowheadData('item', slot.item.id)} target="_blank" rel="noreferrer">
										{slot.item.name}
									</a>
								</span>
								<p className="enchant-current">
									{slot.current ? (
										<>
											<EnchantName enchant={slot.current} inline /> <span className="num delta-up">{slot.currentDelta > 0 ? formatDelta(slot.currentDelta) : ''}</span>{' '}
											<button className="link" onClick={() => setEnchants({ [slot.slotIndex]: undefined })}>
												Remove
											</button>
										</>
									) : (
										<span className="enchant-none">No enchant yet</span>
									)}
								</p>
								{compact &&
									(() => {
										const top = slot.options[0];
										const better = top && top.enchant.effectId !== slot.current?.effectId && top.delta > slot.currentDelta + 0.05;
										const total = slot.options.length + slot.unscored.length;
										const open = openSlots.has(slot.slotIndex);
										return (
											<>
												<span className="enchant-best">
													{better ? (
														<>
															<span className="slot-source">Better:</span> <EnchantName enchant={top.enchant} inline /> <span className="num delta-up">{formatDelta(top.delta - slot.currentDelta)}</span>
															{character.gear[slot.slotIndex] && (
																<button className="button button-small" onClick={() => setEnchants({ [slot.slotIndex]: top.enchant.effectId })}>
																	Use
																</button>
															)}
														</>
													) : slot.current ? (
														<span className="enchant-best-ok">Best stat enchant</span>
													) : (
														<span className="slot-source">Nothing scored helps here</span>
													)}
												</span>
												<button
													className="link enchant-more"
													aria-expanded={open}
													disabled={total === 0}
													onClick={() =>
														setOpenSlots(old => {
															const next = new Set(old);
															if (!next.delete(slot.slotIndex)) next.add(slot.slotIndex);
															return next;
														})
													}>
													{open ? 'Hide options' : `Options (${total})`}
												</button>
											</>
										);
									})()}
							</div>
							<div className="enchant-options" hidden={compact && !openSlots.has(slot.slotIndex)}>
								{slot.options.length === 0 && slot.unscored.length === 0 && <p className="slot-source">No enchant helps this spec here.</p>}
								{(() => {
									const all = comparing.has(slot.slotIndex);
									const bare = withEnchant(slot.slotIndex);
									const bareResult = sim.result(bare, SWAP_ITERATIONS);
									const rows = [...(all ? slot.options : slot.options.slice(0, OPTIONS_SHOWN)).map(option => ({ enchant: option.enchant, delta: option.delta as number | undefined })), ...slot.unscored.map(enchant => ({ enchant, delta: undefined as number | undefined }))].map(row => {
										const variant = withEnchant(slot.slotIndex, row.enchant.effectId);
										const result = sim.result(variant, SWAP_ITERATIONS);
										return { ...row, variant, simulated: bareResult && result ? result.dps - bareResult.dps : undefined };
									});
									// While comparing, the simulated numbers decide the order; rows not simulated yet keep their place below.
									if (all) rows.sort((x, y) => (y.simulated ?? -Infinity) - (x.simulated ?? -Infinity));
									const total = slot.options.length + slot.unscored.length;
									const done = rows.filter(row => row.simulated !== undefined).length;
									const winner = all && done === rows.length && rows.length > 1 ? rows[0] : undefined;
									return (
										<>
											{rows.map(({ enchant, delta, variant }, position) => {
												const active = enchant.effectId === slot.current?.effectId;
												return (
													<div key={`${enchant.effectId}-${enchant.name}`} className={winner && position === 0 ? 'enchant-option enchant-winner' : 'enchant-option'}>
														{delta !== undefined ? <span className="num delta-up">{formatDelta(delta)}</span> : <span className="badge">sim it</span>}
														<ItemIcon icon={enchant.icon} quality={enchant.quality} small />
														<span>
															<EnchantName enchant={enchant} />
															<span className="slot-source">
																{delta !== undefined ? `${statLine(enchant.stats ?? {}) || 'Proc, measured with the simulator'}. ` : 'Proc or effect, not in the estimate. '}
																{enchantSource(enchant, data)}
															</span>
														</span>
														<SimDelta base={bare} variant={variant} />
														{active ? (
															<span className="badge badge-plan">in use</span>
														) : (
															character.gear[slot.slotIndex] && (
																<button className="button button-small" onClick={() => setEnchants({ [slot.slotIndex]: enchant.effectId })}>
																	Use
																</button>
															)
														)}
													</div>
												);
											})}
											{total > 1 && (
												<p className="enchant-compare">
													{!all ? (
														<button
															className="button button-small"
															onClick={() => {
																setComparing(old => new Set(old).add(slot.slotIndex));
																if (!bareResult) sim.run(bare, SWAP_ITERATIONS);
																for (const option of slot.options) sim.run(withEnchant(slot.slotIndex, option.enchant.effectId), SWAP_ITERATIONS);
																for (const enchant of slot.unscored) sim.run(withEnchant(slot.slotIndex, enchant.effectId), SWAP_ITERATIONS);
															}}>
															Compare all {total} with the simulator
														</button>
													) : winner ? (
														<span>
															Simulated best: <strong>{winner.enchant.name}</strong>. Sorted by simulated {unit()} against the bare item; differences marked "within noise" are a tie.{' '}
															<button className="link" onClick={() => setComparing(old => new Set([...old].filter(i => i !== slot.slotIndex)))}>
																Show fewer
															</button>
														</span>
													) : (
														<span className="slot-source">
															Simulating {done} of {rows.length}…
														</span>
													)}
												</p>
											)}
										</>
									);
								})()}
							</div>
						</li>
					))}
				</ul>
			</section>

			<section className="panel" aria-labelledby="professions-title">
				<h2 id="professions-title">
					Professions
					{compact && (
						<Help label="What the profession list shows">
							What each crafting profession can make that beats your equipped gear. "Up to" adds the best item per slot. Whether a crafted item can be traded is not in the data, so items from other professions may or may not
							be buyable.
						</Help>
					)}
				</h2>
				<p className="hint enchants-hint" hidden={compact}>
					What each crafting profession can make that beats your equipped gear. "Up to" adds the best item per slot. Whether a crafted item can be traded is not in the data, so items from
					other professions may or may not be buyable.
				</p>
				{ownProfessionsWithoutCrafts.length > 0 && <p className="slot-source">{ownProfessionsWithoutCrafts.join(' and ')}: no craftable upgrades (gathering profession or nothing better).</p>}
				<div className="professions">
					{professions.map(({ profession, mine, items, value }) => (
						<div key={profession} className={`card profession${mine ? ' profession-mine' : ''}`}>
							<h3>
								<SourceSymbol kind="crafted" /> {profession}
								{mine && <span className="badge badge-plan">yours</span>}
							</h3>
							<p className="profession-value">
								<span className="num delta-up">up to {formatDelta(value)}</span> from {items.length} upgrade{items.length === 1 ? '' : 's'}
							</p>
							<ul className="plain-list">
								{items.slice(0, CRAFTS_SHOWN).map(drop => (
									<li key={drop.item.id} className="boss-drop craft-drop">
										<span className="num delta-up">{formatDelta(drop.delta)}</span>
										<ItemIcon icon={drop.item.icon} quality={drop.item.quality} small />
										<span>
											<a className={`item-link quality-${drop.item.quality}`} href={wowheadItemUrl(drop.item.id)} data-wowhead={wowheadData('item', drop.item.id)} target="_blank" rel="noreferrer">
												{drop.item.name}
											</a>
											<span className="slot-source"> {GEAR_SLOTS[drop.slotIndex].label}</span>
											{drop.planned && <span className="badge badge-plan">in your plan</span>}
										</span>
									</li>
								))}
							</ul>
							{items.length > CRAFTS_SHOWN && <p className="slot-source">and {items.length - CRAFTS_SHOWN} smaller upgrades</p>}
						</div>
					))}
				</div>
			</section>
		</div>
	);
}

/** An enchant's name as a link to its Wowhead page. */
function EnchantName({ enchant, inline = false }: { enchant: Enchant; inline?: boolean }) {
	const url = wowheadEnchantUrl(enchant);
	const className = inline ? 'item-link' : 'enchant-name item-link';
	return url ? (
		<a className={className} href={url} data-wowhead={wowheadEnchantData(enchant)} target="_blank" rel="noreferrer">
			{enchant.name}
		</a>
	) : (
		<span className={inline ? undefined : 'enchant-name'}>{enchant.name}</span>
	);
}

function enchantSource(enchant: Enchant, data: GameData) {
	return <SourceList sources={enchant.sources ?? []} data={data} />;
}
