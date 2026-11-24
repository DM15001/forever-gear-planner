import { useEffect, useMemo, useRef } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { applicableEnchants, enchantLimit, enchantLine, withEnchant } from '../lib/enchants';
import { formatDps } from '../lib/format';
import type { GameData } from '../lib/gameData';
import { type Gear, scoreSet } from '../lib/scoring';
import { wowheadData } from '../lib/stats';
import type { Character, Enchant, SpecConfig } from '../lib/types';
import { ItemIcon } from './ItemIcon';
import { SourceLabel } from './SourceLabel';

interface Props {
	slotIndex: number;
	gear: Gear;
	character: Character;
	data: GameData;
	spec: SpecConfig;
	/** The enchant's effectId, or null for none. */
	onPick: (effectId: number | null) => void;
	onClose: () => void;
}

/** The enchants that fit the item in a slot, best first, each with what it adds over no enchant; "No enchant" on top. */
export function EnchantList({ slotIndex, gear, character, data, spec, onPick }: Omit<Props, 'onClose'>) {
	const piece = gear[slotIndex];
	const item = piece ? data.itemById.get(piece.id) : undefined;
	const rows = useMemo(() => {
		const bare = scoreSet(withEnchant(gear, slotIndex, undefined), character, data, spec).score;
		const hasStats = (e: Enchant) => Object.keys(e.stats ?? {}).length > 0;
		return applicableEnchants(slotIndex, item, data)
			.map(enchant => {
				// An effect nobody measured has no number: the score cannot tell what it is worth.
				const scored = hasStats(enchant) || data.simValues.enchants.has(enchant.effectId) || !enchant.hasEffect;
				return { enchant, scored, delta: scoreSet(withEnchant(gear, slotIndex, enchant.effectId), character, data, spec).score - bare };
			})
			.sort((a, b) => b.delta - a.delta || Number(b.scored) - Number(a.scored) || a.enchant.name.localeCompare(b.enchant.name));
	}, [gear, slotIndex, item, character, data, spec]);

	return (
		<>
			<ul className="plain-list picker-list">
				{piece && (
					<li>
						<button className={`picker-row${piece.enchant ? '' : ' picker-row-on'}`} onClick={() => onPick(null)}>
							<ItemIcon icon={undefined} quality={undefined} small />
							<span className="picker-main">
								<span className="picker-name">No enchant</span>
								{!piece.enchant && <span className="slot-source">as it is now</span>}
							</span>
						</button>
					</li>
				)}
				{rows.map(({ enchant, scored, delta }) => {
					const limit = enchantLimit(enchant);
					const tooltip = enchant.spellId && (enchant.name.startsWith('Enchant ') || !enchant.itemId) ? wowheadData('spell', enchant.spellId) : enchant.itemId ? wowheadData('item', enchant.itemId) : undefined;
					return (
						<li key={enchant.effectId}>
							<button className={`picker-row${piece?.enchant === enchant.effectId ? ' picker-row-on' : ''}`} onClick={() => onPick(enchant.effectId)}>
								<ItemIcon icon={enchant.icon} quality={enchant.quality} small />
								<span className="picker-main">
									<span className="picker-name">
										<span className="enchant-gives">{enchantLine(enchant)}</span>
										{piece?.enchant === enchant.effectId && <span className="slot-source"> on the item now</span>}
									</span>
									<span className="slot-source" data-wowhead={tooltip} data-wh-rename-link="false">
										{enchant.name}
										{limit ? `. ${limit}` : ''}
									</span>
									<span className="slot-source">
										<SourceLabel source={enchant.sources?.[0]} data={data} />
									</span>
								</span>
								<span className={`num ${delta > 0 ? 'delta-up' : ''}`}>{scored ? formatDps(delta) : <span title="An effect the simulator has not measured for this build, so it has no number.">not scored</span>}</span>
							</button>
						</li>
					);
				})}
			</ul>
			{rows.length === 0 && <p className="hint">Nothing can be put on this item.</p>}
		</>
	);
}

/** Every enchant that fits the item in a slot, in a window of its own. */
export function EnchantPicker({ slotIndex, gear, character, data, spec, onPick, onClose }: Props) {
	const dialog = useRef<HTMLDialogElement>(null);
	const piece = gear[slotIndex];
	const item = piece ? data.itemById.get(piece.id) : undefined;

	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
	}, []);

	return (
		<dialog
			ref={dialog}
			className="picker"
			aria-labelledby="enchant-picker-title"
			onClose={onClose}
			onClick={event => {
				if (event.target === dialog.current) dialog.current?.close();
			}}>
			<div className="picker-head">
				<h3 id="enchant-picker-title">Enchant: {GEAR_SLOTS[slotIndex].label}</h3>
				<button className="button button-small" onClick={() => dialog.current?.close()}>
					Close
				</button>
			</div>
			<p className="picker-current">
				{item?.name}. Only enchants that fit this item are listed; the number is what each adds over no enchant.
			</p>
			<EnchantList slotIndex={slotIndex} gear={gear} character={character} data={data} spec={spec} onPick={onPick} />
		</dialog>
	);
}
