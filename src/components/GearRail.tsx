import { useMemo, useState } from 'react';
import { GEAR_SLOTS, SHEET_LAYOUT } from '../lib/constants';
import type { GameData } from '../lib/gameData';
import { formatDps, unit } from '../lib/format';
import { applicableEnchants, EMPTY_SLOT, EVERYTHING, type Gear, plannedGear, scoreSet, slotInUse, type SourceFilter, withItem } from '../lib/scoring';
import { wowheadData, wowheadItemUrl } from '../lib/stats';
import type { Character, SpecConfig } from '../lib/types';
import { ItemIcon } from './ItemIcon';
import { ItemPicker } from './ItemPicker';
import { SET_ITERATIONS, useSim } from './Sim';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
}

/** One small pane of gear at the side of the page, laid out like the in-game character pane: icons only, armor left, the rest right, weapons along the bottom. Wowhead tooltip on hover, the Wowhead page on click. */
function Rail({ kind, gear, other, spec, character, data, onSlot, onHide }: Props & { kind: 'equipped' | 'planned'; gear: Gear; /** The other set, to mark what differs. */ other: Gear; /** A slot was clicked: open the window to change it. */ onSlot: (index: number) => void; onHide: () => void }) {
	const sim = useSim();
	const totals = useMemo(() => scoreSet(gear, character, data, spec), [gear, character, data, spec]);
	const base = useMemo(() => scoreSet(character.gear, character, data, spec), [character, data, spec]);
	const result = sim.result(gear, SET_ITERATIONS);
	const slot = (index: number) => {
		if (!slotInUse(index, spec)) return null;
		const piece = gear[index];
		const item = piece ? data.itemById.get(piece.id) : undefined;
		const changed = kind === 'planned' && piece?.id !== other[index]?.id;
		const label = GEAR_SLOTS[index].label;
		return (
			<li key={GEAR_SLOTS[index].key} className={changed ? 'gear-rail-item gear-rail-changed' : 'gear-rail-item'}>
				{item ? (
					// A link, so the Wowhead tooltip shows on hover; a plain click opens the choice for the slot instead of the page.
					<a
						href={wowheadItemUrl(item.id)}
						data-wowhead={wowheadData('item', item.id)}
						target="_blank"
						rel="noreferrer"
						aria-label={`${label}: ${item.name}. Change it`}
						onClick={event => {
							if (event.ctrlKey || event.metaKey || event.shiftKey) return;
							event.preventDefault();
							onSlot(index);
						}}>
						<ItemIcon icon={item.icon} quality={item.quality} small />
					</a>
				) : (
					<button className="gear-rail-slot" onClick={() => onSlot(index)} title={`${label}: empty. Choose an item`} aria-label={`${label}: empty. Choose an item`}>
						<ItemIcon icon={undefined} quality={undefined} small />
					</button>
				)}
			</li>
		);
	};
	return (
		<aside className={`gear-rail gear-rail-${kind}`} aria-label={kind === 'equipped' ? 'Equipped gear' : 'Planned gear'}>
			<header className="gear-rail-head">
				<h2>{kind === 'equipped' ? 'Equipped' : 'Planned'}</h2>
				<button className="gear-rail-open gear-rail-hide" onClick={onHide} title={`Hide the ${kind} gear`} aria-label={`Hide the ${kind} gear`}>
					<svg viewBox="0 0 18 18" width="11" height="11" aria-hidden="true">
						<path d="M3 3l12 12M15 3L3 15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
					</svg>
				</button>
			</header>
			<p className="gear-rail-facts">
				{result ? (
					<span>
						<strong className="num">{result.dps.toFixed(0)}</strong> {unit()}
					</span>
				) : kind === 'planned' ? (
					<span>{formatDps(totals.score - base.score)}</span>
				) : null}
				{spec.hitCapPercent > 0 && <span>{totals.hit.total.toFixed(1)}% hit</span>}
			</p>
			<div className="gear-rail-doll">
				<ul className="plain-list">{SHEET_LAYOUT.left.map(slot)}</ul>
				<ul className="plain-list">{SHEET_LAYOUT.right.map(slot)}</ul>
			</div>
			<ul className="plain-list gear-rail-weapons">{SHEET_LAYOUT.bottom.map(slot)}</ul>
		</aside>
	);
}

/** The equipped gear at the left edge of the page and the planned gear at the right one. They stay in view while the page scrolls; screens too narrow for them leave them out. */
export function GearRails({ spec, character, data, filter, onChange, showEquipped, showPlanned, onShow }: Props & { /** The character's content choice, for the list of planned items. */ filter: SourceFilter; onChange: (next: Character) => void; showEquipped: boolean; showPlanned: boolean; onShow: (kind: 'equipped' | 'planned', on: boolean) => void }) {
	const planned = useMemo(() => plannedGear(character, data), [character, data]);
	// The slot being changed, and in which of the two sets.
	const [picking, setPicking] = useState<{ kind: 'equipped' | 'planned'; index: number } | null>(null);
	const close = () => setPicking(null);
	/** An item for the equipped gear: a two-hander empties the off hand; an enchant stays only where it still fits. */
	const equip = (index: number, itemId: number | null) => {
		const gear = withItem(character.gear, index, itemId, data).map((piece, slot) => {
			if (!piece?.enchant) return piece;
			const item = data.itemById.get(piece.id);
			return item && applicableEnchants(slot, item, data).some(e => e.effectId === piece.enchant) ? piece : { id: piece.id };
		});
		onChange({ ...character, gear });
		close();
	};
	/** An item for the plan; planning what is already worn takes the slot out of the plan. */
	const plan = (index: number, itemId: number | null) => {
		const next = withItem(planned, index, itemId, data);
		const slots = { ...(character.plan ?? {}) };
		next.forEach((piece, slot) => {
			if (piece?.id === planned[slot]?.id) return;
			if (piece?.id === character.gear[slot]?.id) delete slots[slot];
			else slots[slot] = piece?.id ?? EMPTY_SLOT;
		});
		onChange({ ...character, plan: slots });
		close();
	};
	const enchant = (kind: 'equipped' | 'planned', index: number, effectId: number | null) => {
		if (kind === 'planned') onChange({ ...character, planEnchants: { ...(character.planEnchants ?? {}), [index]: effectId ?? 0 } });
		else {
			const piece = character.gear[index];
			if (piece) {
				const { enchant: _old, ...rest } = piece;
				onChange({ ...character, gear: character.gear.map((old, slot) => (slot === index ? (effectId ? { ...rest, enchant: effectId } : rest) : old)) });
			}
		}
		close();
	};
	return (
		<>
			{(['equipped', 'planned'] as const).map(kind => {
				const shown = kind === 'equipped' ? showEquipped : showPlanned;
				if (!shown) {
					return (
						<button key={kind} className={`gear-rail-show gear-rail-show-${kind}`} onClick={() => onShow(kind, true)}>
							Show {kind} gear
						</button>
					);
				}
				return (
					<Rail
						key={kind}
						kind={kind}
						gear={kind === 'equipped' ? character.gear : planned}
						other={kind === 'equipped' ? planned : character.gear}
						spec={spec}
						character={character}
						data={data}
						onSlot={index => setPicking({ kind, index })}
						onHide={() => onShow(kind, false)}
					/>
				);
			})}
			{picking && (
				<ItemPicker
					key={`${picking.kind}${picking.index}`}
					slotIndex={picking.index}
					gear={picking.kind === 'equipped' ? character.gear : planned}
					character={character}
					data={data}
					spec={spec}
					filter={picking.kind === 'equipped' ? EVERYTHING : filter}
					startWithAll={picking.kind === 'equipped'}
					allowEmpty
					onPick={id => (picking.kind === 'equipped' ? equip(picking.index, id) : plan(picking.index, id))}
					onEnchant={effectId => enchant(picking.kind, picking.index, effectId)}
					onClose={close}
				/>
			)}
		</>
	);
}
