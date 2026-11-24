import { allUpgrades } from './farm';
import { type CandidateOptions, EVERYTHING, usableSources } from './scoring';
import type { Character, Item } from './types';

/** One member of the group: a saved character with the build, data and content choice its own page would use. */
export interface GroupMember {
	/** Where the character sits in the saved list. */
	index: number;
	label: string;
	options: CandidateOptions;
}

/** Somebody who wants an item, and what it is worth to them. */
export interface GroupWant {
	member: GroupMember;
	slotIndex: number;
	/** Gain over what that character wears now, in its own unit (DPS, or HPS for a healer). */
	delta: number;
	/** False in the plan view for somebody who would gain from the item but did not plan it. */
	planned: boolean;
	/** True if nothing the game has is better for this character in that slot. */
	best: boolean;
}

export interface GroupItem {
	item: Item;
	/** Biggest gain first. */
	wants: GroupWant[];
}

export interface GroupDungeon {
	key: string;
	name: string;
	bosses: { name: string; items: GroupItem[] }[];
	/** How many of the group have something to gain here. */
	people: number;
	/** Per member the best item per slot, added up over the group: what the group can gain here at most. */
	total: number;
	/** The same per member, for the summary line. */
	perMember: Map<number, number>;
}

/** 'plan': only what each member put into their plan. 'any': every upgrade their content choice allows. */
export type GroupScope = 'plan' | 'any';

/**
 * What a group of characters has to gain per dungeon and boss, and who wants which drop.
 * A planned item counts whatever the member's content choice says: the plan is their own decision.
 */
export function groupFarm(members: GroupMember[], scope: GroupScope): GroupDungeon[] {
	const dungeons = new Map<string, { key: string; name: string; bosses: Map<string, Map<number, GroupItem>>; bestPerSlot: Map<number, Map<number, number>> }>();
	const open = { ...EVERYTHING, excludedDungeons: [] };
	// Per member the biggest gain there is in each slot, whatever the source: the item that reaches it is their best in slot.
	const bestBySlot = new Map<number, Map<number, number>>();
	const everything = new Map<number, ReturnType<typeof allUpgrades>>();
	for (const member of members) {
		const all = allUpgrades({ ...member.options, filter: open });
		everything.set(member.index, all);
		const slots = new Map<number, number>();
		for (const drop of all) slots.set(drop.slotIndex, Math.max(slots.get(drop.slotIndex) ?? 0, drop.delta));
		bestBySlot.set(member.index, slots);
	}
	const isBest = (member: GroupMember, slotIndex: number, delta: number) => delta > 0 && delta >= (bestBySlot.get(member.index)?.get(slotIndex) ?? Infinity) - 0.05;
	for (const member of members) {
		const { character, data, spec, filter } = member.options;
		const faction = spec.races.find(r => r.id === character.race)?.faction;
		// For the plan every source counts, so a planned item is never hidden by a filter.
		const upgrades = scope === 'plan' ? everything.get(member.index)! : allUpgrades(member.options);
		for (const drop of upgrades) {
			if (scope === 'plan' && !drop.planned) continue;
			for (const source of usableSources(drop.item, faction, scope === 'plan' ? { ...EVERYTHING, excludedDungeons: [] } : filter, character.professions)) {
				if (!source.dungeonKey || !source.zoneId) continue;
				const zone = data.zoneById.get(source.zoneId);
				if (!zone) continue;
				const bossName = ((source.npcId ? data.npcById.get(source.npcId)?.name : undefined) ?? source.otherName ?? 'Unknown').trim();
				const dungeon = dungeons.get(source.dungeonKey) ?? dungeons.set(source.dungeonKey, { key: source.dungeonKey, name: source.dungeonName ?? zone.name, bosses: new Map(), bestPerSlot: new Map() }).get(source.dungeonKey)!;
				const boss = dungeon.bosses.get(bossName) ?? dungeon.bosses.set(bossName, new Map()).get(bossName)!;
				const entry = boss.get(drop.item.id) ?? boss.set(drop.item.id, { item: drop.item, wants: [] }).get(drop.item.id)!;
				if (!entry.wants.some(want => want.member.index === member.index)) entry.wants.push({ member, slotIndex: drop.slotIndex, delta: drop.delta, planned: drop.planned, best: isBest(member, drop.slotIndex, drop.delta) });
				const slots = dungeon.bestPerSlot.get(member.index) ?? dungeon.bestPerSlot.set(member.index, new Map()).get(member.index)!;
				slots.set(drop.slotIndex, Math.max(slots.get(drop.slotIndex) ?? 0, drop.delta));
			}
		}
	}
	// In the plan view an item is listed because somebody planned it. Whoever else it would be an upgrade for is named too,
	// so the group sees who else might roll on it; their gain stays out of the totals.
	if (scope === 'plan') {
		for (const member of members) {
			const { character, spec } = member.options;
			const faction = spec.races.find(r => r.id === character.race)?.faction;
			for (const drop of everything.get(member.index)!) {
				if (drop.planned || drop.delta <= 0) continue;
				for (const source of usableSources(drop.item, faction, open, character.professions)) {
					if (!source.dungeonKey) continue;
					const bossName = ((source.npcId ? member.options.data.npcById.get(source.npcId)?.name : undefined) ?? source.otherName ?? 'Unknown').trim();
					const entry = dungeons.get(source.dungeonKey)?.bosses.get(bossName)?.get(drop.item.id);
					if (entry && !entry.wants.some(want => want.member.index === member.index)) entry.wants.push({ member, slotIndex: drop.slotIndex, delta: drop.delta, planned: false, best: isBest(member, drop.slotIndex, drop.delta) });
				}
			}
		}
	}
	const top = (item: GroupItem) => Math.max(...item.wants.map(want => want.delta));
	return [...dungeons.values()].map(({ key, name, bosses, bestPerSlot }) => {
		const perMember = new Map([...bestPerSlot].map(([index, slots]) => [index, [...slots.values()].reduce((sum, value) => sum + value, 0)]));
		return {
			key,
			name,
			bosses: [...bosses]
				.map(([bossName, items]) => ({ name: bossName, items: [...items.values()].map(item => ({ ...item, wants: [...item.wants].sort((a, b) => b.delta - a.delta) })).sort((a, b) => b.wants.length - a.wants.length || top(b) - top(a)) }))
				.sort((a, b) => Math.max(...b.items.map(top)) - Math.max(...a.items.map(top))),
			people: perMember.size,
			total: [...perMember.values()].reduce((sum, value) => sum + value, 0),
			perMember,
		};
	});
}

/** The dungeons in the order asked for: by what the group gains in total, or by how many of the group gain something. */
export const sortGroup = (dungeons: GroupDungeon[], by: 'total' | 'people'): GroupDungeon[] =>
	[...dungeons].sort((a, b) => (by === 'people' ? b.people - a.people || b.total - a.total : b.total - a.total || b.people - a.people));

/** The character with the item worn in that slot and taken out of the plan: it dropped. */
export function withDrop(character: Character, slotIndex: number, item: Item): Character {
	const { [slotIndex]: _done, ...plan } = character.plan ?? {};
	const { [slotIndex]: enchant, ...planEnchants } = character.planEnchants ?? {};
	const piece = { id: item.id, ...(item.bestSuffix ? { randomSuffix: item.bestSuffix } : {}), ...(enchant ? { enchant } : {}) };
	return { ...character, gear: character.gear.map((old, index) => (index === slotIndex ? piece : old)), plan, planEnchants };
}
