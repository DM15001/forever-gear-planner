/**
 * The pictures on the "How thorough" buttons: training dummies on a practice yard, drawn for this site.
 * One dummy for the quick check, then two, three, and a row of four with one of them on fire.
 */
const PLACES: [x: number, scale: number][][] = [
	[[48, 1.25]],
	[
		[31, 1.1],
		[65, 1.1],
	],
	[
		[20, 0.95],
		[48, 0.95],
		[76, 0.95],
	],
	[
		[14, 0.82],
		[37, 0.82],
		[60, 0.82],
		[83, 0.82],
	],
];

export function DepthArt({ step }: { step: number }) {
	const id = `depth-art-${step}`;
	return (
		<svg className="depth-art" viewBox="0 0 96 72" aria-hidden="true">
			<defs>
				<linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#2a2233" />
					<stop offset="1" stopColor="#6b4a3a" />
				</linearGradient>
				<linearGradient id={`${id}-sack`} x1="0" y1="0" x2="1" y2="1">
					<stop offset="0" stopColor="#e2cfa0" />
					<stop offset="1" stopColor="#a8894f" />
				</linearGradient>
			</defs>
			<rect width="96" height="72" fill={`url(#${id}-sky)`} />
			{/* the yard: a palisade behind, packed earth in front */}
			<path d="M0 30 L4 26 L8 30 L12 26 L16 30 L20 26 L24 30 L28 26 L32 30 L36 26 L40 30 L44 26 L48 30 L52 26 L56 30 L60 26 L64 30 L68 26 L72 30 L76 26 L80 30 L84 26 L88 30 L92 26 L96 30 V50 H0 Z" fill="#3a2a1e" />
			<path d="M0 38 H96" stroke="#2a1d14" strokeWidth="1.500" />
			<path d="M0 50 H96 V72 H0 Z" fill="#6b5236" />
			<path d="M0 50 H96" stroke="#8a6b46" strokeWidth="1" />
			<path d="M8 64 h10 M40 68 h14 M70 62 h12 M24 58 h6" stroke="#57422b" strokeWidth="1" strokeLinecap="round" />
			{PLACES[step].map(([x, scale], i) => (
				<Dummy key={i} x={x} scale={scale} sack={`url(#${id}-sack)`} burning={step === 3 && i === 2} hits={step} />
			))}
		</svg>
	);
}

function Dummy({ x, scale, sack, burning, hits }: { x: number; scale: number; sack: string; burning: boolean; hits: number }) {
	return (
		<g transform={`translate(${x} 66) scale(${scale})`}>
			<ellipse cx="0" cy="0" rx="11" ry="2.500" fill="#000" opacity="0.35" />
			{/* post, foot and crossbar */}
			<path d="M0 -6 V0 M-8 0 H8" stroke="#6b4423" strokeWidth="3" strokeLinecap="round" />
			<path d="M-12 -27 H12" stroke="#6b4423" strokeWidth="3" strokeLinecap="round" />
			<path d="M-12 -27 l-2 3 M12 -27 l2 3" stroke="#d9c48f" strokeWidth="2.400" strokeLinecap="round" />
			{/* the stuffed sack, tied at the waist, a target painted on */}
			<path d="M-7 -32 Q-9 -18 -6 -6 H6 Q9 -18 7 -32 Z" fill={sack} stroke="#5a4420" strokeWidth="0.900" strokeLinejoin="round" />
			<path d="M-7 -14 Q0 -12 7 -14" fill="none" stroke="#5a4420" strokeWidth="1.200" />
			<circle cx="0" cy="-23" r="4.600" fill="#f4efe2" stroke="#b8402e" strokeWidth="1.300" />
			<circle cx="0" cy="-23" r="1.700" fill="#b8402e" />
			{/* the head: a sack with stitched eyes */}
			<circle cx="0" cy="-39" r="6.500" fill={sack} stroke="#5a4420" strokeWidth="0.900" />
			<path d="M-3.800 -41 l2.400 2.400 M-1.400 -41 l-2.400 2.400 M1.400 -41 l2.400 2.400 M3.800 -41 l-2.400 2.400" stroke="#3a2a14" strokeWidth="0.900" strokeLinecap="round" />
			<path d="M-2.500 -35.500 h5" stroke="#3a2a14" strokeWidth="0.900" strokeLinecap="round" strokeDasharray="1 1" />
			<path d="M-5 -33 Q0 -31.500 5 -33" fill="none" stroke="#7d5a2a" strokeWidth="1.300" />
			{/* the more thorough, the more it has been through: straw poking out, an arrow, a cut */}
			{hits >= 1 && <path d="M-6 -8 l-3 3 M-5 -7 l-1 4 M6 -30 l3 -3 M6 -29 l4 -1" stroke="#e9c85a" strokeWidth="0.800" strokeLinecap="round" />}
			{hits >= 2 && (
				<g>
					<path d="M2 -24 L15 -31" stroke="#8a6b46" strokeWidth="1" strokeLinecap="round" />
					<path d="M15 -31 l-1 3 M15 -31 l-3 0.500" stroke="#e8e2d2" strokeWidth="1" strokeLinecap="round" />
				</g>
			)}
			{hits >= 3 && <path d="M-6 -20 L-1 -15" stroke="#3a2a14" strokeWidth="1" strokeLinecap="round" />}
			{burning && (
				<g className="depth-fly">
					<path d="M-5 -43 q-6 -11 2 -18 q0 7 5 8 q6 5 1 11 q-4 3 -8 -1 Z" fill="#ff7a1a" />
					<path d="M-1.500 -44 q-3 -6 1.500 -10 q0 4 3 5 q2.500 3 0 5.500 Z" fill="#ffd100" />
					<circle cx="6" cy="-58" r="1" fill="#ffd100" />
					<circle cx="-7" cy="-55" r="0.800" fill="#ff7a1a" />
				</g>
			)}
		</g>
	);
}
