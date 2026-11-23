import { useMemo, useState } from 'react';
import { GEAR_SLOTS } from '../lib/constants';
import type { GameData } from '../lib/gameData';
import { formatDps, unit } from '../lib/format';
import { type Gear, plannedGear, scoreSet, slotInUse } from '../lib/scoring';
import { wowheadData, wowheadItemUrl } from '../lib/stats';
import type { Character, SpecConfig } from '../lib/types';
import { ItemIcon } from './ItemIcon';
import { BreakdownDialog, SET_ITERATIONS, useSim } from './Sim';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
}

/** One small column of gear at the side of the page: icon and name per slot, the Wowhead tooltip on hover, the Wowhead page on click. */
function Rail({ kind, gear, other, spec, character, data, onBreakdown }: Props & { kind: 'equipped' | 'planned'; gear: Gear; /** The other set, to mark what differs. */ other: Gear; onBreakdown: () => void }) {
	const sim = useSim();
	const totals = useMemo(() => scoreSet(gear, character, data, spec), [gear, character, data, spec]);
	const base = useMemo(() => scoreSet(character.gear, character, data, spec), [character, data, spec]);
	const result = sim.result(gear, SET_ITERATIONS);
	return (
		<aside className={`gear-rail gear-rail-${kind}`} aria-label={kind === 'equipped' ? 'Equipped gear' : 'Planned gear'}>
			<header className="gear-rail-head">
				<div>
					<h2>{kind === 'equipped' ? 'Equipped' : 'Planned'}</h2>
					<p className="gear-rail-number">
						{result ? (
							<>
								<strong className="num">{result.dps.toFixed(0)}</strong> {unit()}
							</>
						) : (
							<span className="slot-source">not simulated yet</span>
						)}
					</p>
				</div>
				<button className="gear-rail-open" onClick={onBreakdown} title={`Breakdown of the ${kind} gear`} aria-label={`Open the breakdown of the ${kind} gear`}>
					<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true">
						<path d="M4 16V9M10 16V4M16 16v-5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
					</svg>
				</button>
			</header>
			<p className="gear-rail-facts">
				{kind === 'planned' && <span>{formatDps(totals.score - base.score)} estimated</span>}
				{spec.hitCapPercent > 0 && (
					<span>
						{totals.hit.total.toFixed(1)}% hit of {totals.hit.cap}%
					</span>
				)}
			</p>
			<ul className="plain-list gear-rail-list">
				{GEAR_SLOTS.map((slot, index) => {
					if (!slotInUse(index, spec)) return null;
					const piece = gear[index];
					const item = piece ? data.itemById.get(piece.id) : undefined;
					const changed = kind === 'planned' && piece?.id !== other[index]?.id;
					return (
						<li key={slot.key} className={changed ? 'gear-rail-item gear-rail-changed' : 'gear-rail-item'}>
							{item ? (
								<a href={wowheadItemUrl(item.id)} data-wowhead={wowheadData('item', item.id)} target="_blank" rel="noreferrer" title={slot.label}>
									<ItemIcon icon={item.icon} quality={item.quality} small />
									<span className={`gear-rail-name quality-${item.quality}`}>{item.name}</span>
								</a>
							) : (
								<span className="gear-rail-empty">
									<ItemIcon icon={undefined} quality={undefined} small />
									<span className="gear-rail-name">{slot.label}: empty</span>
								</span>
							)}
						</li>
					);
				})}
			</ul>
		</aside>
	);
}

/** The equipped gear at the left edge of the page and the planned gear at the right one. They stay in view while the page scrolls; screens too narrow for them leave them out. */
export function GearRails({ spec, character, data }: Props) {
	const planned = useMemo(() => plannedGear(character, data), [character, data]);
	const hasPlan = Object.keys(character.plan ?? {}).length > 0 || Object.keys(character.planEnchants ?? {}).length > 0;
	const [open, setOpen] = useState<'equipped' | 'planned' | null>(null);
	return (
		<>
			<Rail kind="equipped" gear={character.gear} other={planned} spec={spec} character={character} data={data} onBreakdown={() => setOpen('equipped')} />
			<Rail kind="planned" gear={planned} other={character.gear} spec={spec} character={character} data={data} onBreakdown={() => setOpen('planned')} />
			{open && <BreakdownDialog equipped={character.gear} planned={planned} hasPlan={hasPlan} initial={open} onClose={() => setOpen(null)} />}
		</>
	);
}
