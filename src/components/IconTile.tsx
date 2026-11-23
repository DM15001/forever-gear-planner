import { useState } from 'react';

import { ICON_SOURCES } from './ItemIcon';

interface Props {
	/** Game icon names to try in order; the first one that loads is shown, initials when none does. */
	icons: string[];
	label: string;
	active: boolean;
	disabled?: boolean;
	title?: string;
	onClick: () => void;
}

/** A choice shown as a game icon with its name under it. */
export function IconTile({ icons, label, active, disabled, title, onClick }: Props) {
	const [attempt, setAttempt] = useState(0);
	const total = icons.length * ICON_SOURCES.length;
	return (
		<button type="button" className={active ? 'fight-tile fight-tile-on' : 'fight-tile'} aria-pressed={active} disabled={disabled} title={title} onClick={onClick}>
			{attempt < total ? (
				<img src={ICON_SOURCES[attempt % ICON_SOURCES.length](icons[Math.floor(attempt / ICON_SOURCES.length)])} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} />
			) : (
				<span className="buff-letters">{label.replace(/[^A-Z]/g, '').slice(0, 2) || label.slice(0, 2)}</span>
			)}
			<span className="fight-tile-label">{label}</span>
		</button>
	);
}

/** The game's icon of each profession. */
export const PROFESSION_ICONS: Record<string, string[]> = {
	Alchemy: ['trade_alchemy'],
	Blacksmithing: ['trade_blacksmithing'],
	Enchanting: ['trade_engraving'],
	Engineering: ['trade_engineering'],
	Herbalism: ['trade_herbalism', 'spell_nature_naturetouchgrow'],
	Leatherworking: ['trade_leatherworking', 'inv_misc_armorkit_17'],
	Mining: ['trade_mining'],
	Skinning: ['inv_misc_pelt_wolf_01'],
	Tailoring: ['trade_tailoring'],
};

/** The race portraits, by the race's name in the specs. */
export const raceIcons = (name: string): string[] => {
	const key = name.toLowerCase().replace(/\s+/g, '');
	const scourge = key === 'undead' ? 'scourge' : key;
	return [`race_${scourge}_male`, `achievement_character_${key}_male`];
};
