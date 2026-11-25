import { type ReactNode, useMemo, useState } from 'react';

import { contentCatalog, presets, sameFilter, toggled } from '../lib/content';
import type { GameData } from '../lib/gameData';
import { type SourceFilter, TIER_SLOTS, tierSets, PVP_RANKS, usableSources } from '../lib/scoring';
import { unit } from '../lib/format';
import { pieceStats, statLine } from '../lib/stats';
import type { Character, Item, SpecConfig } from '../lib/types';
import DUNGEON_ICONS from '../config/dungeonIcons.json';
import { DungeonIcon, ItemIcon } from './ItemIcon';

const SLOT_NAMES: Record<string, string> = { head: 'Head', neck: 'Neck', shoulder: 'Shoulders', back: 'Back', chest: 'Chest', wrist: 'Wrists', hands: 'Hands', waist: 'Waist', legs: 'Legs', feet: 'Feet', finger: 'Ring', trinket: 'Trinket', weapon: 'Weapon', ranged: 'Ranged' };

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

/** The ordinary sources under "Everything else": the ones All on and All off switch. */
const OTHER_SOURCES = ['quest', 'crafted', 'drop', 'randomSuffix', 'currency', 'vendor'] as const;

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
		const pieces = new Map<number, { name: string; icon?: string; count: number; items: Item[] }>();
		for (const item of data.itemById.values()) {
			if (item.setId === undefined || !item.setName) continue;
			// The other faction's version of a set is not one this character can wear.
			if (item.faction && faction && item.faction !== faction) continue;
			const known = pieces.get(item.setId) ?? { name: item.setName, icon: item.icon, count: 0, items: [] };
			known.items.push(item);
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
			.map(([name, setIds]) => ({ name, setIds, items: pieces.get(setIds[0])!.items, icon: pieces.get(setIds[0])!.icon, note: steps(setIds.find(id => data.simValues.sets.has(id)) ?? setIds[0]), worth: Math.max(...setIds.map(worthOf)) }))
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
	const plainReputations = catalog.reputations.filter(r => !r.battleground).map(r => r.name);
	const battlegrounds = catalog.reputations.filter(r => r.battleground).map(r => r.name);
	// Which rows the visitor opened or shut by hand; the others follow what they hold.
	const [opened, setOpened] = useState<Record<string, boolean>>({});

	/**
	 * One kind of content as a row that folds: a line with what counts and two switches for all of it. Every row
	 * starts shut; opening it is for the finer choice.
	 */
	const group = (key: string, title: ReactNode, counted: number, of: number, allOn: (() => void) | null, allOff: (() => void) | null, children: ReactNode, extra = '', body = 'content-tiles') => {
		const everything = of > 0 && counted === of;
		const isOpen = opened[key] ?? false;
		return (
			<details className={`content-group content-fold-group ${extra}`} open={isOpen} onToggle={event => {
				const now = event.currentTarget.open; if (now !== isOpen) setOpened(before => ({ ...before, [key]: now }));
			}}>
				<summary>
					<span className="content-group-title">{title}</span>
					{of > 0 ? (
						<span className={`content-meter${everything ? ' content-meter-full' : counted === 0 ? ' content-meter-none' : ''}`} title={everything ? 'All of it counts' : counted === 0 ? 'None of it counts' : `${counted} of ${of} count`}>
							<span className="content-meter-text">
								<strong className="num">{counted}</strong>
								<span className="num">/{of}</span>
							</span>
							<span className="content-meter-bar" aria-hidden="true">
								<span style={{ width: `${(100 * counted) / of}%` }} />
							</span>
						</span>
					) : (
						<span />
					)}
					{allOn && allOff ? (
						<span className="content-switch" role="group" aria-label={`All of ${key}`}>
							<button
								type="button"
								aria-pressed={everything}
								onClick={event => {
									event.preventDefault();
									if (!everything) allOn();
								}}>
								All on
							</button>
							<button
								type="button"
								aria-pressed={counted === 0}
								onClick={event => {
									event.preventDefault();
									if (counted > 0) allOff();
								}}>
								All off
							</button>
						</span>
					) : (
						<span />
					)}
					<span className="content-group-toggle">
						{isOpen ? 'Hide' : 'Choose'}
						<span className="content-group-chevron" aria-hidden="true" />
					</span>
				</summary>
				<div className={body}>{children}</div>
			</details>
		);
	};

	return (
		<div className="content-picker">
			<div className="presets" role="group" aria-label="Presets">
				{options.map(preset => (
					<button key={preset.id} className="button content-preset" aria-pressed={sameFilter({ ...filter, hiddenItems: [], randomSuffix: true, notYetAvailable: false, unknownProcs: false }, preset.filter)} title={preset.hint} onClick={() => onChange({ ...preset.filter, hiddenItems: filter.hiddenItems, randomSuffix: filter.randomSuffix, notYetAvailable: filter.notYetAvailable, unknownProcs: filter.unknownProcs })}>
						{preset.label}
					</button>
				))}
				<button className="button content-preset" disabled title="Raid loot is not in the planner yet.">
					Dungeons and raids <span className="badge badge-plan">coming soon</span>
				</button>
			</div>

			{group(
				'dungeons',
				'Dungeons',
				catalog.dungeons.filter(d => !filter.excludedDungeons.includes(d.key)).length + (catalog.lowDungeonKeys.length > 0 && lowOn ? 1 : 0),
				catalog.dungeons.length + (catalog.lowDungeonKeys.length > 0 ? 1 : 0),
				() => set({ excludedDungeons: filter.excludedDungeons.filter(key => !allDungeonKeys.includes(key)) }),
				() => set({ excludedDungeons: [...new Set([...filter.excludedDungeons, ...allDungeonKeys])] }),
				<>
				<p className="hint tier-hint">
					Click a dungeon to count or leave out its loot.
				</p>
				{catalog.dungeons.map(d => tile(d.name, dungeonIcons(d.key), !filter.excludedDungeons.includes(d.key), on => set({ excludedDungeons: toggled(filter.excludedDungeons, [d.key], on) })))}
				{catalog.lowDungeonKeys.length > 0 && tile('Lower-level dungeons', ['achievement_boss_edwinvancleef', 'inv_misc_head_murloc_01'], lowOn, on => set({ excludedDungeons: toggled(filter.excludedDungeons, catalog.lowDungeonKeys, on) }), false, 'Deadmines to Maraudon')}
				</>,
			)}

			{group(
				'raids',
				<>
					Raids <span className="badge badge-plan">coming soon</span>
				</>,
				0,
				0,
				null,
				null,
				<>
				<p className="hint tier-hint">Raid loot is not in the planner yet. When it is, you switch the raids on here and they count everywhere: the plan, the single slots, the farm list and the group.</p>
				{RAIDS.map(([name, icon]) => tile(name, [icon], false, () => undefined, true, 'Coming soon'))}
				</>,
				'content-soon',
			)}

			{group(
				'reputations',
				'Reputations',
				filter.rep ? plainReputations.filter(name => !filter.excludedReputations.includes(name)).length : 0,
				plainReputations.length,
				() => set({ rep: true, excludedReputations: filter.excludedReputations.filter(name => !plainReputations.includes(name)) }),
				() => set({ rep: false }),
				<>
				{tile('Any reputation', ['inv_misc_note_02', 'inv_scroll_03'], filter.rep, on => set({ rep: on }), false, 'The switch for all of them')}
				{catalog.reputations
					.filter(r => !r.battleground)
					.map(r => tile(r.name, ['inv_misc_tournaments_banner_human', 'inv_scroll_03'], filter.rep && !filter.excludedReputations.includes(r.name), on => set({ excludedReputations: toggled(filter.excludedReputations, [r.name], on) }), !filter.rep))}
				</>,
			)}

			{tiers &&
				group(
					'tier',
					'Dungeon set pieces (Tier 0 and Tier 0.5)',
					filter.tierSlots.length + (filter.tier05 ? 1 : 0),
					TIER_SLOTS.length + 1,
					() => set({ tier05: true, tierSlots: TIER_SLOTS.map(([kind]) => kind) }),
					() => set({ tier05: false, tierSlots: [] }),
					<>
					<p className="hint tier-hint">
						Tick the slots that may hold a set piece. All ticked: the planner takes as many as are worth it. None ticked: no set piece at all.
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
					</>,
					'',
					'content-plain',
				)}

			{setChoices.length > 0 &&
				group(
					'sets',
					'Set bonuses to count',
					setChoices.filter(choice => choice.setIds.some(id => !filter.ignoredSets.includes(id))).length,
					setChoices.length,
					() => set({ ignoredSets: [] }),
					() => set({ ignoredSets: [...new Set([...filter.ignoredSets, ...setChoices.flatMap(choice => choice.setIds)])] }),
					<>
					<p className="hint tier-hint">
						The sets you can complete with the content switched on above and whose bonus is worth something for your build, best first. Switch one off and the planner stops aiming for it; its pieces can still come up as single items.
					</p>
					{setChoices.map(choice => (
						<div key={choice.name} className="set-tile">
							{tile(
								choice.name,
								choice.icon ? [choice.icon] : [],
								choice.setIds.some(id => !filter.ignoredSets.includes(id)),
								on => set({ ignoredSets: on ? filter.ignoredSets.filter(id => !choice.setIds.includes(id)) : [...new Set([...filter.ignoredSets, ...choice.setIds])] }),
								false,
								choice.note || undefined,
							)}
							<div className="set-pop" role="tooltip">
								<strong>{choice.name}</strong>
								{choice.note && <p className="set-pop-bonus">Bonus for your build, in total: {choice.note} {unit()}</p>}
								<ul className="plain-list">
									{choice.items.map(item => (
										<li key={item.id}>
											<ItemIcon icon={item.icon} quality={item.quality} inline />
											<span>
												<span className={`quality-${item.quality}`}>{item.name}</span>
												<span className="slot-source">
													{SLOT_NAMES[item.slot] ?? item.slot}: {statLine(pieceStats(item, { id: item.id }, data)) || 'no stats'}
												</span>
											</span>
										</li>
									))}
								</ul>
								<a href={`https://www.wowhead.com/forever/item-set=${choice.setIds[0]}`} target="_blank" rel="noreferrer">
									What the bonuses do, on Wowhead
								</a>
							</div>
						</div>
					))}
					</>,
				)}

			{group(
				'pvp',
				'PvP',
				filter.pvp ? 1 + battlegrounds.filter(name => !filter.excludedReputations.includes(name)).length : 0,
				1 + battlegrounds.length,
				() => set({ pvp: true, excludedReputations: filter.excludedReputations.filter(name => !battlegrounds.includes(name)) }),
				() => set({ pvp: false }),
				<>
				{tile('PvP', ['inv_bannerpvp_02', 'inv_bannerpvp_01'], filter.pvp, on => set({ pvp: on }), false, 'Rank rewards and battlegrounds')}
				{catalog.reputations
					.filter(r => r.battleground)
					.map(r => tile(r.name, ['inv_bannerpvp_01', 'inv_bannerpvp_02'], filter.pvp && !filter.excludedReputations.includes(r.name), on => set({ excludedReputations: toggled(filter.excludedReputations, [r.name], on) }), !filter.pvp, 'Battleground faction'))}
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
				</>,
			)}

			{group(
				'other',
				'Everything else',
				OTHER_SOURCES.filter(key => filter[key]).length,
				OTHER_SOURCES.length,
				() => set(Object.fromEntries(OTHER_SOURCES.map(key => [key, true]))),
				() => set(Object.fromEntries(OTHER_SOURCES.map(key => [key, false]))),
				<>
				<p className="hint tier-hint">All on and All off switch the six ordinary sources. "Only my professions" and the last three are special cases and stay as you set them.</p>
				{tile('Quest rewards', ['inv_scroll_03'], filter.quest, on => set({ quest: on }))}
				{tile('Crafted items', ['trade_blacksmithing'], filter.crafted, on => set({ crafted: on }))}
				{tile('Only my professions', ['trade_engineering', 'trade_blacksmithing'], filter.crafted && filter.ownCraftsOnly, on => set({ ownCraftsOnly: on }), !filter.crafted, character.professions.length ? character.professions.join(', ') : 'Crafts from your own professions only')}
				{tile('World drops', ['inv_misc_bag_08'], filter.drop, on => set({ drop: on }))}
				{tile('Random-suffix items', ['inv_jewelry_ring_03'], filter.randomSuffix, on => set({ randomSuffix: on }), false, '"of Shadow Wrath", best roll')}
				{tile('Currency vendors', ['inv_misc_coin_02', 'inv_misc_coin_01'], filter.currency, on => set({ currency: on }), false, 'Tarnished Undermine Reals')}
				{tile('Other vendors', ['inv_misc_coin_01'], filter.vendor, on => set({ vendor: on }))}
				{tile('Not in the game yet', ['inv_misc_pocketwatch_01'], filter.notYetAvailable, on => set({ notYetAvailable: on }), false, 'Later raids, events, closed content')}
				{tile('Procs unknown', ['spell_nature_lightning'], filter.unknownProcs, on => set({ unknownProcs: on }), false, 'The simulator overvalues them')}
				{tile('No known source', ['inv_misc_questionmark'], filter.unknown, on => set({ unknown: on }), false, 'Nobody knows where they drop')}
				</>,
			)}
			{!faction && <p className="field-error">Pick a race under "Check gear" to hide the other faction's items.</p>}
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
