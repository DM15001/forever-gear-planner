import { useState } from 'react';

import { ICON_SOURCES } from './ItemIcon';

/**
 * Original ornaments drawn for this site. They follow the look of fantasy game interfaces but
 * copy no existing artwork: no faction crests and no logos.
 */

/** A pointed metal end piece that closes off one end of the tab bar. It points left; mirror it for the right end. */
export function BarCap({ mirrored = false }: { mirrored?: boolean }) {
	return (
		<svg className={`bar-cap${mirrored ? ' bar-cap-mirrored' : ''}`} viewBox="0 0 44 56" aria-hidden="true">
			<defs>
				<linearGradient id="cap-metal" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="var(--metal-light)" />
					<stop offset="0.45" stopColor="var(--brass)" />
					<stop offset="1" stopColor="var(--brass-deep)" />
				</linearGradient>
			</defs>
			<path className="cap-plate" d="M44 5 H24 L3 28 L24 51 H44 Z" />
			<path className="cap-field" d="M44 11 H27 L11.5 28 L27 45 H44 Z" />
			<path className="cap-plate" d="M29 19 L37 28 L29 37 L21 28 Z" />
		</svg>
	);
}

/** The mark next to the title. */
export function Emblem() {
	return (
		<svg className="emblem" viewBox="0 0 64 64" aria-hidden="true">
			<defs>
				<linearGradient id="emblem-metal" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="var(--metal-light)" />
					<stop offset="0.5" stopColor="var(--brass)" />
					<stop offset="1" stopColor="var(--brass-deep)" />
				</linearGradient>
			</defs>
			{/* an endless ring around an eight-pointed star */}
			<circle className="emblem-plate" cx="32" cy="32" r="30" />
			<circle className="emblem-field" cx="32" cy="32" r="24.5" />
			<path className="emblem-plate" d="M32 9 L36 26 L52 12 L38 28 L55 32 L38 36 L52 52 L36 38 L32 55 L28 38 L12 52 L26 36 L9 32 L26 28 L12 12 L28 26 Z" />
			<circle className="emblem-field" cx="32" cy="32" r="4.5" />
		</svg>
	);
}

/** Small line symbols for the ways to get an item, drawn for this project. */
const SOURCE_SYMBOLS: Record<string, string> = {
	// an arched gate
	dungeon: 'M5 21 V11 a7 7 0 0 1 14 0 V21 M5 21 H19 M9.5 21 V13 a2.5 2.5 0 0 1 5 0 V21',
	// an exclamation mark
	quest: 'M12 3 L13.5 14 H10.5 Z M12 18 a1.6 1.6 0 1 0 0.01 0',
	// a hammer
	crafted: 'M4 8 L9 3 L14 8 L12 10 L10.5 8.5 L9.5 9.5 L20 20 L18 22 L7.5 11.5 L6.5 12.5 Z',
	// a coin
	vendor: 'M12 4 a8 8 0 1 0 0.01 0 M12 8 V16 M9.5 10 h4 a1.5 1.5 0 0 1 0 3 h-3 a1.5 1.5 0 0 0 0 3 h4',
	// a banner on a pole
	rep: 'M6 3 V21 M6 4 H18 L15 8.5 L18 13 H6',
	// a globe
	world: 'M12 3 a9 9 0 1 0 0.01 0 M3 12 H21 M12 3 c-4 4 -4 14 0 18 M12 3 c4 4 4 14 0 18',
	// two crossed swords
	pvp: 'M4 4 L15 15 M15 15 L13 17 M15 15 L17 13 M16.5 16.5 L20 20 M20 4 L9 15 M9 15 L11 17 M9 15 L7 13 M7.5 16.5 L4 20',
	// a skull, for a boss
	boss: 'M6 11 a6 6 0 1 1 12 0 v3 l-2 1.5 V18 H8 v-2.5 L6 14 Z M9.5 11.5 a1 1 0 1 0 0.01 0 M14.5 11.5 a1 1 0 1 0 0.01 0 M11 18 v2 M13 18 v2',
	// a question mark
	unknown: 'M8.5 9 a3.5 3.5 0 1 1 5.5 2.9 c-1.2 0.9 -2 1.6 -2 3.1 M12 18.5 a1.2 1.2 0 1 0 0.01 0',
};

/** The game's own icon for each way to get an item, by icon name. */
const SOURCE_ICONS: Record<string, string> = {
	dungeon: 'inv_misc_key_03',
	boss: 'inv_misc_bone_humanskull_01',
	quest: 'inv_misc_note_01',
	crafted: 'trade_blacksmithing',
	vendor: 'inv_misc_coin_01',
	rep: 'inv_misc_token_argentdawn',
	world: 'inv_misc_map_01',
	pvp: 'inv_bannerpvp_01',
	unknown: 'inv_misc_questionmark',
};

/** A small game icon for a source. If no image loads, the drawn symbol takes its place. */
export function SourceSymbol({ kind }: { kind: string }) {
	const icon = SOURCE_ICONS[kind] ?? SOURCE_ICONS.unknown;
	const [index, setIndex] = useState(0);
	if (index < ICON_SOURCES.length) {
		return (
			<span className="source-icon" aria-hidden="true">
				<img src={ICON_SOURCES[index](icon)} alt="" loading="lazy" onError={() => setIndex(index + 1)} />
			</span>
		);
	}
	return (
		<svg className="source-symbol" viewBox="0 0 24 24" aria-hidden="true">
			<path d={SOURCE_SYMBOLS[kind] ?? SOURCE_SYMBOLS.unknown} />
		</svg>
	);
}
