import type { Theme } from '../lib/theme';

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
