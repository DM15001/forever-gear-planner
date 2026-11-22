
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
