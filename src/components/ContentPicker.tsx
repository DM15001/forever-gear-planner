import { useMemo } from 'react';

import { contentCatalog, presets, sameFilter, toggled } from '../lib/content';
import type { GameData } from '../lib/gameData';
import type { SourceFilter } from '../lib/scoring';
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
					<button key={preset.id} className="button button-small" aria-pressed={sameFilter({ ...filter, hiddenItems: [], randomSuffix: false, notYetAvailable: false }, preset.filter)} title={preset.hint} onClick={() => onChange({ ...preset.filter, hiddenItems: filter.hiddenItems, randomSuffix: filter.randomSuffix, notYetAvailable: filter.notYetAvailable })}>
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
						r.battleground ? `${r.name} (battleground)` : r.name,
						filter.rep && !filter.excludedReputations.includes(r.name),
						on => set({ excludedReputations: toggled(filter.excludedReputations, [r.name], on) }),
						!filter.rep,
					),
				)}
			</fieldset>

			<fieldset className="content-group">
				<legend>Everything else</legend>
				{spec.tier05Set && check(`Tier 0.5 questline (${spec.tier05Set.name})`, filter.tier05, on => set({ tier05: on }))}
				{check('Random-suffix items ("of Shadow Wrath"), best roll', filter.randomSuffix, on => set({ randomSuffix: on }))}
				{check('Items not in the game yet', filter.notYetAvailable, on => set({ notYetAvailable: on }))}
				{check('Quest rewards', filter.quest, on => set({ quest: on }))}
				{check('Crafted items', filter.crafted, on => set({ crafted: on }))}
				{check(`Only crafts from my professions${character.professions.length ? ` (${character.professions.join(', ')})` : ''}`, filter.crafted && filter.ownCraftsOnly, on => set({ ownCraftsOnly: on }), !filter.crafted)}
				{check('Currency vendors (Tarnished Undermine Reals)', filter.currency, on => set({ currency: on }))}
				{check('Other vendors', filter.vendor, on => set({ vendor: on }))}
				{check('World drops', filter.drop, on => set({ drop: on }))}
				{check('PvP rank rewards', filter.pvp, on => set({ pvp: on }))}
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
