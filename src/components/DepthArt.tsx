/**
 * The pictures on the "How thorough" buttons: a small mudskipper goblin on a mossy riverbank at dusk, drawn for this
 * site. Olive-brown with pale yellow speckles, a wide flat head with bead eyes far apart, a reed sash full of pebbles
 * and bottle caps, a crooked driftwood stick. One scene per step: it hurries past, it looks, it studies a pebble,
 * it sits among everything it has turned over.
 */
export function DepthArt({ step }: { step: number }) {
	const id = `depth-art-${step}`;
	// Fireflies: more of them the longer the evening gets.
	const flies = [
		[14, 14],
		[80, 10],
		[60, 24],
		[26, 30],
		[88, 34],
		[44, 8],
	].slice(0, 2 + step);
	return (
		<svg className="depth-art" viewBox="0 0 96 72" aria-hidden="true">
			<defs>
				<linearGradient id={`${id}-sky`} x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#2b2a55" />
					<stop offset="0.55" stopColor="#8a5a6e" />
					<stop offset="1" stopColor="#f0b070" />
				</linearGradient>
				<radialGradient id={`${id}-skin`} cx="0.4" cy="0.3" r="0.9">
					<stop offset="0" stopColor="#9a8f52" />
					<stop offset="0.6" stopColor="#6f6a3a" />
					<stop offset="1" stopColor="#4a4526" />
				</radialGradient>
				{/* Soft, uneven edges, as watercolour has them. */}
				<filter id={`${id}-wash`} x="-5%" y="-5%" width="110%" height="110%">
					<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed={step + 3} result="n" />
					<feDisplacementMap in="SourceGraphic" in2="n" scale="1.6" />
				</filter>
				<filter id={`${id}-glow`} x="-100%" y="-100%" width="300%" height="300%">
					<feGaussianBlur stdDeviation="1.6" />
				</filter>
			</defs>
			<g filter={`url(#${id}-wash)`}>
				<rect width="96" height="72" fill={`url(#${id}-sky)`} />
				{/* far bank and water */}
				<path d="M0 44 Q24 38 48 43 T96 41 V72 H0 Z" fill="#3d4a5c" opacity="0.75" />
				<path d="M0 50 H96 V72 H0 Z" fill="#5b6f86" opacity="0.6" />
				<path d="M6 56 h14 M54 54 h18 M30 60 h10 M70 62 h14" stroke="#f6d6a0" strokeWidth="0.8" strokeLinecap="round" opacity="0.6" />
				{/* cattails */}
				<path d="M8 66 Q9 44 6 28 M14 66 Q14 48 17 34 M86 66 Q85 46 89 30 M80 66 Q81 52 78 40" fill="none" stroke="#3f5a2c" strokeWidth="1.4" strokeLinecap="round" />
				<rect x="4.500" y="24" width="3.200" height="9" rx="1.600" fill="#5a3a22" />
				<rect x="15.500" y="30" width="3.200" height="8" rx="1.600" fill="#5a3a22" />
				<rect x="87.500" y="26" width="3.200" height="9" rx="1.600" fill="#5a3a22" />
				<rect x="76.500" y="37" width="3" height="7" rx="1.500" fill="#5a3a22" />
				{/* the mossy bank */}
				<path d="M0 62 Q20 54 48 58 T96 56 V72 H0 Z" fill="#4f6b34" />
				<path d="M0 66 Q30 60 60 64 T96 62 V72 H0 Z" fill="#3a5226" />
				<path d="M20 60 q2 -3 4 0 M60 61 q2 -3 4 0 M38 63 q2 -3 4 0 M74 60 q2 -3 4 0" fill="none" stroke="#7d9a4c" strokeWidth="1" strokeLinecap="round" />
				{step === 0 && <Goblin x={50} lean={-12} look="ahead" stride />}
				{step === 1 && <Goblin x={48} lean={0} look="side" />}
				{step === 2 && <Goblin x={46} lean={6} look="down" pebble />}
				{step === 3 && <Goblin x={48} lean={0} look="tired" sit />}
				{step === 0 && <path d="M18 50 h10 M14 55 h12 M20 60 h8" stroke="#f6e7c4" strokeWidth="1.200" strokeLinecap="round" opacity="0.7" />}
				{step === 3 && (
					<g>
						{/* everything it has turned over */}
						<ellipse cx="22" cy="64" rx="5" ry="3" fill="#8d949c" />
						<ellipse cx="29" cy="66" rx="4" ry="2.500" fill="#b9a27a" />
						<ellipse cx="70" cy="65" rx="5" ry="3" fill="#7f8a96" />
						<ellipse cx="77" cy="67" rx="3.500" ry="2.200" fill="#c9b48a" />
						<circle cx="64" cy="67" r="2.600" fill="#d6a52c" stroke="#8f6d1c" strokeWidth="0.600" />
						<circle cx="34" cy="62.500" r="2.400" fill="#b8402e" stroke="#7a2a1e" strokeWidth="0.600" />
					</g>
				)}
			</g>
			{flies.map(([x, y], i) => (
				<g key={i} className={`depth-fly depth-fly-${i % 3}`}>
					<circle cx={x} cy={y} r="3.200" fill="#fff2a0" opacity="0.55" filter={`url(#${id}-glow)`} />
					<circle cx={x} cy={y} r="1" fill="#fffbd6" />
				</g>
			))}
		</svg>
	);
}

function Goblin({ x, lean, look, stride = false, pebble = false, sit = false }: { x: number; lean: number; look: 'ahead' | 'side' | 'down' | 'tired'; stride?: boolean; pebble?: boolean; sit?: boolean }) {
	const skin = 'url(#' + `depth-art-${look === 'ahead' ? 0 : look === 'side' ? 1 : look === 'down' ? 2 : 3}` + '-skin)';
	const ground = sit ? 64 : 62;
	return (
		<g transform={`translate(${x} ${sit ? 4 : 0}) rotate(${lean} 0 ${ground})`}>
			{/* the crooked driftwood stick */}
			{!sit ? <path d="M17 62 Q15 48 18 40 Q16 34 19 28" fill="none" stroke="#b9a384" strokeWidth="2.200" strokeLinecap="round" /> : <path d="M-22 62 Q-8 60 6 62 Q14 60 22 61" fill="none" stroke="#b9a384" strokeWidth="2.200" strokeLinecap="round" />}
			{/* short stubby legs */}
			{sit ? (
				<path d="M-6 58 L-13 61 M6 58 L13 61" stroke="#5a5530" strokeWidth="4.500" strokeLinecap="round" />
			) : stride ? (
				<path d="M-4 54 L-11 61 M4 54 L9 62" stroke="#5a5530" strokeWidth="4.500" strokeLinecap="round" />
			) : (
				<path d="M-5 54 L-6 62 M5 54 L6 62" stroke="#5a5530" strokeWidth="4.500" strokeLinecap="round" />
			)}
			<ellipse cx={sit ? -15 : stride ? -13 : -8} cy={sit ? 61.500 : 62.500} rx="4" ry="2" fill="#4a4526" />
			<ellipse cx={sit ? 15 : stride ? 11 : 8} cy={sit ? 61.500 : 62.500} rx="4" ry="2" fill="#4a4526" />
			{/* the round belly */}
			<ellipse cx="0" cy="46" rx="12" ry="12.500" fill={skin} stroke="#3a361c" strokeWidth="0.800" />
			<ellipse cx="0" cy="49" rx="7.500" ry="8" fill="#c9bf8a" opacity="0.55" />
			{/* the reed sash, with pebbles and bottle caps */}
			<path d="M-10 39 Q0 52 11 50" fill="none" stroke="#b79a4e" strokeWidth="3.200" strokeLinecap="round" />
			<path d="M-9 40 l2 2 M-5 44 l2 2 M0 47.500 l2 1.500 M5 49.500 l2 1" stroke="#7d6a2e" strokeWidth="0.700" />
			<circle cx="-6" cy="43" r="1.700" fill="#9fb4c9" />
			<circle cx="-1.500" cy="47" r="1.800" fill="#d6a52c" stroke="#8f6d1c" strokeWidth="0.500" />
			<circle cx="3.500" cy="49.500" r="1.600" fill="#e8e2d2" />
			<circle cx="8" cy="50.500" r="1.700" fill="#b8402e" stroke="#7a2a1e" strokeWidth="0.500" />
			{/* long dangling arms */}
			<path d="M-11 42 Q-17 50 -15 58" fill="none" stroke="#6f6a3a" strokeWidth="3.600" strokeLinecap="round" />
			{pebble ? <path d="M11 42 Q16 40 12 33" fill="none" stroke="#6f6a3a" strokeWidth="3.600" strokeLinecap="round" /> : sit ? <path d="M11 42 Q17 50 15 58" fill="none" stroke="#6f6a3a" strokeWidth="3.600" strokeLinecap="round" /> : <path d="M11 42 Q17 44 17.500 49" fill="none" stroke="#6f6a3a" strokeWidth="3.600" strokeLinecap="round" />}
			{pebble && (
				<g>
					<ellipse cx="11.500" cy="31" rx="3.200" ry="2.400" fill="#cfd8e2" stroke="#7f8a96" strokeWidth="0.600" />
					<path d="M9 26 l-1 -2.500 M12 25.500 v-3 M15 26.500 l1.200 -2.300" stroke="#fff2a0" strokeWidth="0.900" strokeLinecap="round" />
				</g>
			)}
			{/* the wide flat head, bead eyes far apart */}
			<ellipse cx="0" cy="30" rx="17" ry="8.500" fill={skin} stroke="#3a361c" strokeWidth="0.800" />
			<circle cx="-12.500" cy="24.500" r="3.400" fill={skin} stroke="#3a361c" strokeWidth="0.700" />
			<circle cx="12.500" cy="24.500" r="3.400" fill={skin} stroke="#3a361c" strokeWidth="0.700" />
			{look === 'tired' ? (
				<path d="M-14.500 25 q2 1.600 4 0 M10.500 25 q2 1.600 4 0" fill="none" stroke="#14120a" strokeWidth="1.100" strokeLinecap="round" />
			) : (
				<>
					<circle cx={-12.500 + (look === 'side' ? 0.900 : look === 'down' ? 0.800 : 0.600)} cy={24.500 + (look === 'down' ? 0.900 : 0)} r="1.500" fill="#14120a" />
					<circle cx={12.500 + (look === 'side' ? 0.900 : look === 'down' ? -0.200 : 0.600)} cy={24.500 + (look === 'down' ? 0.900 : 0)} r="1.500" fill="#14120a" />
					<circle cx="-12.900" cy="23.900" r="0.450" fill="#fff" />
					<circle cx="12.100" cy="23.900" r="0.450" fill="#fff" />
				</>
			)}
			{/* curious, slightly suspicious: one brow down, a small crooked mouth */}
			{look !== 'tired' && <path d="M-15.500 20.800 l5 1.400 M10 20.600 l5 -0.800" stroke="#3a361c" strokeWidth="1" strokeLinecap="round" />}
			<path d={look === 'tired' ? 'M-4 33.500 q4 -1.500 8 0' : look === 'ahead' ? 'M-5 33 q5 2 9 -0.500' : 'M-5 33.500 q4 -1.200 9 0.300'} fill="none" stroke="#2a2714" strokeWidth="1.100" strokeLinecap="round" />
			{/* pale yellow speckles */}
			<g fill="#e9dc8a" opacity="0.9">
				<circle cx="-5" cy="27" r="0.900" />
				<circle cx="2" cy="25.500" r="0.700" />
				<circle cx="7" cy="28" r="0.900" />
				<circle cx="-9" cy="30.500" r="0.700" />
				<circle cx="-8" cy="47" r="0.800" />
				<circle cx="8" cy="42" r="0.800" />
				<circle cx="-3" cy="38" r="0.700" />
			</g>
			{look === 'tired' && <path d="M17 14 h3 l-3 4 h3 M22 8 h2.400 l-2.400 3.200 h2.400" fill="none" stroke="#f6e7c4" strokeWidth="0.900" />}
		</g>
	);
}
