import { useMemo } from 'react';

import { contentCatalog, presets, sameFilter, toggled } from '../lib/content';
import type { GameData } from '../lib/gameData';
import { type SourceFilter, TIER_SLOTS, tierSets } from '../lib/scoring';
import type { Character, SpecConfig } from '../lib/types';

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
		const names = new Map<number, string>();
		for (const item of data.itemById.values()) if (item.setId !== undefined && item.setName && !names.has(item.setId)) names.set(item.setId, item.setName);
		const ids = new Set([...data.simValues.sets.keys(), ...filter.ignoredSets]);
		return [...ids].filter(id => names.has(id)).map(setId => ({ setId, name: names.get(setId)! })).sort((x, y) => x.name.localeCompare(y.name));
	}, [data, filter.ignoredSets]);
	const lowOn = !catalog.lowDungeonKeys.some(key => filter.excludedDungeons.includes(key));

	const check = (label: string, checked: boolean, change: (on: boolean) => void, disabled = false) => (
		<label className={`check${disabled ? ' check-disabled' : ''}`} key={label}>
			<input type="checkbox" checked={checked} disabled={disabled} onChange={e => change(e.target.checked)} />
			{label}
		</label>
	);

	return (
		<div className="content-picker">
			<div className="presets" role="group" aria-label="Presets">
				{options.map(preset => (
					<button key={preset.id} className="button button-small" aria-pressed={sameFilter({ ...filter, hiddenItems: [], randomSuffix: true, notYetAvailable: false }, preset.filter)} title={preset.hint} onClick={() => onChange({ ...preset.filter, hiddenItems: filter.hiddenItems, randomSuffix: filter.randomSuffix, notYetAvailable: filter.notYetAvailable })}>
						{preset.label}
					</button>
				))}
			</div>

			<fieldset className="content-group">
				<legend>Dungeons</legend>
				{catalog.dungeons.map(d => check(d.name, !filter.excludedDungeons.includes(d.key), on => set({ excludedDungeons: toggled(filter.excludedDungeons, [d.key], on) })))}
				{catalog.lowDungeonKeys.length > 0 && check('Lower-level dungeons', lowOn, on => set({ excludedDungeons: toggled(filter.excludedDungeons, catalog.lowDungeonKeys, on) }))}
			</fieldset>

			<fieldset className="content-group">
				<legend>Reputations</legend>
				{check('Any reputation', filter.rep, on => set({ rep: on }))}
				{catalog.reputations.map(r =>
					check(
						r.battleground ? `${r.name} (battleground${filter.pvp ? '' : ', needs PvP switched on'})` : r.name,
						filter.rep && !filter.excludedReputations.includes(r.name) && (!r.battleground || filter.pvp),
						on => set({ excludedReputations: toggled(filter.excludedReputations, [r.name], on) }),
						!filter.rep || (r.battleground && !filter.pvp),
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
				<fieldset className="content-group">
					<legend>Set bonuses to count</legend>
					<p className="hint tier-hint">
						Untick a set and the planner stops aiming for its bonus. Its pieces can still be suggested as single items.{' '}
						<button className="link" onClick={() => set({ ignoredSets: [] })}>
							All
						</button>{' '}
						<button className="link" onClick={() => set({ ignoredSets: setChoices.map(choice => choice.setId) })}>
							None
						</button>
					</p>
					{setChoices.map(choice => check(choice.name, !filter.ignoredSets.includes(choice.setId), on => set({ ignoredSets: on ? filter.ignoredSets.filter(id => id !== choice.setId) : [...filter.ignoredSets, choice.setId] })))}
				</fieldset>
			)}

			<fieldset className="content-group">
				<legend>Everything else</legend>
				{check('Random-suffix items ("of Shadow Wrath"), best roll', filter.randomSuffix, on => set({ randomSuffix: on }))}
				{check('Items not in the game yet', filter.notYetAvailable, on => set({ notYetAvailable: on }))}
				{check('Quest rewards', filter.quest, on => set({ quest: on }))}
				{check('Crafted items', filter.crafted, on => set({ crafted: on }))}
				{check(`Only crafts from my professions${character.professions.length ? ` (${character.professions.join(', ')})` : ''}`, filter.crafted && filter.ownCraftsOnly, on => set({ ownCraftsOnly: on }), !filter.crafted)}
				{check('Currency vendors (Tarnished Undermine Reals)', filter.currency, on => set({ currency: on }))}
				{check('Other vendors', filter.vendor, on => set({ vendor: on }))}
				{check('World drops', filter.drop, on => set({ drop: on }))}
				{check('PvP: rank rewards and battlegrounds (their reputations and quests)', filter.pvp, on => set({ pvp: on }))}
				{check('Items with no known source', filter.unknown, on => set({ unknown: on }))}
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
