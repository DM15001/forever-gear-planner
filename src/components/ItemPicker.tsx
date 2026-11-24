import { useEffect, useMemo, useRef, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { formatDps } from '../lib/format';
import type { GameData } from '../lib/gameData';
import { effortLine } from '../lib/loot';
import { EVERYTHING, type Gear, slotCandidates, type SourceFilter, usableSources } from '../lib/scoring';
import { pieceStats, statLine } from '../lib/stats';
import type { Character, SpecConfig } from '../lib/types';
import { EnchantList } from './EnchantPicker';
import { ItemIcon } from './ItemIcon';
import { suffixText } from './SuffixNote';
import { SourceLabel } from './SourceLabel';

interface Props {
	slotIndex: number;
	/** The set the choice goes into: the equipped gear, or the planned gear. Gains are measured against it. */
	gear: Gear;
	character: Character;
	data: GameData;
	spec: SpecConfig;
	/** The user's content choice. The list starts with it, or with everything when `startWithAll` is set. */
	filter: SourceFilter;
	startWithAll?: boolean;
	/** Offer "leave the slot empty". */
	allowEmpty?: boolean;
	onPick: (itemId: number | null) => void;
	/** Given: the window gets a second tab with the enchants for the item in the slot. null = no enchant. */
	onEnchant?: (effectId: number | null) => void;
	onClose: () => void;
}

const ROWS_SHOWN = 60;
const formatDelta = formatDps;

/** A list of everything that fits a slot, best first, to swap one item by hand. */
export function ItemPicker({ slotIndex, gear, character, data, spec, filter, startWithAll = false, allowEmpty = false, onPick, onEnchant, onClose }: Props) {
	const [tab, setTab] = useState<'items' | 'enchants'>('items');
	const dialog = useRef<HTMLDialogElement>(null);
	const [all, setAll] = useState(startWithAll);
	const [search, setSearch] = useState('');
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const current = gear[slotIndex] ? data.itemById.get(gear[slotIndex]!.id) : undefined;

	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
	}, []);

	const candidates = useMemo(() => slotCandidates(slotIndex, gear, { character, data, spec, filter: all ? EVERYTHING : filter }), [slotIndex, gear, character, data, spec, filter, all]);
	const words = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
	const matching = words.length ? candidates.filter(c => words.every(word => c.item.name.toLowerCase().includes(word))) : candidates;
	const shown = matching.slice(0, ROWS_SHOWN);

	return (
		<dialog
			ref={dialog}
			className="picker"
			aria-labelledby="picker-title"
			onClose={onClose}
			onClick={event => {
				// A click on the dimmed area around the dialog closes it.
				if (event.target === dialog.current) dialog.current?.close();
			}}>
			<div className="picker-head">
				<h3 id="picker-title">Choose: {GEAR_SLOTS[slotIndex].label}</h3>
				<button className="button button-small" onClick={() => dialog.current?.close()}>
					Close
				</button>
			</div>
			{onEnchant && (
				<div className="result-tabs picker-tabs" role="tablist" aria-label="What to change">
					<button role="tab" aria-selected={tab === 'items'} className="result-tab" onClick={() => setTab('items')}>
						Items
					</button>
					<button role="tab" aria-selected={tab === 'enchants'} className="result-tab" disabled={!current} title={current ? undefined : 'An empty slot cannot be enchanted'} onClick={() => setTab('enchants')}>
						Enchants
					</button>
				</div>
			)}
			{tab === 'enchants' && onEnchant ? (
				<>
					<p className="picker-current">{current?.name}. Only enchants that fit this item are listed; the number is what each adds over no enchant.</p>
					<EnchantList slotIndex={slotIndex} gear={gear} character={character} data={data} spec={spec} onPick={onEnchant} />
				</>
			) : (
				<>
			<p className="picker-current">{current ? `Now: ${current.name}. Gains are compared with it.` : 'The slot is empty.'}</p>
			<div className="picker-tools">
				<input type="text" placeholder="Search by name" aria-label="Search by name" value={search} onChange={e => setSearch(e.target.value)} autoFocus />
				<label className="check">
					<input type="checkbox" checked={all} onChange={e => setAll(e.target.checked)} />
					Show all items, not only my content
				</label>
			</div>
			<ul className="plain-list picker-list">
				{allowEmpty && current && !words.length && (
					<li>
						<button className="picker-row" onClick={() => onPick(null)}>
							<ItemIcon icon={undefined} quality={undefined} small />
							<span className="picker-main">
								<span className="picker-name">Leave the slot empty</span>
							</span>
						</button>
					</li>
				)}
				{shown.map(({ item, delta, incomplete }) => {
					const source = usableSources(item, faction, all ? EVERYTHING : filter, character.professions)[0] ?? usableSources(item, faction, EVERYTHING)[0];
					const stats = statLine(pieceStats(item, { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}) }, data));
					const effort = effortLine(source);
					return (
						<li key={item.id}>
							<button className="picker-row" onClick={() => onPick(item.id)}>
								<ItemIcon icon={item.icon} quality={item.quality} small />
								<span className="picker-main">
									<span className={`picker-name quality-${item.quality}`}>
										{item.name}
										{suffixText(item)}
									</span>
									<span className="slot-source">
										{item.weapon?.dps ? `${item.weapon.dps.toFixed(1)} DPS${stats ? ', ' : ''}` : ''}
										{stats || (item.weapon?.dps ? '' : 'No stats')}
									</span>
									<span className="slot-source">
										<SourceLabel source={source} data={data} item={item} />
										{effort && <span className="effort"> {effort}</span>}
									</span>
								</span>
								<span className={`num ${delta >= 0 ? 'delta-up' : 'delta-down'}`}>
									{formatDelta(delta)}
									{incomplete && (
										<span className="picker-note" title="Part of this item's worth is not in the score.">
											{' '}
											?
										</span>
									)}
								</span>
							</button>
						</li>
					);
				})}
			</ul>
			{matching.length === 0 && <p className="hint">Nothing fits. Try another name{all ? '' : ' or show all items'}.</p>}
			{matching.length > shown.length && (
				<p className="hint">
					Showing the best {shown.length} of {matching.length}. Search by name to find the rest.
				</p>
			)}
				</>
			)}
		</dialog>
	);
}
