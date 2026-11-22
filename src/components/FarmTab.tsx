import { useMemo, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { dungeonRanking, type FarmDungeon, PLAN_GROUP_ORDER, type PlanEntry, type PlanGroupKind, planShoppingList } from '../lib/farm';
import type { GameData } from '../lib/gameData';
import { guideMarks } from '../lib/guides';
import { effortLine, LOOT_DATE } from '../lib/loot';
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
	vendor: 'Vendors',
	rep: 'Reputation',
	world: 'World drops',
	pvp: 'PvP rewards',
	unknown: 'Source unknown',
};
const BOSS_DROPS_SHOWN = 4;

const formatPerRun = (value: number) => `+${value >= 10 ? Math.round(value) : value.toFixed(1)}`;
const formatDelta = (value: number) => `${value >= 0 ? '+' : '\u2212'}${Math.abs(Math.round(value)).toLocaleString('en')}`;

export function FarmTab({ spec, character, data, filter }: Props) {
	const options = useMemo(() => ({ character, data, spec, filter }), [character, data, spec, filter]);
	const shopping = useMemo(() => planShoppingList(options), [options]);
	const ranking = useMemo(() => dungeonRanking(options), [options]);
	const [open, setOpen] = useState<Set<string>>(new Set());
	// "total": everything there is to gain. "perRun": what one run is worth on average, from drop chances.
	const [order, setOrder] = useState<'total' | 'perRun'>('total');
	const ordered = useMemo(() => (order === 'perRun' ? [...ranking].sort((a, b) => b.perRun - a.perRun || b.value - a.value) : ranking), [ranking, order]);
	const lootDate = new Date(LOOT_DATE).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
	const marks = useMemo(() => guideMarks(data.guides), [data]);
	const planSize = [...shopping.values()].reduce((sum, list) => sum + list.length, 0);

	const toggle = (key: string) =>
		setOpen(old => {
			const next = new Set(old);
			if (!next.delete(key)) next.add(key);
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
										<ShoppingRow key={entry.item.id} entry={entry} data={data} guideSource={marks.get(entry.item.id)?.find(m => m.source)} />
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
					"Up to" is the best upgrade per slot over your equipped gear, added up. "Per run" is what one run is worth on average: each upgrade's gain times its chance to drop, best one per slot. Drop
					chances are Wowhead's numbers from {lootDate} and only exist for part of the items, so "per run" counts the known ones and is a lower bound. Bosses that are not there on every run are
					marked. Blackrock Spire, Dire Maul and Stratholme are split into their wings. Uses the content you picked on the Plan tab.
				</p>
				{ranking.length > 0 && (
					<p className="farm-order">
						Sort by{' '}
						<button className="button button-small" aria-pressed={order === 'total'} onClick={() => setOrder('total')}>
							Total gain
						</button>{' '}
						<button className="button button-small" aria-pressed={order === 'perRun'} onClick={() => setOrder('perRun')}>
							Gain per run
						</button>
					</p>
				)}
				{ranking.length === 0 && <p className="farm-empty">No dungeon drops would improve your equipped gear with the current filters.</p>}
				<ol className="dungeons">
					{ordered.map((dungeon, index) => (
						<DungeonCard key={dungeon.key} dungeon={dungeon} open={open.has(dungeon.key) || (index === 0 && open.size === 0)} onToggle={() => toggle(dungeon.key)} />
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

function ShoppingRow({ entry, data, guideSource }: { entry: PlanEntry; data: GameData; guideSource?: { source?: string; guide: { label: string } } }) {
	return (
		<li className="shopping-row">
			<span className="shopping-main">
				<ItemLink item={entry.item} />
				<span className="slot-source">
					{GEAR_SLOTS[entry.slotIndex].label}, {guideSource ? `${guideSource.source} (per ${guideSource.guide.label})` : sourceLine(entry.source, data)}
					{entry.source?.kind === 'crafted' && (entry.craftable ? ' (your profession)' : ' (not your profession)')}
					{!guideSource && effortLine(entry.source) && <span className="effort"> {effortLine(entry.source)}</span>}
				</span>
			</span>
			<span className={`num ${entry.delta >= 0 ? 'delta-up' : 'delta-down'}`}>{formatDelta(entry.delta)}</span>
		</li>
	);
}

function DungeonCard({ dungeon, open, onToggle }: { dungeon: FarmDungeon; open: boolean; onToggle: () => void }) {
	return (
		<li className="dungeon">
			<button className="dungeon-head" aria-expanded={open} onClick={onToggle}>
				<span className="dungeon-name">{dungeon.name}</span>
				<span className="dungeon-meta">
					{dungeon.upgradeCount} upgrade{dungeon.upgradeCount === 1 ? '' : 's'}
					{dungeon.plannedCount > 0 && <span className="dungeon-planned">, {dungeon.plannedCount} from your plan</span>}
				</span>
				<span className="dungeon-value num">
					up to {formatDelta(dungeon.value)}
					{dungeon.knownChances > 0 && (
						<span className="dungeon-per-run">
							{formatPerRun(dungeon.perRun)} per run{dungeon.knownChances < dungeon.upgradeCount ? ` (${dungeon.knownChances} of ${dungeon.upgradeCount} with drop chance)` : ''}
						</span>
					)}
				</span>
			</button>
			{open && (
				<div className="bosses">
					{dungeon.bosses.map(boss => (
						<div key={boss.name} className="boss">
							<h4>
								{boss.name}
								{boss.spawnChance !== undefined && (
									<span className="boss-spawn">
										{boss.spawnNote ?? 'Not always there'}, about 1 in {Math.round(1 / boss.spawnChance)} runs{boss.spawnBasis === 'estimate' ? ' (estimate)' : boss.spawnBasis === 'kills' ? ' (from kill counts)' : ''}
									</span>
								)}
							</h4>
							<ul className="plain-list">
								{boss.drops.slice(0, BOSS_DROPS_SHOWN).map(drop => (
									<li key={drop.item.id} className="boss-drop">
										<span className="num delta-up">{formatDelta(drop.delta)}</span>
										<span>
											<ItemLink item={drop.item} />
											<span className="slot-source"> {GEAR_SLOTS[drop.slotIndex].label}</span>
											{boss.sources.get(drop.item.id)?.dropChance !== undefined && <span className="effort"> {effortLine(boss.sources.get(drop.item.id))}</span>}
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
