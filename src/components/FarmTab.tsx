import { useMemo, useState } from 'react';

import { GEAR_SLOTS } from '../lib/constants';
import { formatDps } from '../lib/format';
import { byDungeon, dungeonRanking, type FarmDungeon, PLAN_GROUP_ORDER, type PlanEntry, type PlanGroupKind, planShoppingList } from '../lib/farm';
import type { GameData } from '../lib/gameData';
import { guideMarks } from '../lib/guides';
import { effortLine, effortParts, LOOT_DATE } from '../lib/loot';
import type { SourceFilter } from '../lib/scoring';
import { sourceLine, wowheadItemUrl } from '../lib/stats';
import type { Character, Item, SpecConfig } from '../lib/types';
import { ItemIcon } from './ItemIcon';
import { SuffixNote, suffixText } from './SuffixNote';
import { SourceSymbol } from './Ornaments';

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

const formatPerRun = (value: number) => `+${value >= 10 ? Math.round(value) : value.toFixed(value >= 1 ? 1 : 2)} DPS`;
const formatDelta = formatDps;

export function FarmTab({ spec, character, data, filter }: Props) {
	const options = useMemo(() => ({ character, data, spec, filter }), [character, data, spec, filter]);
	const shopping = useMemo(() => planShoppingList(options), [options]);
	const ranking = useMemo(() => dungeonRanking(options), [options]);
	const [open, setOpen] = useState<Set<string>>(new Set());
	// "total": everything there is to gain. "perRun": what one run is worth on average, from drop chances.
	const [order, setOrder] = useState<'total' | 'perRun'>('total');
	const ordered = useMemo(() => (order === 'perRun' ? [...ranking].sort((a, b) => b.perRun - a.perRun || b.value - a.value) : ranking), [ranking, order]);
	const lootDate = new Date(LOOT_DATE).toLocaleDateString('en-GB', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	});
	const marks = useMemo(() => guideMarks(data.guides), [data]);
	const planSize = [...shopping.values()].reduce((sum, list) => sum + list.length, 0);
	const [copied, setCopied] = useState<string | null>(null);
	/** The plan as plain text, for a chat message. */
	const copyPlan = () => {
		const lines = PLAN_GROUP_ORDER.filter(kind => shopping.has(kind)).flatMap(kind => [
			`${GROUP_TITLES[kind]}:`,
			...shopping.get(kind)!.map(entry => `- ${GEAR_SLOTS[entry.slotIndex].label}: ${entry.item.name}${suffixText(entry.item)} (${sourceLine(entry.source, data)}), ${formatDelta(entry.delta)}`),
		]);
		navigator.clipboard.writeText(lines.join('\n')).then(
			() => setCopied('Copied.'),
			() => setCopied('Copying failed.'),
		);
	};

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
					<>
						<p className="farm-copy">
							<button className="button button-small" onClick={copyPlan}>
								Copy the plan as text
							</button>{' '}
							{copied ?? 'For Discord or your notes.'}
						</p>
						<div className="shopping">
							{PLAN_GROUP_ORDER.filter(kind => shopping.has(kind)).map(kind => {
								const entries = shopping.get(kind)!;
								const cards = kind === 'dungeon' ? byDungeon(entries, zoneId => data.zoneById.get(zoneId)?.name) : [{ key: kind, name: '', entries }];
								return (
									<div key={kind} className={`shopping-group shopping-group-${kind}`}>
										<h3>
											<span>
												<SourceSymbol kind={kind} /> {GROUP_TITLES[kind]}
											</span>
											<span className="shopping-count">
												{entries.length} item{entries.length === 1 ? '' : 's'}
											</span>
										</h3>
										<div className="shopping-cards">
											{cards.map(card => (
												<div key={card.key} className="shopping-card">
													{card.name && (
														<h4>
															<span>
																<SourceSymbol kind="dungeon" /> {card.name}
															</span>
															<span className="num delta-up">{formatDelta(card.entries.reduce((sum, entry) => sum + entry.delta, 0))}</span>
														</h4>
													)}
													<ul className="plain-list">
														{card.entries.map(entry => (
															<ShoppingRow key={`${entry.slotIndex}-${entry.item.id}`} entry={entry} data={data} inDungeon={kind === 'dungeon'} guideSource={marks.get(entry.item.id)?.find(m => m.source)} />
														))}
													</ul>
												</div>
											))}
										</div>
									</div>
								);
							})}
							{[...shopping.values()].some(list => list.some(entry => entry.source?.kind === 'drop' && entry.source.dropBasis === 'classic')) && <p className="hint">* Drop chance from WoW Classic; Forever may have changed it.</p>}
						</div>
					</>
				)}
			</section>

			<section aria-labelledby="farm-dungeons">
				<h2 id="farm-dungeons">Dungeons by upgrades</h2>
				<p className="hint farm-hint">
					"Up to" is the best upgrade per slot over your equipped gear, added up. "Per run" is what one run is worth on average: each upgrade's gain times its chance to drop, best one per slot. Drop chances are Wowhead's Forever numbers
					from {lootDate} where we have them; the rest are the rates from WoW Classic (AtlasLoot), marked "Classic rate", which Forever may have changed. Items without any number are left out of "per run". Bosses that are not there on every
					run are marked. Blackrock Spire, Dire Maul and Stratholme are split into their wings. Uses the content you picked on the Plan tab.
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
			{suffixText(item)}
		</a>
	);
}

/** Where to get the item, without repeating the dungeon the row already sits under. */
function whereText(entry: PlanEntry, data: GameData, inDungeon: boolean): string {
	const source = entry.source;
	if (inDungeon && source?.kind === 'drop') {
		const boss = (source.npcId ? data.npcById.get(source.npcId)?.name : undefined) ?? source.otherName;
		return boss?.trim() || 'Any enemy in the dungeon';
	}
	return sourceLine(source, data);
}

function ShoppingRow({ entry, data, inDungeon, guideSource }: { entry: PlanEntry; data: GameData; inDungeon: boolean; guideSource?: { source?: string; guide: { label: string } } }) {
	const effort = guideSource ? {} : effortParts(entry.source);
	return (
		<li className="shopping-row" title={guideSource ? undefined : effortLine(entry.source)}>
			<ItemIcon icon={entry.item.icon} quality={entry.item.quality} small />
			<span className="shopping-main">
				<span className="shopping-name">
					<ItemLink item={entry.item} />
					<SuffixNote item={entry.item} />
				</span>
				<span className="shopping-where">
					<span className="shopping-slot">{GEAR_SLOTS[entry.slotIndex].label}</span>
					{guideSource ? `${guideSource.source} (per ${guideSource.guide.label})` : whereText(entry, data, inDungeon)}
					{entry.source?.kind === 'crafted' && (entry.craftable ? ' (your profession)' : ' (not your profession)')}
				</span>
			</span>
			<span className="shopping-numbers">
				<span className={`num shopping-gain ${entry.delta >= 0 ? 'delta-up' : 'delta-down'}`}>{formatDelta(entry.delta)}</span>
				{effort.chance && (
					<span className="shopping-effort">
						{effort.chance}, {effort.runs}
					</span>
				)}
			</span>
		</li>
	);
}

function DungeonCard({ dungeon, open, onToggle }: { dungeon: FarmDungeon; open: boolean; onToggle: () => void }) {
	return (
		<li className="dungeon">
			<button className="dungeon-head" aria-expanded={open} onClick={onToggle}>
				<span className="dungeon-name">
					<SourceSymbol kind="dungeon" /> {dungeon.name}
				</span>
				<span className="dungeon-meta">
					{dungeon.upgradeCount} upgrade{dungeon.upgradeCount === 1 ? '' : 's'}
					{dungeon.plannedCount > 0 && <span className="dungeon-planned">, {dungeon.plannedCount} from your plan</span>}
				</span>
				<span className="dungeon-value num">
					up to {formatDelta(dungeon.value)}
					{dungeon.knownChances > 0 && (
						<span className="dungeon-per-run">
							{formatPerRun(dungeon.perRun)} per run
							{dungeon.knownChances < dungeon.upgradeCount ? ` (${dungeon.knownChances} of ${dungeon.upgradeCount} with drop chance)` : ''}
						</span>
					)}
				</span>
			</button>
			{open && (
				<div className="bosses">
					{dungeon.bosses.map(boss => (
						<div key={boss.name} className="boss">
							<h4>
								<SourceSymbol kind="boss" /> {boss.name}
								{boss.spawnChance !== undefined && (
									<span className="boss-spawn">
										{boss.spawnNote ?? 'Not always there'}, about 1 in {Math.round(1 / boss.spawnChance)} runs
										{boss.spawnBasis === 'estimate' ? ' (estimate)' : boss.spawnBasis === 'kills' ? ' (from kill counts)' : ''}
									</span>
								)}
							</h4>
							<ul className="plain-list">
								{boss.drops.slice(0, BOSS_DROPS_SHOWN).map(drop => (
									<li key={drop.item.id} className="boss-drop">
										<span className="num delta-up">{formatDelta(drop.delta)}</span>
										<ItemIcon icon={drop.item.icon} quality={drop.item.quality} small />
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
