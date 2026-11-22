import { useMemo } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { formatDps } from '../lib/format';
import { bestEnchants, enchantOverview, professionValues } from '../lib/enchants';
import type { GameData } from '../lib/gameData';
import { type Gear, plannedGear, scoreSet, type SourceFilter } from '../lib/scoring';
import { statLine, wowheadEnchantUrl, wowheadItemUrl } from '../lib/stats';
import type { Character, Enchant, SpecConfig } from '../lib/types';
import { ItemIcon } from './ItemIcon';
import { SourceSymbol } from './Ornaments';
import { SimDelta } from './Sim';
import { SourceList } from './SourceLabel';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
	onChange: (next: Character) => void;
}

const OPTIONS_SHOWN = 3;
const CRAFTS_SHOWN = 6;
const formatDelta = formatDps;

export function EnchantsTab({ spec, character, data, filter, onChange }: Props) {
	const gear = useMemo(() => plannedGear(character, data), [character, data]);
	const overview = useMemo(() => enchantOverview(gear, character, data, spec), [gear, character, data, spec]);
	const professions = useMemo(() => professionValues({ character, data, spec, filter }), [character, data, spec, filter]);
	const hasPlan = Object.keys(character.plan ?? {}).length > 0;

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
		<div className="enchants">
			<section aria-labelledby="enchants-title">
				<h2 id="enchants-title">Enchants</h2>
				<p className="hint enchants-hint">
					{enchanted} of {overview.length} enchantable slots have an enchant. Numbers show the change in set score for your {hasPlan ? 'planned' : 'equipped'} gear. Enchants that only add a
					proc, such as Crusader, cannot be scored; "Sim" runs the real simulator for an enchant and shows its DPS against the bare item. The source is where the enchant or its recipe comes from.
				</p>
				<div className="actions">
					<button className="button button-primary" onClick={() => setEnchants(best)} disabled={Object.keys(best).length === 0}>
						{Object.keys(best).length === 0 ? 'Best stat enchants applied' : `Apply the best stat enchants (${formatDelta(bestGain)})`}
					</button>
				</div>

				<ul className="plain-list enchant-slots">
					{overview.map(slot => (
						<li key={slot.slotIndex} className="enchant-slot">
							<div className="enchant-slot-head">
								<h3>{GEAR_SLOTS[slot.slotIndex].label}</h3>
								<span className="enchant-item">
									<ItemIcon icon={slot.item.icon} quality={slot.item.quality} small />
									<a className={`item-link quality-${slot.item.quality}`} href={wowheadItemUrl(slot.item.id)} target="_blank" rel="noreferrer">
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
										<span className="enchant-none">No enchant</span>
									)}
								</p>
							</div>
							<div className="enchant-options">
								{slot.options.length === 0 && <p className="slot-source">No stat enchant helps this spec here.</p>}
								{slot.options.slice(0, OPTIONS_SHOWN).map(({ enchant, delta }) => {
									const active = enchant.effectId === slot.current?.effectId;
									return (
										<div key={`${enchant.effectId}-${enchant.name}`} className="enchant-option">
											<span className="num delta-up">{formatDelta(delta)}</span>
											<ItemIcon icon={enchant.icon} quality={enchant.quality} small />
											<span>
												<EnchantName enchant={enchant} />
												<span className="slot-source">
													{statLine(enchant.stats ?? {}) || 'Proc, measured with the simulator'}. {enchantSource(enchant, data)}
												</span>
											</span>
											<SimDelta base={withEnchant(slot.slotIndex)} variant={withEnchant(slot.slotIndex, enchant.effectId)} />
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
								{slot.unscored.map(enchant => {
									const active = enchant.effectId === slot.current?.effectId;
									return (
										<div key={`${enchant.effectId}-${enchant.name}`} className="enchant-option">
											<span className="badge">sim it</span>
											<ItemIcon icon={enchant.icon} quality={enchant.quality} small />
											<span>
												<EnchantName enchant={enchant} />
												<span className="slot-source">Proc or effect, not in the score. {enchantSource(enchant, data)}</span>
											</span>
											<SimDelta base={withEnchant(slot.slotIndex)} variant={withEnchant(slot.slotIndex, enchant.effectId)} />
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
							</div>
						</li>
					))}
				</ul>
			</section>

			<section aria-labelledby="professions-title">
				<h2 id="professions-title">Professions</h2>
				<p className="hint enchants-hint">
					What each crafting profession can make that beats your equipped gear. "Up to" adds the best item per slot. Whether a crafted item can be traded is not in the data, so items from
					other professions may or may not be buyable.
				</p>
				{ownProfessionsWithoutCrafts.length > 0 && <p className="slot-source">{ownProfessionsWithoutCrafts.join(' and ')}: no craftable upgrades (gathering profession or nothing better).</p>}
				<div className="professions">
					{professions.map(({ profession, mine, items, value }) => (
						<div key={profession} className={`panel profession${mine ? ' profession-mine' : ''}`}>
							<h3>
								<SourceSymbol kind="crafted" /> {profession}
								{mine && <span className="badge badge-plan">yours</span>}
							</h3>
							<p className="profession-value">
								<span className="num delta-up">up to {formatDelta(value)}</span> from {items.length} upgrade{items.length === 1 ? '' : 's'}
							</p>
							<ul className="plain-list">
								{items.slice(0, CRAFTS_SHOWN).map(drop => (
									<li key={drop.item.id} className="boss-drop">
										<span className="num delta-up">{formatDelta(drop.delta)}</span>
										<ItemIcon icon={drop.item.icon} quality={drop.item.quality} small />
										<span>
											<a className={`item-link quality-${drop.item.quality}`} href={wowheadItemUrl(drop.item.id)} target="_blank" rel="noreferrer">
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
		<a className={className} href={url} target="_blank" rel="noreferrer">
			{enchant.name}
		</a>
	) : (
		<span className={inline ? undefined : 'enchant-name'}>{enchant.name}</span>
	);
}

function enchantSource(enchant: Enchant, data: GameData) {
	return <SourceList sources={enchant.sources ?? []} data={data} />;
}
