import { useState } from 'react';
import { Modal } from './Sim';

import { AREAS, FAMILIES, MOB_TYPES, spaced } from '../lib/stats';
import type { Character } from '../lib/types';
import { ICON_SOURCES } from './ItemIcon';

/** A game icon that stands for each enemy type, creature and terrain. A missing one falls back to initials. */
const ICONS: Record<string, string> = {
	Beast: 'ability_hunter_pet_wolf',
	Demon: 'spell_shadow_summonfelhunter',
	Dragonkin: 'inv_misc_head_dragon_01',
	Elemental: 'spell_fire_elemental_totem',
	Giant: 'ability_golemthunderclap',
	Humanoid: 'inv_misc_head_human_01',
	Mechanical: 'inv_misc_gear_01',
	Undead: 'spell_shadow_raisedead',
	Aquatic: 'inv_misc_fish_02',
	Dinosaur: 'ability_hunter_pet_raptor',
	Dwarf: 'inv_misc_head_dwarf_01',
	EarthElemental: 'spell_nature_earthelemental_totem',
	FireElemental: 'spell_fire_fire',
	Furbolg: 'ability_hunter_pet_bear',
	MountainGiant: 'spell_nature_earthquake',
	Murloc: 'inv_misc_head_murloc_01',
	Naga: 'inv_misc_monsterscales_02',
	Ogre: 'ability_warrior_warcry',
	Orc: 'inv_misc_head_orc_01',
	Plant: 'spell_nature_thorns',
	Satyr: 'spell_shadow_charm',
	Serpentine: 'ability_hunter_pet_windserpent',
	Swine: 'ability_hunter_pet_boar',
	Troll: 'inv_misc_head_troll_01',
	Wolf: 'ability_druid_demoralizingroar',
	Worgen: 'ability_hunter_pet_hyena',
	ForestGrassland: 'spell_nature_naturetouchgrow',
	Mountainous: 'inv_ore_iron_01',
	Snowy: 'spell_frost_frostnova',
	Desert: 'inv_misc_dust_02',
	Swamp: 'spell_nature_acid_01',
	Wasteland: 'spell_shadow_deathanddecay',
	Haunted: 'spell_shadow_possession',
	Cavernous: 'inv_misc_lantern_01',
	Volcanic: 'spell_fire_volcano',
	StrongholdsCities: 'inv_misc_key_03',
};

function Tile({ id, label, active, onClick }: { id: string; label: string; active: boolean; onClick: () => void }) {
	const [attempt, setAttempt] = useState(0);
	const icon = ICONS[id];
	return (
		<button className={active ? 'fight-tile fight-tile-on' : 'fight-tile'} aria-pressed={active} onClick={onClick} title={active ? `${label}: counted. Click to clear.` : `Count bonuses for ${label}`}>
			{icon && attempt < ICON_SOURCES.length ? <img src={ICON_SOURCES[attempt](icon)} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} /> : <span className="buff-letters">{label.replace(/[^A-Z]/g, '').slice(0, 2) || label.slice(0, 2)}</span>}
			<span className="fight-tile-label">{label}</span>
		</button>
	);
}

/** The picture of a chosen enemy or terrain on the encounter card; a plain mark while nothing is chosen. */
function PickIcon({ id }: { id: string | undefined }) {
	const [attempt, setAttempt] = useState(0);
	const icon = id ? ICONS[id] : undefined;
	return icon && attempt < ICON_SOURCES.length ? <img src={ICON_SOURCES[attempt](icon)} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} /> : <span className="fight-pick-any" aria-hidden="true">?</span>;
}

/** The enemy kind and terrain the character fights in. Some items are only strong against one of them. */
export function FightPicker({ character, onChange }: { character: Character; onChange: (next: Character) => void }) {
	const [open, setOpen] = useState(false);
	const fight = character.fight ?? {};
	const set = (patch: Partial<NonNullable<Character['fight']>>) => {
		const next = { ...fight, ...patch };
		onChange({ ...character, fight: next.mobType || next.area || next.family ? next : undefined });
	};
	const group = (title: string, options: [id: string, label: string][], current: string | undefined, pick: (id: string | undefined) => void) => (
		<fieldset className="fight-group">
			<legend>{title}</legend>
			<div className="fight-tiles">
				{options.map(([id, label]) => (
					<Tile key={id} id={id} label={label} active={current === id} onClick={() => pick(current === id ? undefined : id)} />
				))}
			</div>
		</fieldset>
	);
	const chosen = [fight.mobType, fight.family && spaced(fight.family), fight.area && AREAS.find(([key]) => key === fight.area)?.[1]].filter(Boolean).join(', ');
	return (
		<div className="fight-card">
			<div className="fight-card-text">
				<strong>What are you fighting?</strong>
				<span className="slot-source">Some items are only strong against one kind of enemy or in one terrain. Pick it and they count.</span>
			</div>
			<div className="fight-card-picks">
				{(
					[
						['Enemy', fight.mobType, fight.mobType],
						['Creature', fight.family, fight.family && spaced(fight.family)],
						['Terrain', fight.area, fight.area && AREAS.find(([key]) => key === fight.area)?.[1]],
					] as [string, string | undefined, string | undefined][]
				).map(([kind, id, label]) => (
					<button key={kind} className={id ? 'fight-pick fight-pick-on' : 'fight-pick'} onClick={() => setOpen(true)} title={`Choose the ${kind.toLowerCase()}`}>
						<PickIcon id={id} />
						<span>
							<span className="slot-source">{kind}</span>
							<strong>{label ?? 'Any'}</strong>
						</span>
					</button>
				))}
				{chosen && (
					<button className="link" onClick={() => onChange({ ...character, fight: undefined })}>
						Clear
					</button>
				)}
			</div>
			{open && (
				<Modal title="Encounter: enemy type and terrain" onClose={() => setOpen(false)} wide>
			<div className="fight-picker">
				{group(
					'Enemy type',
					MOB_TYPES.map(type => [type, type]),
					fight.mobType,
					id => set({ mobType: id }),
				)}
				{group(
					'Creature',
					FAMILIES.map(family => [family, spaced(family)]),
					fight.family,
					id => set({ family: id }),
				)}
				{group('Terrain', AREAS, fight.area, id => set({ area: id }))}
				<p className="hint">
					Some items only give their bonus against one kind of enemy ("+12 spell damage against Undead"), one creature (Orcs, Trolls) or in one kind of terrain. Click what you fight, for example Undead for Scholomance and
					Stratholme; click it again to clear it. Stat bonuses then count in the lists, the plan and the simulator; procs and on-use effects of that kind count in the simulator only.
				</p>
			</div>
				</Modal>
			)}
		</div>
	);
}
