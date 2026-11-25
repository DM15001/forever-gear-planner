import { useMemo, useState } from 'react';

import { contentCatalog, presets, sameFilter, toggled } from '../lib/content';
import type { GameData } from '../lib/gameData';
import { type SourceFilter, TIER_SLOTS, tierSets, PVP_RANKS, usableSources } from '../lib/scoring';
import type { Character, SpecConfig } from '../lib/types';
import DUNGEON_ICONS from '../config/dungeonIcons.json';
import { DungeonIcon } from './ItemIcon';

/** The raids the planner will cover, with the game's own icon for each. Shown greyed out until their loot is in the data. */
const RAIDS: [name: string, icon: string][] = [
	['Molten Core', 'achievement_boss_ragnaros'],
	["Onyxia's Lair", 'achievement_boss_onyxia'],
	['Blackwing Lair', 'achievement_boss_nefarion'],
	["Zul'Gurub", 'achievement_boss_hakkar'],
	["Ruins of Ahn'Qiraj", 'achievement_boss_ossiriantheunscarred'],
	["Temple of Ahn'Qiraj", 'achievement_boss_cthun'],
	['Naxxramas', 'achievement_boss_kelthuzad_01'],
];

const FOLD_KEY = 'fgp.contentOpen';

/** Whether the content choice is open: it is, until somebody closes it; the browser remembers. */
export function useContentOpen(): [boolean, (open: boolean) => void] {
	const [open, setOpen] = useState(() => {
		try {
			return localStorage.getItem(FOLD_KEY) !== '0';
		} catch {
			return true;
		}
	});
	return [
		open,
		next => {
			setOpen(next);
			try {
				localStorage.setItem(FOLD_KEY, next ? '1' : '0');
			} catch {
				// Without storage it lasts until the page is closed.
			}
		},
	];
}

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
	onChange: (next: SourceFilter) => void;
}

/** "What content do you do?" Every source of gear as a switch, with presets on top. */
export function ContentPicker({ spec, character, data, filter, onChange }: Props) {
	const faction = spec.races.find(r => r.id === character.race)?.faction;
	const catalog = useMemo(() => contentCatalog(data, faction), [data, faction]);
	const options = useMemo(() => presets(catalog), [catalog]);
	const set = (patch: Partial<SourceFilter>) => onChange({ ...filter, ...patch });
	const tiers = tierSets(spec);
	// The sets whose bonuses are worth something for this build, by name; the ones already switched off stay listed.
	const setChoices = useMemo(() => {
		const mine = new Set([...character.gear.flatMap(piece => (piece ? [piece.id] : [])), ...Object.values(character.plan ?? {})]);
		const pieces = new Map<number, { name: string; icon?: string; count: number }>();
		for (const item of data.itemById.values()) {
			if (item.setId === undefined || !item.setName) continue;
			// The other faction's version of a set is not one this character can wear.
			if (item.faction && faction && item.faction !== faction) continue;
			const known = pieces.get(item.setId) ?? { name: item.setName, icon: item.icon, count: 0 };
			// A piece counts if you wear or plan it, or can get it with the content that is switched on.
			if (mine.has(item.id) || usableSources(item, faction, { ...filter, ignoredSets: [] }, character.professions).length > 0) known.count++;
			pieces.set(item.setId, known);
		}
		// The fewest pieces that give this build anything.
		const firstStep = (id: number) => Math.min(...[...(data.simValues.sets.get(id) ?? [])].filter(([, worth]) => worth > 0.05).map(([count]) => count), 99);
		const worthOf = (id: number) => Math.max(0, ...(data.simValues.sets.get(id)?.values() ?? []));
		const steps = (id: number) => {
			const byCount = data.simValues.sets.get(id);
			if (!byCount) return '';
			let last = 0;
			const parts: string[] = [];
			for (const count of [...byCount.keys()].sort((x, y) => x - y)) {
				const worth = byCount.get(count)!;
				if (Math.abs(worth - last) < 0.05) continue;
				last = worth;
				parts.push(`${count} pieces +${worth >= 10 ? worth.toFixed(0) : worth.toFixed(1)}`);
			}
			return parts.join(', ');
		};
		// Worth something for this build and enough pieces within reach for a bonus; what is already switched off stays listed.
		const ids = [...new Set([...data.simValues.sets.keys(), ...filter.ignoredSets])].filter(id => pieces.has(id) && (filter.ignoredSets.includes(id) || (worthOf(id) > 0.05 && pieces.get(id)!.count >= firstStep(id))));
		// Several sets can share a name (the two factions' versions of one PvP set): one tile stands for all of them.
		const byName = new Map<string, number[]>();
		for (const id of ids) byName.set(pieces.get(id)!.name, [...(byName.get(pieces.get(id)!.name) ?? []), id]);
		return [...byName]
			.map(([name, setIds]) => ({ name, setIds, icon: pieces.get(setIds[0])!.icon, note: steps(setIds.find(id => data.simValues.sets.has(id)) ?? setIds[0]), worth: Math.max(...setIds.map(worthOf)) }))
			.sort((x, y) => y.worth - x.worth || x.name.localeCompare(y.name));
	}, [data, filter, faction, character]);
	const lowOn = !catalog.lowDungeonKeys.some(key => filter.excludedDungeons.includes(key));

	const check = (label: string, checked: boolean, change: (on: boolean) => void, disabled = false) => (
		<label className={`check${disabled ? ' check-disabled' : ''}`} key={label}>
			<input type="checkbox" checked={checked} disabled={disabled} onChange={e => change(e.target.checked)} />
			{label}
		</label>
	);

	/** A switch you can see: picture, name, lit when it counts. */
	const tile = (label: string, icons: string[], on: boolean, change: (on: boolean) => void, disabled = false, note?: string) => (
		<button key={label} type="button" className={`content-tile${on ? ' content-tile-on' : ''}`} aria-pressed={on} disabled={disabled} onClick={() => change(!on)} title={disabled ? note : on ? `${label}: counted. Click to leave it out.` : `${label}: left out. Click to count it.`}>
			<DungeonIcon icons={icons} />
			<span className="content-tile-text">
				<strong>{label}</strong>
				{note && <span>{note}</span>}
			</span>
			<span className="content-tile-mark" aria-hidden="true">
				{on ? '✓' : ''}
			</span>
		</button>
	);
	const dungeonIcons = (key: string) => (DUNGEON_ICONS as unknown as Record<string, string[] | undefined>)[key.split(':')[0]] ?? [];
	const allDungeonKeys = [...catalog.dungeons.map(d => d.key), ...catalog.lowDungeonKeys];

	return (
		<div className="content-picker">
			<div className="presets" role="group" aria-label="Presets">
				{options.map(preset => (
					<button key={preset.id} className="button content-preset" aria-pressed={sameFilter({ ...filter, hiddenItems: [], randomSuffix: true, notYetAvailable: false, unknownProcs: false }, preset.filter)} title={preset.hint} onClick={() => onChange({ ...preset.filter, hiddenItems: filter.hiddenItems, randomSuffix: filter.randomSuffix, notYetAvailable: filter.notYetAvailable, unknownProcs: filter.unknownProcs })}>
						{preset.label}
					</button>
				))}
			</div>

			<fieldset className="content-group content-tiles">
				<legend>Dungeons</legend>
				<p className="hint tier-hint">
					Click a dungeon to count or leave out its loot.{' '}
					<button className="link" onClick={() => set({ excludedDungeons: filter.excludedDungeons.filter(key => !allDungeonKeys.includes(key)) })}>
						All
					</button>{' '}
					<button className="link" onClick={() => set({ excludedDungeons: [...new Set([...filter.excludedDungeons, ...allDungeonKeys])] })}>
						None
					</button>
				</p>
				{catalog.dungeons.map(d => tile(d.name, dungeonIcons(d.key), !filter.excludedDungeons.includes(d.key), on => set({ excludedDungeons: toggled(filter.excludedDungeons, [d.key], on) })))}
				{catalog.lowDungeonKeys.length > 0 && tile('Lower-level dungeons', ['achievement_boss_edwinvancleef', 'inv_misc_head_murloc_01'], lowOn, on => set({ excludedDungeons: toggled(filter.excludedDungeons, catalog.lowDungeonKeys, on) }), false, 'Deadmines to Maraudon')}
			</fieldset>

			<fieldset className="content-group content-tiles content-soon">
				<legend>
					Raids <span className="badge badge-plan">coming soon</span>
				</legend>
				<p className="hint tier-hint">Raid loot is not in the planner yet. When it is, you switch the raids on here and they count everywhere: Upgrades, Farm plan and Group plan.</p>
				{RAIDS.map(([name, icon]) => tile(name, [icon], false, () => undefined, true, 'Coming soon'))}
			</fieldset>

			<fieldset className="content-group content-tiles">
				<legend>Reputations</legend>
				{tile('Any reputation', ['inv_misc_note_02', 'inv_scroll_03'], filter.rep, on => set({ rep: on }), false, 'The switch for all of them')}
				{catalog.reputations.map(r =>
					tile(
						r.name,
						r.battleground ? ['inv_bannerpvp_02', 'inv_bannerpvp_01'] : ['inv_misc_tournaments_banner_human', 'inv_scroll_03'],
						filter.rep && !filter.excludedReputations.includes(r.name) && (!r.battleground || filter.pvp),
						on => set({ excludedReputations: toggled(filter.excludedReputations, [r.name], on) }),
						!filter.rep || (r.battleground && !filter.pvp),
						r.battleground ? (filter.pvp ? 'Battleground' : 'Battleground: needs PvP switched on') : undefined,
					),
				)}
			</fieldset>

			{tiers && (
				<fieldset className="content-group">
					<legend>Dungeon set pieces (Tier 0 and Tier 0.5)</legend>
					<p className="hint tier-hint">
						Tick the slots that may hold a set piece. All ticked: the planner takes as many as are worth it. None ticked: no set piece at all.{' '}
						<button className="link" onClick={() => set({ tierSlots: TIER_SLOTS.map(([kind]) => kind) })}>
							All
						</button>{' '}
						<button className="link" onClick={() => set({ tierSlots: [] })}>
							None
						</button>
					</p>
					<label className="field-label tier-minimum">
						How many set pieces
						<select value={filter.tierMinimum} onChange={e => set({ tierMinimum: Number(e.target.value) })}>
							<option value={0}>Whatever is best</option>
							{[2, 3, 4, 6, 8].map(n => (
								<option key={n} value={n} disabled={filter.tierSlots.length < n}>
									At least {n} of one set
								</option>
							))}
						</select>
					</label>
					{check('I do the Tier 0.5 questline (the upgraded dungeon set)', filter.tier05, on => set({ tier05: on }))}
					{TIER_SLOTS.map(([kind, label]) => check(`${label} (set piece)`, filter.tierSlots.includes(kind), on => set({ tierSlots: on ? [...filter.tierSlots, kind] : filter.tierSlots.filter(slot => slot !== kind) })))}
				</fieldset>
			)}

			{setChoices.length > 0 && (
				<fieldset className="content-group content-tiles">
					<legend>Set bonuses to count</legend>
					<p className="hint tier-hint">
						The sets you can complete with the content switched on above and whose bonus is worth something for your build, best first. Switch one off and the planner stops aiming for it; its pieces can still come up as single items.{' '}
						<button className="link" onClick={() => set({ ignoredSets: [] })}>
							All
						</button>{' '}
						<button className="link" onClick={() => set({ ignoredSets: [...new Set([...filter.ignoredSets, ...setChoices.flatMap(choice => choice.setIds)])] })}>
							None
						</button>
					</p>
					{setChoices.map(choice =>
						tile(
							choice.name,
							choice.icon ? [choice.icon] : [],
							choice.setIds.some(id => !filter.ignoredSets.includes(id)),
							on => set({ ignoredSets: on ? filter.ignoredSets.filter(id => !choice.setIds.includes(id)) : [...new Set([...filter.ignoredSets, ...choice.setIds])] }),
							false,
							choice.note || undefined,
						),
					)}
				</fieldset>
			)}

			<fieldset className="content-group content-tiles">
				<legend>Everything else</legend>
				{tile('Quest rewards', ['inv_scroll_03'], filter.quest, on => set({ quest: on }))}
				{tile('Crafted items', ['trade_blacksmithing'], filter.crafted, on => set({ crafted: on }))}
				{tile('Only my professions', ['trade_engineering', 'trade_blacksmithing'], filter.crafted && filter.ownCraftsOnly, on => set({ ownCraftsOnly: on }), !filter.crafted, character.professions.length ? character.professions.join(', ') : 'Crafts from your own professions only')}
				{tile('World drops', ['inv_misc_bag_08'], filter.drop, on => set({ drop: on }))}
				{tile('Random-suffix items', ['inv_jewelry_ring_03'], filter.randomSuffix, on => set({ randomSuffix: on }), false, '"of Shadow Wrath", best roll')}
				{tile('Currency vendors', ['inv_misc_coin_02', 'inv_misc_coin_01'], filter.currency, on => set({ currency: on }), false, 'Tarnished Undermine Reals')}
				{tile('Other vendors', ['inv_misc_coin_01'], filter.vendor, on => set({ vendor: on }))}
				{tile('PvP', ['inv_bannerpvp_02', 'inv_bannerpvp_01'], filter.pvp, on => set({ pvp: on }), false, 'Rank rewards and battlegrounds')}
				{tile('Not in the game yet', ['inv_misc_pocketwatch_01'], filter.notYetAvailable, on => set({ notYetAvailable: on }), false, 'Later raids, events, closed content')}
				{tile('Procs unknown', ['spell_nature_lightning'], filter.unknownProcs, on => set({ unknownProcs: on }), false, 'The simulator overvalues them')}
				{tile('No known source', ['inv_misc_questionmark'], filter.unknown, on => set({ unknown: on }), false, 'Nobody knows where they drop')}
				{filter.pvp && (
					<label className="tier-minimum content-wide">
						Highest honor rank you will reach
						<select value={filter.pvpMaxRank ?? 14} onChange={e => set({ pvpMaxRank: Number(e.target.value) })}>
							{PVP_RANKS.filter(([rank]) => rank >= 3).map(([rank, alliance, horde]) => (
								<option key={rank} value={rank}>
									Rank {rank}: {alliance === horde ? alliance : `${alliance} / ${horde}`}
									{rank === 14 ? ' (all rank rewards)' : ''}
								</option>
							))}
							<option value={0}>No rank rewards, battlegrounds only</option>
						</select>
						<span className="slot-source">Rewards of a higher rank are left out. Battleground reputations and quests stay in.</span>
					</label>
				)}
			</fieldset>
			{!faction && <p className="field-error">Pick a race on the Character tab to hide the other faction's items.</p>}
			{filter.hiddenItems.length > 0 && (
				<fieldset className="content-group hidden-items">
					<legend>Items you have hidden</legend>
					{filter.hiddenItems.map(id => (
						<button key={id} className="button button-small" title="Show this item again" onClick={() => set({ hiddenItems: filter.hiddenItems.filter(hidden => hidden !== id) })}>
							{data.itemById.get(id)?.name ?? `Item ${id}`} ×
						</button>
					))}
				</fieldset>
			)}
		</div>
	);
}
