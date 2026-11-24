import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { GEAR_SLOTS, SHEET_LAYOUT } from '../lib/constants';
import type { GameData } from '../lib/gameData';
import { formatDps, unit } from '../lib/format';
import { type Gear, plannedGear, scoreSet, slotInUse } from '../lib/scoring';
import { wowheadData, wowheadItemUrl } from '../lib/stats';
import type { Character, SpecConfig } from '../lib/types';
import { ItemIcon } from './ItemIcon';
import { Modal, SET_ITERATIONS, useSim } from './Sim';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
}

/** One small pane of gear at the side of the page, laid out like the in-game character pane: icons only, armor left, the rest right, weapons along the bottom. Wowhead tooltip on hover, the Wowhead page on click. */
function Rail({ kind, gear, other, spec, character, data, onOpen, onHide }: Props & { kind: 'equipped' | 'planned'; gear: Gear; /** The other set, to mark what differs. */ other: Gear; onOpen: () => void; onHide: () => void }) {
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
					<a href={wowheadItemUrl(item.id)} data-wowhead={wowheadData('item', item.id)} target="_blank" rel="noreferrer" aria-label={`${label}: ${item.name}`}>
						<ItemIcon icon={item.icon} quality={item.quality} small />
					</a>
				) : (
					<span title={`${label}: empty`}>
						<ItemIcon icon={undefined} quality={undefined} small />
					</span>
				)}
			</li>
		);
	};
	return (
		<aside className={`gear-rail gear-rail-${kind}`} aria-label={kind === 'equipped' ? 'Equipped gear' : 'Planned gear'}>
			<header className="gear-rail-head">
				<h2>{kind === 'equipped' ? 'Equipped' : 'Planned'}</h2>
				<button className="gear-rail-open" onClick={onOpen} title="Open the character panel" aria-label="Open the character panel">
					<svg viewBox="0 0 20 20" width="13" height="13" aria-hidden="true">
						<path d="M3 17l1-4L14 3l3 3L7 16z M12 5l3 3" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
					</svg>
				</button>
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
export function GearRails({ spec, character, data, showEquipped, showPlanned, onShow, sheet }: Props & { showEquipped: boolean; showPlanned: boolean; onShow: (kind: 'equipped' | 'planned', on: boolean) => void; /** The character panel, opened in a window from either pane; null while the page itself shows it. */ sheet: ReactNode | null }) {
	const planned = useMemo(() => plannedGear(character, data), [character, data]);
	const [open, setOpen] = useState(false);
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
						onOpen={() => (sheet ? setOpen(true) : window.scrollTo({ top: 0, behavior: 'smooth' }))}
						onHide={() => onShow(kind, false)}
					/>
				);
			})}
			{open && sheet && (
				<Modal title="Character" onClose={() => setOpen(false)} wide>
					<div className="sheet-in-window">{sheet}</div>
				</Modal>
			)}
		</>
	);
}
