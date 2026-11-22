import encounterConfig from '../config/encounters.json';
import lootConfig from '../config/wowhead/loot.json';
import type { Faction, Item, ItemSource, Npc, Zone } from './types';

interface LootEntry {
	drops?: { npcId: number; count: number; outOf: number }[];
	containers?: { name: string; zoneId?: number; count: number; outOf: number }[];
	quests?: { questId: number; name: string; faction?: Faction }[];
	crafted?: { spellId: number; profession: string };
}
interface Encounter {
	chance: number;
	basis: 'mechanic' | 'kills' | 'estimate';
	note?: string;
}

const LOOT = lootConfig as unknown as { fetchedAt: string; items: Record<string, LootEntry>; npcs: Record<string, { name: string; zoneId?: number }> };
const ENCOUNTERS = encounterConfig as unknown as Record<string, Encounter | string>;

/** The day the Wowhead loot numbers were read. */
export const LOOT_DATE = LOOT.fetchedAt;

/**
 * Adds what Wowhead knows to the item data: drop chances on drops the data already has, sources
 * for items that had none, and a spawn chance on bosses that are not there on every run.
 */
export function applyLoot(itemById: Map<number, Item>, npcById: Map<number, Npc>, zoneById: Map<number, Zone>): void {
	for (const [id, npc] of Object.entries(LOOT.npcs)) {
		if (!npcById.has(Number(id))) npcById.set(Number(id), { id: Number(id), ...npc });
	}
	for (const [id, entry] of Object.entries(LOOT.items)) {
		const item = itemById.get(Number(id));
		if (!item) continue;
		if (!item.sources?.length) {
			const found = sourcesFrom(entry, npcById, zoneById);
			if (found.length) item.sources = found;
		}
		const sources = item.sources ?? [];
		for (const drop of entry.drops ?? []) {
			const source = sources.find(s => s.kind === 'drop' && s.npcId === drop.npcId);
			if (!source) continue;
			source.dropChance = drop.count / drop.outOf;
			source.dropSample = drop.outOf;
		}
		for (const box of entry.containers ?? []) {
			const source = sources.find(s => s.kind === 'drop' && !s.npcId && s.otherName?.trim() === box.name);
			if (!source) continue;
			source.dropChance = box.count / box.outOf;
			source.dropSample = box.outOf;
		}
	}
	for (const item of itemById.values()) {
		for (const source of item.sources ?? []) {
			if (source.kind !== 'drop') continue;
			const name = ((source.npcId ? npcById.get(source.npcId)?.name : undefined) ?? source.otherName ?? '').trim();
			const encounter = ENCOUNTERS[name];
			if (!encounter || typeof encounter === 'string') continue;
			source.spawnChance = encounter.chance;
			source.spawnBasis = encounter.basis;
			source.spawnNote = encounter.note;
		}
	}
}

/** Sources for an item the WoWSims data has none for. Drops under 1% are left out: nobody farms those on purpose. */
function sourcesFrom(entry: LootEntry, npcById: Map<number, Npc>, zoneById: Map<number, Zone>): ItemSource[] {
	const sources: ItemSource[] = [];
	for (const drop of entry.drops ?? []) {
		if (drop.count / drop.outOf < 0.01) continue;
		const zoneId = npcById.get(drop.npcId)?.zoneId;
		sources.push({ kind: 'drop', npcId: drop.npcId, zoneId, zoneKind: zoneId ? zoneById.get(zoneId)?.kind : undefined });
	}
	for (const box of entry.containers ?? []) {
		if (!box.zoneId || box.count / box.outOf < 0.01) continue;
		sources.push({ kind: 'drop', otherName: box.name, zoneId: box.zoneId, zoneKind: zoneById.get(box.zoneId)?.kind });
	}
	for (const quest of entry.quests ?? []) sources.push({ kind: 'quest', questId: quest.questId, name: quest.name, faction: quest.faction });
	if (entry.crafted) sources.push({ kind: 'crafted', profession: entry.crafted.profession, spellId: entry.crafted.spellId });
	// Only tiny chances from many creatures or chests: a random world drop, in practice an auction house item.
	if (!sources.length && (entry.drops?.length || entry.containers?.length)) sources.push({ kind: 'drop', otherName: 'World drop' });
	return sources;
}

/** Chance per run to see the item: its drop chance times the chance that the boss is there. Undefined without a known drop chance. */
export function runChance(source: ItemSource | undefined): number | undefined {
	if (!source || source.dropChance === undefined) return undefined;
	return source.dropChance * (source.spawnChance ?? 1);
}

const percent = (value: number) => (value >= 0.1 ? `${Math.round(value * 100)}%` : `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`);
const oneIn = (chance: number) => `1 in ${Math.max(1, Math.round(1 / chance))}`;

/** "20% drop, about 5 runs", with the spawn chance for bosses that are not always there. Undefined when nothing is known. */
export function effortLine(source: ItemSource | undefined): string | undefined {
	if (!source || source.kind !== 'drop') return undefined;
	const spawn = source.spawnChance !== undefined ? `boss there ${oneIn(source.spawnChance)} runs${source.spawnBasis === 'estimate' ? ' (estimate)' : ''}` : undefined;
	const chance = runChance(source);
	if (chance === undefined) return spawn;
	const runs = Math.max(1, Math.round(1 / chance));
	return [`${percent(source.dropChance!)} drop`, spawn, `about ${runs.toLocaleString('en')} run${runs === 1 ? '' : 's'}`].filter(Boolean).join(', ');
}
