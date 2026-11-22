import type { Theme } from '../lib/theme';

/**
 * Original ornaments drawn for this site. They follow the look of fantasy game interfaces but
 * copy no existing artwork: no faction crests, no logos, no creatures from the game's own UI.
 */

/** A dragon head in profile that closes off one end of the tab bar. It faces left; mirror it for the right end. */
export function DragonCap({ mirrored = false }: { mirrored?: boolean }) {
	return (
		<svg className={`dragon-cap${mirrored ? ' dragon-cap-mirrored' : ''}`} viewBox="0 0 100 64" aria-hidden="true">
			<defs>
				<linearGradient id="dragon-metal" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="var(--metal-light)" />
					<stop offset="0.45" stopColor="var(--brass)" />
					<stop offset="1" stopColor="var(--brass-deep)" />
				</linearGradient>
			</defs>
			{/* horns sweeping back, and the fins behind the jaw */}
			<path className="dragon-back" d="M56 15 L97 1 L82 13 L99 12 L74 27 Z" />
			<path className="dragon-back" d="M70 29 L98 25 L84 33 L96 38 L72 40 Z" />
			<path className="dragon-back" d="M68 43 L90 46 L78 50 L86 59 L62 54 Z" />
			{/* lower jaw */}
			<path className="dragon-head" d="M13 43 L31 43 L50 44 L61 41 L70 45 L63 55 L45 56 L27 51 Z" />
			{/* skull and upper jaw */}
			<path className="dragon-head" d="M2 35 L7 28 L21 26 L33 17 L46 11 L61 13 L75 28 L71 45 L60 40 L50 38 L10 38 Z" />
			{/* facets that give the skull its planes */}
			<path className="dragon-shade" d="M21 26 L50 38 L10 38 L7 30 Z" />
			<path className="dragon-shade" d="M61 13 L75 28 L71 45 L60 40 L62 26 Z" />
			{/* teeth */}
			<path className="dragon-teeth" d="M11 38 L14 45 L17 38 Z M21 38 L24 44 L27 38 Z M31 38 L33.5 43 L36 38 Z M41 38 L43 42 L45 38 Z M18 43 L21 38.5 L24 43 Z M28 43 L30.5 39 L33 43 Z M37 43.3 L39 40 L41 43.5 Z" />
			{/* brow, eye and nostril */}
			<path className="dragon-brow" d="M33 17 L46 17 L57 22 L46 20 L36 21 Z" />
			<path className="dragon-eye" d="M39 22 L50 21 L54 26 L43 27 Z" />
			<path className="dragon-dark" d="M46 21.6 L48.5 21.4 L48 26.4 L45.8 26.6 Z" />
			<path className="dragon-dark" d="M7 31 L11 30 L10 33 Z" />
		</svg>
	);
}

/** The mark next to the title: one per look. */
export function Emblem({ theme }: { theme: Theme }) {
	return (
		<svg className="emblem" viewBox="0 0 64 64" aria-hidden="true">
			<defs>
				<linearGradient id="emblem-metal" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="var(--metal-light)" />
					<stop offset="0.5" stopColor="var(--brass)" />
					<stop offset="1" stopColor="var(--brass-deep)" />
				</linearGradient>
			</defs>
			{theme === 'alliance' && (
				<>
					{/* a kite shield with an upright sword between two stars */}
					<path className="emblem-plate" d="M32 4 L56 11 V30 C56 45 46 55 32 61 C18 55 8 45 8 30 V11 Z" />
					<path className="emblem-field" d="M32 9 L51 14.5 V30 C51 42 43 50.5 32 55.5 C21 50.5 13 42 13 30 V14.5 Z" />
					<path className="emblem-plate" d="M30.5 14 H33.5 V38 H40 V41.5 H33.5 V49 L32 51 L30.5 49 V41.5 H24 V38 H30.5 Z" />
					<path className="emblem-plate" d="M20 22 l1.6 3.3 3.6.5 -2.6 2.5 .6 3.6 -3.2 -1.7 -3.2 1.7 .6 -3.6 -2.6 -2.5 3.6 -.5z M44 22 l1.6 3.3 3.6.5 -2.6 2.5 .6 3.6 -3.2 -1.7 -3.2 1.7 .6 -3.6 -2.6 -2.5 3.6 -.5z" />
				</>
			)}
			{theme === 'horde' && (
				<>
					{/* a spiked war shield with two crossed axes */}
					<path
						className="emblem-plate"
						d="M32 1 L37 11 L47 5 L46 16 L58 15 L52 25 L63 32 L52 39 L58 49 L46 48 L47 59 L37 53 L32 63 L27 53 L17 59 L18 48 L6 49 L12 39 L1 32 L12 25 L6 15 L18 16 L17 5 L27 11 Z"
					/>
					<circle className="emblem-field" cx="32" cy="32" r="19" />
					<path className="emblem-plate" d="M20 46 L41 23 L43.5 25.5 L22.5 48.5 Z M44 46 L23 23 L20.5 25.5 L41.5 48.5 Z" />
					<path className="emblem-plate" d="M38 18 C44 16 49 19 50 25 C46 24 43 25 41 28 Z M26 18 C20 16 15 19 14 25 C18 24 21 25 23 28 Z" />
				</>
			)}
			{theme === 'forever' && (
				<>
					{/* an endless ring around an eight-pointed star */}
					<circle className="emblem-plate" cx="32" cy="32" r="30" />
					<circle className="emblem-field" cx="32" cy="32" r="24.5" />
					<path className="emblem-plate" d="M32 9 L36 26 L52 12 L38 28 L55 32 L38 36 L52 52 L36 38 L32 55 L28 38 L12 52 L26 36 L9 32 L26 28 L12 12 L28 26 Z" />
					<circle className="emblem-field" cx="32" cy="32" r="4.5" />
				</>
			)}
		</svg>
	);
}
