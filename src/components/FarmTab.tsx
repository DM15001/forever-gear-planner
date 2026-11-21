import { useMemo, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { dungeonRanking, type FarmDungeon, PLAN_GROUP_ORDER, type PlanEntry, type PlanGroupKind, planShoppingList } from '../lib/farm';
import type { GameData } from '../lib/gameData';
import type { SourceFilter } from '../lib/scoring';
import { sourceLine, wowheadItemUrl } from '../lib/stats';
import type { Character, Item, SpecConfig } from '../lib/types';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
}

const GROUP_TITLES: Record<PlanGroupKind, string> = {
	dungeon: 'Dungeon drops',
	quest: 'Quests',
	crafted: 'Crafted',
	vendor: 'Vendors and reputation',
	world: 'World drops',
	pvp: 'PvP rewards',
	unknown: 'Source unknown',
};
const BOSS_DROPS_SHOWN = 4;

const formatDelta = (value: number) => `+${Math.round(value).toLocaleString('en')}`;

export function FarmTab({ spec, character, data, filter }: Props) {
	const options = useMemo(() => ({ character, data, spec, filter }), [character, data, spec, filter]);
	const shopping = useMemo(() => planShoppingList(options), [options]);
	const ranking = useMemo(() => dungeonRanking(options), [options]);
	const [open, setOpen] = useState<Set<number>>(new Set());
	const planSize = [...shopping.values()].reduce((sum, list) => sum + list.length, 0);

	const toggle = (zoneId: number) =>
		setOpen(old => {
			const next = new Set(old);
			if (!next.delete(zoneId)) next.add(zoneId);
			return next;
		});

	return (
		<div className="farm">
			<section aria-labelledby="farm-plan">
				<h2 id="farm-plan">How to get your plan</h2>
				{planSize === 0 ? (
					<p className="farm-empty">No plan yet. On the Upgrades tab, pick items with "Plan this" or use "Plan the best set". They show up here, sorted by where to get them.</p>
				) : (
					<div className="shopping">
						{PLAN_GROUP_ORDER.filter(kind => shopping.has(kind)).map(kind => (
							<div key={kind} className="shopping-group">
								<h3>{GROUP_TITLES[kind]}</h3>
								<ul className="plain-list">
									{shopping.get(kind)!.map(entry => (
										<ShoppingRow key={entry.item.id} entry={entry} data={data} />
									))}
								</ul>
							</div>
						))}
					</div>
				)}
			</section>

			<section aria-labelledby="farm-dungeons">
				<h2 id="farm-dungeons">Dungeons by upgrades</h2>
				<p className="hint farm-hint">
					Ranked by the best upgrade per slot over your equipped gear, added up. Drop chances are not in the data, so a high number means "a lot to gain here", not "quick to get". Uses the
					filters from the Upgrades tab.
				</p>
				{ranking.length === 0 && <p className="farm-empty">No dungeon drops would improve your equipped gear with the current filters.</p>}
				<ol className="dungeons">
					{ranking.map((dungeon, index) => (
						<DungeonCard key={dungeon.zone.id} dungeon={dungeon} open={open.has(dungeon.zone.id) || (index === 0 && open.size === 0)} onToggle={() => toggle(dungeon.zone.id)} />
					))}
				</ol>
			</section>
		</div>
	);
}

function ItemLink({ item }: { item: Item }) {
	return (
		<a className={`item-link quality-${item.quality}`} href={wowheadItemUrl(item.id)} target="_blank" rel="noreferrer">
			{item.name}
		</a>
	);
}

function ShoppingRow({ entry, data }: { entry: PlanEntry; data: GameData }) {
	return (
		<li className="shopping-row">
			<span className="shopping-main">
				<ItemLink item={entry.item} />
				<span className="slot-source">
					{GEAR_SLOTS[entry.slotIndex].label}, {sourceLine(entry.source, data)}
					{entry.source?.kind === 'crafted' && (entry.craftable ? ' (your profession)' : ' (not your profession)')}
				</span>
			</span>
			<span className="num delta-up">{formatDelta(entry.delta)}</span>
		</li>
	);
}

function DungeonCard({ dungeon, open, onToggle }: { dungeon: FarmDungeon; open: boolean; onToggle: () => void }) {
	return (
		<li className="dungeon">
			<button className="dungeon-head" aria-expanded={open} onClick={onToggle}>
				<span className="dungeon-name">{dungeon.zone.name}</span>
				<span className="dungeon-meta">
					{dungeon.upgradeCount} upgrade{dungeon.upgradeCount === 1 ? '' : 's'}
					{dungeon.plannedCount > 0 && <span className="dungeon-planned">, {dungeon.plannedCount} from your plan</span>}
				</span>
				<span className="dungeon-value num">up to {formatDelta(dungeon.value)}</span>
			</button>
			{open && (
				<div className="bosses">
					{dungeon.bosses.map(boss => (
						<div key={boss.name} className="boss">
							<h4>{boss.name}</h4>
							<ul className="plain-list">
								{boss.drops.slice(0, BOSS_DROPS_SHOWN).map(drop => (
									<li key={drop.item.id} className="boss-drop">
										<span className="num delta-up">{formatDelta(drop.delta)}</span>
										<span>
											<ItemLink item={drop.item} />
											<span className="slot-source"> {GEAR_SLOTS[drop.slotIndex].label}</span>
											{drop.planned && <span className="badge badge-plan">in your plan</span>}
										</span>
									</li>
								))}
							</ul>
							{boss.drops.length > BOSS_DROPS_SHOWN && <p className="slot-source">and {boss.drops.length - BOSS_DROPS_SHOWN} smaller upgrades</p>}
						</div>
					))}
				</div>
			)}
		</li>
	);
}
