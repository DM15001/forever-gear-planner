import { createPortal } from 'react-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CharacterSheet } from './components/CharacterSheet';
import { EnchantsTab } from './components/EnchantsTab';
import { castingShare, countsMending, mendingWeights } from './lib/sim/mending';
import { FaqTab } from './components/FaqTab';
import { NewsTab, newsUnseen } from './components/NewsTab';
import { GearRails } from './components/GearRail';
import { CharacterBar } from './components/CharacterBar';
import { ClassIcon } from './components/ClassIcon';
import { FarmTab } from './components/FarmTab';
import { GroupFarm } from './components/GroupFarm';
import { HealingPicker } from './components/HealingPicker';
import { setUnit } from './lib/format';
import { healingChoice, scenarioKey } from './lib/sim/healing';
import { ImportPanel } from './components/ImportPanel';
import { BarCap, Emblem } from './components/Ornaments';
import { PlanTab } from './components/PlanTab';
import { SimSetupTab } from './components/SimSetupTab';
import { SimProvider } from './components/Sim';
import { simClient } from './lib/sim/client';
import { UpgradesTab } from './components/UpgradesTab';
import { type GameData, loadGameData, dataFor } from './lib/gameData';
import type { ImportResult } from './lib/importCharacter';
import { DEFAULT_FILTER, type SourceFilter } from './lib/scoring';
import { activeCharacter, addCharacter, addGroup, characterLabel, groupFromShareText, removeActive, replaceActive, type Roster, selectCharacter, sharedCharacter, shareUrl } from './lib/roster';
import { specOf, specsOfClass } from './lib/specs';
import { loadFilter, loadRoster, loadWeights, normalFilter, saveRoster, saveWeights } from './lib/storage';
import type { Character, SpecConfig } from './lib/types';


/** The planner's sections, in the bar. */
const TABS = [
	{ id: 'character', label: 'Character' },
	{ id: 'simulate', label: 'Plan' },
	{ id: 'upgrades', label: 'Upgrades' },
	{ id: 'enchants', label: 'Enchants & professions' },
	{ id: 'farm', label: 'Farm plan' },
	{ id: 'group', label: 'Group plan' },
];
/** Settings and reading: small links beside the title, out of the way of the planner's own sections. */
const SIDE_TABS = [
	{ id: 'sim', label: 'Sim setup' },
	{ id: 'news', label: 'News' },
	{ id: 'faq', label: 'FAQ' },
];

/** Two copies of the site are published: the live one, and under dev/ the one with changes still being tried out. Both read the same saved characters. */
const IS_DEV = import.meta.env.VITE_CHANNEL === 'dev';

const SWITCH_WORD = 'penis1';
const SWITCH_KEY = 'fgp.channelSwitch';

function switchUnlocked(): boolean {
	try {
		return localStorage.getItem(SWITCH_KEY) === '1';
	} catch {
		return false;
	}
}

/** The site owner's dwarf as a cartoon: chain coif, long red beard, white tabard, big gauntlets, trousers down around his boots. Sunglasses on, a smoke in the mouth, one finger for the world and the other hand pointing up at the Live/Dev switch. Drawn here. */
function CheerDwarf() {
	return (
		<svg className="cheer-dwarf" viewBox="0 0 180 240" width="180" height="240" aria-hidden="true">
			<defs>
				<linearGradient id="cheer-gold" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0" stopColor="#fff6b0" />
					<stop offset="0.45" stopColor="#ffd100" />
					<stop offset="0.55" stopColor="#c98a00" />
					<stop offset="1" stopColor="#ffe45c" />
				</linearGradient>
				<clipPath id="cheer-plate">
					<rect x="22" y="196" width="136" height="34" rx="8" />
				</clipPath>
			</defs>
			{/* fur coat, worn open */}
			<path d="M40 96 Q24 140 38 176 L64 176 L64 100 Z M140 96 Q156 140 142 176 L116 176 L116 100 Z" fill="#5b2a86" />
			<path d="M40 96 Q24 140 38 176 M140 96 Q156 140 142 176 M38 176 H64 M116 176 H142" fill="none" stroke="#f7f3ea" strokeWidth="9" strokeLinecap="round" />
			<path d="M33 120 l3 2 M31 144 l3 2 M35 164 l3 1 M147 120 l-3 2 M149 144 l-3 2 M145 164 l-3 1 M48 176 l2 2 M130 176 l2 2" stroke="#1a1203" strokeWidth="2.4" strokeLinecap="round" />
			{/* arm pointing up at the switch */}
			<g className="cheer-point">
				<path d="M118 104 L146 62" stroke="#c9895f" strokeWidth="15" strokeLinecap="round" />
				<path d="M140 72 L152 50" stroke="#5f6f66" strokeWidth="21" strokeLinecap="round" />
				<path d="M134 74 L150 82" stroke="#8a9a90" strokeWidth="4" strokeLinecap="round" />
				<circle cx="154" cy="45" r="11" fill="#6f8076" />
				<path d="M158 38 L168 14" stroke="#6f8076" strokeWidth="8" strokeLinecap="round" />
			</g>
			{/* the other arm: one finger up */}
			<g className="cheer-finger">
				<path d="M62 104 L36 84" stroke="#c9895f" strokeWidth="15" strokeLinecap="round" />
				<path d="M40 88 L28 70" stroke="#5f6f66" strokeWidth="21" strokeLinecap="round" />
				<path d="M30 90 L46 78" stroke="#8a9a90" strokeWidth="4" strokeLinecap="round" />
				<rect x="10" y="46" width="30" height="22" rx="8" fill="#6f8076" />
				<path d="M25 50 L25 22" stroke="#6f8076" strokeWidth="8" strokeLinecap="round" />
				<path d="M16 50 V46 M34 50 V46" stroke="#4f5d55" strokeWidth="2" strokeLinecap="round" />
			</g>
			{/* bare legs, heart boxers, and the trousers down around the boots */}
			<rect x="66" y="156" width="18" height="22" rx="6" fill="#dba77e" />
			<rect x="96" y="156" width="18" height="22" rx="6" fill="#dba77e" />
			<path d="M70 164 l2 1 M78 168 l-2 1 M100 166 l2 1 M108 162 l-2 1" stroke="#b5531f" strokeWidth="1.2" strokeLinecap="round" />
			<path d="M54 170 Q72 164 90 172 Q108 164 126 170 L124 182 Q90 176 56 182 Z" fill="#7a5a3c" />
			<path d="M60 174 q6 -3 12 0 M82 176 q8 -3 16 0 M108 174 q6 -3 12 0" fill="none" stroke="#5c4229" strokeWidth="2" strokeLinecap="round" />
			<ellipse cx="72" cy="184" rx="18" ry="9" fill="#8a7fb8" />
			<ellipse cx="108" cy="184" rx="18" ry="9" fill="#8a7fb8" />
			{/* shoulder pads, mail, tabard, belt */}
			<ellipse cx="54" cy="98" rx="23" ry="14" fill="#f7f3ea" />
			<ellipse cx="126" cy="98" rx="23" ry="14" fill="#f7f3ea" />
			<path d="M42 94 l3 3 M54 90 l2 4 M64 98 l3 2 M48 104 l3 1 M116 98 l-3 2 M126 90 l-2 4 M138 94 l-3 3 M132 104 l-3 1" stroke="#1a1203" strokeWidth="2.4" strokeLinecap="round" />
			<rect x="58" y="92" width="64" height="64" rx="16" fill="#8d949c" />
			<path d="M68 92 H112 V148 Q90 160 68 148 Z" fill="#f4f1e8" stroke="#d6a52c" strokeWidth="3" />
			<path d="M80 108 L90 118 L100 108 L96 124 L90 130 L84 124 Z" fill="#3a3a44" />
			<rect x="58" y="132" width="64" height="11" rx="4" fill="#d6a52c" />
			<circle cx="74" cy="137.5" r="3.5" fill="#5fc4e8" />
			<circle cx="90" cy="137.5" r="4.5" fill="#5fc4e8" />
			<circle cx="106" cy="137.5" r="3.5" fill="#5fc4e8" />
			{/* heart boxers, in plain sight */}
			<path d="M60 146 H120 V160 Q120 166 113 166 H96 L90 158 L84 166 H67 Q60 166 60 160 Z" fill="#f7f3ea" stroke="#cfc8b4" strokeWidth="1" />
			<path d="M70 153 q-3 -4 0 -5 q2 0 2 2 q0 -2 2 -2 q3 1 0 5 l-2 2 Z M106 153 q-3 -4 0 -5 q2 0 2 2 q0 -2 2 -2 q3 1 0 5 l-2 2 Z M88 151 q-2 -3 0 -4 q1.5 0 2 1.5 q0.5 -1.5 2 -1.5 q2 1 0 4 l-2 2 Z" fill="#e8455a" />
			{/* head, chain coif */}
			<circle cx="90" cy="60" r="28" fill="#dba77e" />
			<path d="M60 64 Q56 22 90 22 Q124 22 120 64 L112 58 Q112 40 90 40 Q68 40 68 58 Z" fill="#9aa3ad" />
			<path d="M68 34 H112 M64 42 H74 M106 42 H116 M62 50 H70 M110 50 H118 M74 28 H106" stroke="#6d7680" strokeWidth="2" strokeDasharray="2 3" strokeLinecap="round" />
			{/* beard, braids, moustache */}
			<path d="M64 66 Q58 120 90 142 Q122 120 116 66 Q104 82 90 82 Q76 82 64 66 Z" fill="#b5531f" />
			<path d="M78 100 L74 138 M102 100 L106 138" stroke="#8f3d14" strokeWidth="7" strokeLinecap="round" />
			<path d="M72 112 H80 M71 122 H79 M100 112 H108 M101 122 H109" stroke="#d6a52c" strokeWidth="3" strokeLinecap="round" />
			<path d="M90 74 Q76 72 64 86 Q78 90 90 80 Q102 90 116 86 Q104 72 90 74 Z" fill="#cf6a2a" />
			<ellipse cx="90" cy="70" rx="7" ry="6" fill="#c98f66" />
			{/* gold chain with a medallion */}
			<path d="M66 92 Q90 150 114 92" fill="none" stroke="url(#cheer-gold)" strokeWidth="5" strokeDasharray="5 2.5" strokeLinecap="round" />
			<circle cx="90" cy="124" r="12" fill="url(#cheer-gold)" stroke="#8f6d1c" strokeWidth="2" />
			<text x="90" y="129.5" textAnchor="middle" fontFamily="Georgia, serif" fontWeight="700" fontSize="16" fill="#3b1560">
				B
			</text>
			{/* wide hat with a leopard band and a feather */}
			<path d="M112 20 Q128 -2 118 -8 Q104 2 106 20 Z" fill="#e8455a" />
			<path d="M110 20 Q118 6 117 -6" fill="none" stroke="#ffd7dc" strokeWidth="1.5" strokeLinecap="round" />
			<ellipse cx="90" cy="36" rx="48" ry="9" fill="#4a1f70" />
			<path d="M66 36 Q62 4 90 4 Q118 4 114 36 Q90 42 66 36 Z" fill="#6a329c" />
			<path d="M66 27 Q90 34 114 27 L114 36 Q90 42 66 36 Z" fill="#e2a93a" />
			<path d="M72 32 l3 1 M82 35 l3 0.5 M93 36 l3 0 M103 34 l3 -0.5 M110 31 l2 -0.5" stroke="#3a2414" strokeWidth="3" strokeLinecap="round" />
			<ellipse cx="90" cy="38" rx="48" ry="7" fill="none" stroke="#ffd100" strokeWidth="1.5" />
			{/* rings */}
			<path d="M21 36 H29" stroke="url(#cheer-gold)" strokeWidth="5" strokeLinecap="round" />
			<circle cx="25" cy="36" r="2.5" fill="#7fe0ff" />
			{/* sunglasses */}
			<path d="M64 52 H116" stroke="#0a0908" strokeWidth="3" />
			<path d="M66 52 H87 V60 Q87 68 77 68 Q66 68 66 60 Z" fill="#0a0908" />
			<path d="M93 52 H114 V60 Q114 68 103 68 Q93 68 93 60 Z" fill="#0a0908" />
			<path d="M70 56 L78 56 M97 56 L105 56" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
			<path d="M66 52 H87 V60 Q87 68 77 68 Q66 68 66 60 Z M93 52 H114 V60 Q114 68 103 68 Q93 68 93 60 Z M64 52 H116" fill="none" stroke="url(#cheer-gold)" strokeWidth="1.6" />
			{/* a big one: fat cone, twisted tip, glowing end, smoke */}
			<path d="M94 83 L100 91 L150 106 L152 90 Z" fill="#f4f1e8" stroke="#cfc8b4" strokeWidth="1" strokeLinejoin="round" />
			<path d="M112 90 L113 95 M124 91 L125 99 M136 92 L137 102" stroke="#cfc8b4" strokeWidth="1.2" strokeLinecap="round" />
			<path d="M146 89 L152 90 L150 106 L144 104 Z" fill="#ff7a1a" />
			<path d="M150 91 L151 104" stroke="#ffd100" strokeWidth="2" strokeLinecap="round" />
			<circle className="cheer-smoke cheer-smoke-1" cx="158" cy="94" r="7" fill="#cfd4d8" />
			<circle className="cheer-smoke cheer-smoke-2" cx="161" cy="92" r="9" fill="#cfd4d8" />
			<circle className="cheer-smoke cheer-smoke-3" cx="157" cy="93" r="6" fill="#cfd4d8" />
			<circle className="cheer-smoke cheer-smoke-2" cx="164" cy="96" r="5" fill="#e3e6e8" />
			{/* name plate, as loud as it gets */}
			<path d="M10 204 L22 213 L10 222 H170 L158 213 L170 204 Z" fill="#8f6d1c" />
			<rect x="22" y="196" width="136" height="34" rx="8" fill="#3b1560" stroke="url(#cheer-gold)" strokeWidth="4" />
			<rect x="27" y="201" width="126" height="24" rx="5" fill="none" stroke="#ffd100" strokeWidth="1" strokeDasharray="1.5 3" />
			<text x="90" y="221" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontStyle="italic" fontSize="23" letterSpacing="1" fill="url(#cheer-gold)" stroke="#5a3d00" strokeWidth="0.8" paintOrder="stroke">
				Bogdan
			</text>
			<g clipPath="url(#cheer-plate)">
				<path className="cheer-shine" d="M0 190 L14 190 L-2 236 L-16 236 Z" fill="#ffffff" opacity="0.55" />
			</g>
			<path d="M22 208 l5 5 l-5 5 l-5 -5 Z M158 208 l5 5 l-5 5 l-5 -5 Z" fill="#bff3ff" stroke="#5fc4e8" strokeWidth="1" />
			{/* bling */}
			<path className="cheer-bling cheer-bling-1" d="M36 186 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#fff6b0" />
			<path className="cheer-bling cheer-bling-2" d="M150 182 l2 6 l6 2 l-6 2 l-2 6 l-2 -6 l-6 -2 l6 -2 Z" fill="#fff6b0" />
			<path className="cheer-bling cheer-bling-3" d="M90 108 l1.5 5 l5 1.5 l-5 1.5 l-1.5 5 l-1.5 -5 l-5 -1.5 l5 -1.5 Z" fill="#ffffff" />
			<path className="cheer-bling cheer-bling-2" d="M60 14 l1.5 5 l5 1.5 l-5 1.5 l-1.5 5 l-1.5 -5 l-5 -1.5 l5 -1.5 Z" fill="#fff6b0" />
		</svg>
	);
}

/** Bogdan's friends, drawn in his style: Larry, a gnome holy priest (she) under a far too big backpack, hauls Afly, a warlock in a purple robe who would rather be carried, along on a rope. Both are the owner's own characters. */
function CheerFriends() {
	return (
		<svg className="cheer-friends" viewBox="0 0 300 240" width="300" height="240" aria-hidden="true">
			{/* dust where Afly is dragged along */}
			<path d="M14 200 h14 M8 192 h10 M30 206 h18" stroke="#cfd4d8" strokeWidth="3" strokeLinecap="round" opacity="0.6" />
			{/* Afly: sitting, leaning back, arms crossed */}
			<g className="cheer-dragged">
				<path d="M52 176 Q84 170 128 190 L126 202 Q86 200 50 198 Z" fill="#6a329c" />
				<path d="M56 190 Q88 188 124 198" fill="none" stroke="#4a1f70" strokeWidth="2" strokeLinecap="round" />
				<ellipse cx="132" cy="194" rx="9" ry="6" fill="#2a1840" />
				<path d="M46 150 Q44 196 70 198 Q96 196 92 150 Q70 138 46 150 Z" fill="#6a329c" />
				<path d="M60 146 L70 162 L80 146" fill="none" stroke="#d6a52c" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
				{/* medium-length black hair, behind the head */}
				<path d="M42 132 Q36 92 68 92 Q100 92 94 132 L96 152 Q88 158 86 148 L50 148 Q48 158 40 152 Z" fill="#17131c" />
				<circle cx="68" cy="124" r="20" fill="#f0d2bd" />
				<path d="M48 122 Q50 100 68 102 Q88 100 88 122 Q80 108 68 112 Q58 106 48 122 Z" fill="#17131c" />
				{/* half-closed eyes with eyeliner */}
				<ellipse cx="60" cy="126" rx="4.5" ry="3" fill="#ffffff" />
				<ellipse cx="78" cy="126" rx="4.5" ry="3" fill="#ffffff" />
				<circle cx="61" cy="126.5" r="2" fill="#5b2a86" />
				<circle cx="79" cy="126.5" r="2" fill="#5b2a86" />
				<path d="M54 125 Q60 121 66 125 M72 125 Q78 121 84 125 L87 122" fill="none" stroke="#0a0908" strokeWidth="2.4" strokeLinecap="round" />
				<path d="M54 125 L51 122" stroke="#0a0908" strokeWidth="2.4" strokeLinecap="round" />
				<path d="M54 119 L65 120 M73 120 L84 119" stroke="#17131c" strokeWidth="1.8" strokeLinecap="round" />
				<path d="M63 137 H74" stroke="#8a3d4f" strokeWidth="2" strokeLinecap="round" />
				{/* crossed arms */}
				<path d="M48 162 Q70 176 90 164" fill="none" stroke="#4a1f70" strokeWidth="11" strokeLinecap="round" />
				<path d="M50 172 Q70 160 90 170" fill="none" stroke="#5b2a86" strokeWidth="11" strokeLinecap="round" />
				<circle cx="91" cy="165" r="5.5" fill="#f0d2bd" />
				<circle cx="49" cy="172" r="5.5" fill="#f0d2bd" />
				{/* the rope around her */}
				<path d="M46 180 Q70 190 94 180" fill="none" stroke="#c9a36a" strokeWidth="5" strokeLinecap="round" />
				<circle cx="94" cy="180" r="4" fill="#a8824a" />
				{/* a small green flame, because warlock */}
				<path className="cheer-bling cheer-bling-2" d="M30 150 q-6 -10 2 -18 q0 8 6 10 q4 6 -2 10 q-4 2 -6 -2 Z" fill="#7dff6a" opacity="0.85" />
			</g>
			{/* the rope, taut */}
			<path d="M94 180 Q160 150 216 136 L246 146" fill="none" stroke="#c9a36a" strokeWidth="4" strokeLinecap="round" />
			<path d="M110 173 l3 3 M140 160 l3 3 M170 149 l3 3 M198 141 l3 3" stroke="#a8824a" strokeWidth="2" strokeLinecap="round" />
			{/* Larry: the backpack first, it is most of her */}
			<g className="cheer-haul">
				<ellipse cx="184" cy="52" rx="30" ry="11" fill="#7fa37a" />
				<path d="M158 52 q-4 -8 4 -10 M210 52 q4 -8 -4 -10" fill="none" stroke="#5c7d58" strokeWidth="3" strokeLinecap="round" />
				<rect x="150" y="58" width="68" height="112" rx="20" fill="#8a5a2b" />
				<path d="M150 96 Q184 112 218 96 V78 Q218 58 198 58 H170 Q150 58 150 78 Z" fill="#a06a34" />
				<rect x="178" y="98" width="12" height="14" rx="3" fill="#d6a52c" />
				<rect x="158" y="124" width="52" height="34" rx="8" fill="#75491f" />
				<path d="M158 134 H210" stroke="#5c3814" strokeWidth="2" />
				<circle cx="146" cy="120" r="12" fill="none" stroke="#3a3a44" strokeWidth="5" />
				<path d="M146 132 V152" stroke="#3a3a44" strokeWidth="5" strokeLinecap="round" />
				<path d="M222 62 L214 176" stroke="#d6a52c" strokeWidth="4" strokeLinecap="round" />
				<circle cx="222" cy="58" r="7" fill="#fff6b0" stroke="#d6a52c" strokeWidth="2" />
				{/* legs, mid-stride */}
				<path d="M222 182 L210 198 M236 182 L250 196" stroke="#f2c9a8" strokeWidth="9" strokeLinecap="round" />
				<ellipse cx="206" cy="201" rx="11" ry="6" fill="#e9e4d2" />
				<ellipse cx="256" cy="199" rx="11" ry="6" fill="#e9e4d2" />
				{/* robe: white tabard with an emblem, belt, red skirt with a gold hem */}
				<path d="M212 150 Q206 188 212 192 H248 Q254 188 248 150 Z" fill="#b8402e" />
				<path d="M210 184 Q230 190 250 184 L249 191 Q230 196 211 191 Z" fill="#e2a93a" />
				<path d="M212 136 Q210 158 214 160 H246 Q250 158 246 136 Q230 128 212 136 Z" fill="#f4f1e8" stroke="#d6a52c" strokeWidth="2" />
				<path d="M220 140 Q224 150 230 147 Q236 150 240 140 Q240 152 230 156 Q220 152 220 140 Z" fill="#3a3a44" />
				<path d="M222 138 Q230 133 238 138" fill="none" stroke="#d6a52c" strokeWidth="2" strokeLinecap="round" />
				<rect x="211" y="157" width="37" height="7" rx="2" fill="#23232b" />
				<rect x="225" y="156" width="10" height="9" rx="2" fill="none" stroke="#d6a52c" strokeWidth="2" />
				{/* spiked purple shoulder pads */}
				<path d="M196 138 L190 126 L202 130 L204 120 L212 130 L222 128 Q224 142 212 146 Q200 146 196 138 Z" fill="#5b3a8a" stroke="#2f1d4d" strokeWidth="1.5" strokeLinejoin="round" />
				<path d="M264 138 L270 126 L258 130 L256 120 L248 130 L238 128 Q236 142 248 146 Q260 146 264 138 Z" fill="#5b3a8a" stroke="#2f1d4d" strokeWidth="1.5" strokeLinejoin="round" />
				{/* strap, one hand on the rope, the other holding a ball of holy light */}
				<path d="M218 134 Q214 150 216 160" fill="none" stroke="#5c3814" strokeWidth="5" strokeLinecap="round" />
				<path d="M222 148 L240 148" stroke="#f2c9a8" strokeWidth="8" strokeLinecap="round" />
				<circle cx="243" cy="148" r="6" fill="#6a4a9c" />
				<path d="M250 148 L266 160" stroke="#f2c9a8" strokeWidth="8" strokeLinecap="round" />
				<circle className="cheer-bling cheer-bling-2" cx="272" cy="164" r="15" fill="#fff6b0" opacity="0.35" />
				<circle cx="272" cy="164" r="9" fill="#fff9d6" opacity="0.8" />
				<circle cx="272" cy="164" r="5" fill="#ffffff" />
				{/* head: big, as gnomes have them; brown hair parted in the middle, ponytail, earrings */}
				<path d="M216 92 Q184 80 172 108 Q172 124 184 118 Q188 104 212 108 Z" fill="#8a4b22" />
				<circle cx="206" cy="98" r="4.5" fill="#d6a52c" />
				<path d="M214 112 l-10 -5 l8 11 Z M262 112 l10 -5 l-8 11 Z" fill="#f2c9a8" />
				<circle cx="207" cy="117" r="3" fill="none" stroke="#9fd8ff" strokeWidth="2" />
				<circle cx="269" cy="117" r="3" fill="none" stroke="#9fd8ff" strokeWidth="2" />
				<circle cx="238" cy="110" r="24" fill="#f2c9a8" />
				<path d="M212 114 Q206 78 238 78 Q270 78 264 114 Q264 98 240 87 L238 84 L236 87 Q212 98 212 114 Z" fill="#8a4b22" />
				<path d="M213 106 Q208 124 216 134 L219 112 Z M263 106 Q268 124 260 134 L257 112 Z" fill="#8a4b22" />
				<path d="M238 84 Q230 80 222 84 M238 84 Q246 80 254 84" fill="none" stroke="#a9632f" strokeWidth="1.5" strokeLinecap="round" />
				{/* big light blue eyes with lashes, annoyed brows, gritted teeth */}
				<ellipse cx="228" cy="112" rx="7" ry="7.5" fill="#ffffff" />
				<ellipse cx="248" cy="112" rx="7" ry="7.5" fill="#ffffff" />
				<circle cx="229.5" cy="113" r="4.4" fill="#8fdcff" />
				<circle cx="249.5" cy="113" r="4.4" fill="#8fdcff" />
				<circle cx="230" cy="113" r="1.8" fill="#12222c" />
				<circle cx="250" cy="113" r="1.8" fill="#12222c" />
				<circle cx="231.5" cy="111" r="1.1" fill="#ffffff" />
				<circle cx="251.5" cy="111" r="1.1" fill="#ffffff" />
				<path d="M221 108 Q228 102 235 107 M241 107 Q248 102 255 108" fill="none" stroke="#3a2414" strokeWidth="1.8" strokeLinecap="round" />
				<path d="M221 108 l-3 -2 M255 108 l3 -2" stroke="#3a2414" strokeWidth="1.6" strokeLinecap="round" />
				<path d="M220 101 L234 104 M256 101 L242 104" stroke="#6b3a18" strokeWidth="2.2" strokeLinecap="round" />
				<path d="M237 118 q1 2 3 1" fill="none" stroke="#d9a587" strokeWidth="1.5" strokeLinecap="round" />
				<rect x="230" y="123" width="16" height="6" rx="3" fill="#ffffff" stroke="#c0566a" strokeWidth="2" />
				<path d="M234 123 V129 M238 123 V129 M242 123 V129" stroke="#c9a0a8" strokeWidth="1" />
				{/* sweat */}
				<path className="cheer-bling cheer-bling-1" d="M268 92 q4 7 0 9 q-4 -2 0 -9 Z" fill="#7fd0ff" />
				<path className="cheer-bling cheer-bling-3" d="M276 108 q3 6 0 8 q-3 -2 0 -8 Z" fill="#7fd0ff" />
			</g>
			{/* name plates */}
			<rect x="34" y="210" width="72" height="22" rx="6" fill="#3b1560" stroke="#d6a52c" strokeWidth="2.5" />
			<text x="70" y="226.5" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontStyle="italic" fontSize="15" fill="#ffd100">
				Afly
			</text>
			<rect x="190" y="210" width="84" height="22" rx="6" fill="#3b1560" stroke="#d6a52c" strokeWidth="2.5" />
			<text x="232" y="226.5" textAnchor="middle" fontFamily="Cinzel, Georgia, serif" fontWeight="700" fontStyle="italic" fontSize="15" fill="#ffd100">
				Larry
			</text>
		</svg>
	);
}

/** Hidden on the live site until the unlock word is typed anywhere outside a text field; typing it again hides it. The dev copy always shows it, as the way back. */
function ChannelSwitch() {
	const [unlocked, setUnlocked] = useState(switchUnlocked);
	const [cheer, setCheer] = useState(false);
	const shown = useRef(unlocked);
	useEffect(() => {
		let typed = '';
		let cheerTimer: ReturnType<typeof setTimeout> | undefined;
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
			if (event.key.length !== 1) return;
			typed = (typed + event.key.toLowerCase()).slice(-SWITCH_WORD.length);
			if (typed !== SWITCH_WORD) return;
			typed = '';
			const next = !shown.current;
			shown.current = next;
			try {
				if (next) localStorage.setItem(SWITCH_KEY, '1');
				else localStorage.removeItem(SWITCH_KEY);
			} catch {
				// Private windows may refuse storage; the switch then lasts until the page is closed.
			}
			setUnlocked(next);
			// A short hello from the dwarf when the switch comes out; gone again by itself.
			clearTimeout(cheerTimer);
			setCheer(next);
			if (next) cheerTimer = setTimeout(() => setCheer(false), 4000);
		};
		window.addEventListener('keydown', onKey);
		return () => {
			window.removeEventListener('keydown', onKey);
			clearTimeout(cheerTimer);
		};
	}, []);
	if (!IS_DEV && !unlocked) return null;
	const other = IS_DEV ? '../' : './dev/';
	return (
		<>
			<nav className={`channel-switch${IS_DEV ? ' channel-dev' : ''}`} aria-label="Site version">
				{IS_DEV ? <a href={other}>Live</a> : <span aria-current="page">Live</span>}
				{IS_DEV ? <span aria-current="page">Dev</span> : <a href={other}>Dev</a>}
			</nav>
			{/* He stands in the middle of the tab bar. */}
			{cheer &&
				createPortal(
					<>
						<CheerFriends />
						<CheerDwarf />
					</>,
					document.querySelector('.tab-bar') ?? document.body,
				)}
		</>
	);
}

/** What the visitor chose to see; kept in this browser, the same for every character. */
interface ViewOptions {
	equippedPanel: boolean;
	plannedPanel: boolean;
}
const OPTIONS_KEY = 'fgp.options';
const DEFAULT_OPTIONS: ViewOptions = { equippedPanel: true, plannedPanel: true };

function loadOptions(): ViewOptions {
	try {
		const saved = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? '{}') as Partial<ViewOptions>;
		return { equippedPanel: saved.equippedPanel !== false, plannedPanel: saved.plannedPanel !== false };
	} catch {
		return DEFAULT_OPTIONS;
	}
}

/** Shown when the site published a newer simulator while this page stayed open: reload, or the numbers lag behind wowsims.com. */
function EngineNotice() {
	const [outdated, setOutdated] = useState(false);
	useEffect(() => {
		let stopped = false;
		const check = () => {
			if (document.visibilityState !== 'visible') return;
			simClient.outdated().then(old => !stopped && old && setOutdated(true), () => undefined);
		};
		check();
		const timer = setInterval(check, 5 * 60_000);
		document.addEventListener('visibilitychange', check);
		return () => {
			stopped = true;
			clearInterval(timer);
			document.removeEventListener('visibilitychange', check);
		};
	}, []);
	if (!outdated) return null;
	return (
		<div className="engine-notice" role="status">
			<span>The simulator was updated while this page was open. Reload to simulate with the same version as wowsims.com.</span>
			<button className="button button-primary" onClick={() => window.location.reload()}>
				Reload
			</button>
		</div>
	);
}

export function App() {
	const [options, setOptions] = useState<ViewOptions>(loadOptions);
	const changeOptions = useCallback((next: ViewOptions) => {
		setOptions(next);
		try {
			localStorage.setItem(OPTIONS_KEY, JSON.stringify(next));
		} catch {
			// Without storage the choice lasts until the page is closed.
		}
	}, []);
	// A character that arrives in a share link is added next to the saved ones, never over them.
	const [roster, setRoster] = useState<Roster>(() => {
		const saved = loadRoster();
		const shared = sharedCharacter(window.location.hash);
		if (!shared) return saved;
		const next = addCharacter(saved, { ...shared, name: shared.name ? `${shared.name} (shared)` : 'Shared character' });
		saveRoster(next);
		history.replaceState(null, '', window.location.pathname + window.location.search);
		return next;
	});
	const character = activeCharacter(roster);
	// The spec follows the character. The user's own stat weights replace the spec's defaults
	// everywhere a score is computed; they are kept per spec.
	const baseSpec = specOf(character);
	const [weightsVersion, setWeightsVersion] = useState(0);
	// A healer has one set of weights per healing scenario; the character's choice picks it.
	const healingKey = baseSpec.healing ? scenarioKey(healingChoice(character)) : '';
	const mending = !!baseSpec.healing && !!character && countsMending(character, baseSpec.talents);
	const scenarioSpec = useMemo(() => {
		const measured = baseSpec.healing?.scenarios[healingKey];
		if (!measured) return baseSpec;
		// Prayer of Mending is not in the measured weights (the engine cannot cast it), so its estimate is worked in.
		const stats = mending ? mendingWeights(measured.weights, castingShare({ healing: { pressure: healingKey.split('.')[1] } })) : measured.weights;
		return { ...baseSpec, weights: { ...baseSpec.weights, stats } };
	}, [baseSpec, healingKey, mending]);
	const weightsKey = healingKey ? `${baseSpec.id}.${healingKey}${mending ? '.mending' : ''}` : baseSpec.id;
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const customWeights = useMemo(() => loadWeights(weightsKey), [weightsKey, weightsVersion]);
	const spec = useMemo(() => (customWeights ? { ...scenarioSpec, weights: customWeights } : scenarioSpec), [scenarioSpec, customWeights]);
	// Every number on the page is damage per second, or healing per second for a healer.
	setUnit(baseSpec.role === 'healer' ? 'HPS' : 'DPS');
	const changeWeights = (weights: SpecConfig['weights'] | null) => {
		saveWeights(weightsKey, weights);
		setWeightsVersion(version => version + 1);
	};
	const changeRoster = (next: Roster) => {
		setRoster(next);
		saveRoster(next);
	};
	const [warnings, setWarnings] = useState<string[]>([]);
	const [importing, setImporting] = useState(false);
	const [tab, setTab] = useState('character');
	// A whole group that arrives in a link: everyone is added, and the Group plan opens.
	useEffect(() => {
		if (!window.location.hash.includes('group=')) return;
		groupFromShareText(window.location.hash).then(group => {
			history.replaceState(null, '', window.location.pathname + window.location.search);
			if (!group) return;
			setRoster(current => {
				const next = addGroup(current, group).roster;
				saveRoster(next);
				return next;
			});
			setImporting(false);
			setTab('group');
		});
	}, []);
	// A dot on the News tab until today's entry has been opened.
	const [newsDot, setNewsDot] = useState(false);
	useEffect(() => {
		void newsUnseen().then(setNewsDot);
	}, []);
	const newsSeen = useCallback(() => setNewsDot(false), []);
	// Step 2 has two ways in: the automatic plan, or every slot by hand.
	const [upgradeView, setUpgradeView] = useState<'plan' | 'slots'>('slots');
	// The content choice, shared by every tab and remembered between visits.
	// Each character keeps its own choice. One saved before that existed starts from the browser's last choice;
	// a new one starts from the defaults.
	const [legacyFilter] = useState<SourceFilter>(loadFilter);
	const filter = useMemo(() => (character?.content ? (normalFilter(character.content) ?? DEFAULT_FILTER) : legacyFilter), [character?.content, legacyFilter]);
	const setFilter = (next: SourceFilter) => {
		if (character) changeRoster(replaceActive(roster, { ...character, content: next }));
	};

	// The item data is narrowed to the spec, so it is loaded again when the spec changes.
	const [loaded, setLoaded] = useState<{ specId: string; data: GameData } | null>(null);
	const [dataError, setDataError] = useState(false);
	const loadedData = loaded?.specId === baseSpec.id ? loaded.data : null;
	// The scores follow the enemy kind and terrain the character is set to fight.
	const fight = character?.fight;
	const ignoredSets = filter.ignoredSets;
	const data = useMemo(() => (loadedData ? dataFor(loadedData, fight, ignoredSets) : null), [loadedData, fight, ignoredSets]);

	useEffect(() => {
		let current = true;
		loadGameData(baseSpec).then(
			result => current && setLoaded({ specId: baseSpec.id, data: result }),
			() => current && setDataError(true),
		);
		return () => {
			current = false;
		};
	}, [baseSpec]);

	const update = (next: Character) => changeRoster(replaceActive(roster, next));

	const onImported = (result: ImportResult) => {
		// A new character starts from the default content choice, not from another character's ticks.
		changeRoster(addCharacter(roster, { ...result.character, content: result.character.content ?? DEFAULT_FILTER }));
		setTab('character');
		setWarnings(result.warnings);
		setImporting(false);
	};

	// The character panel: the first tab, and the window the side panes open.
	const characterSheet = character ? (
		<CharacterSheet
			spec={spec}
			character={character}
			data={data}
			onChange={update}
			names={roster.characters.map((c, i) => characterLabel(c, i, specOf(c)))}
			builds={specsOfClass(baseSpec.className)}
			activeIndex={roster.active}
			shareLink={shareUrl(character, window.location.href)}
			onOpenTalents={() => setTab('sim')}
			next={
				<>
					<span className="slot-source">Check race, professions and enchants, then</span>
					<button
						className="button button-primary"
						onClick={() => {
							setUpgradeView('plan');
							setTab('simulate');
						}}>
						Build my gear plan
					</button>
				</>
			}
		/>
	) : null;

	return (
		<div className="page">
			<ChannelSwitch />
			<EngineNotice />
			<header className="masthead">
				<div className="masthead-title">
					<button className="masthead-home" onClick={() => setImporting(true)} title="Start page: your characters and import" aria-label="Start page">
						<Emblem />
					</button>
					<div>
						<h1>
							<button className="masthead-home" onClick={() => setImporting(true)} title="Start page: your characters and import">
								Forever Gear Planner
							</button>
						</h1>
						<p className="masthead-sub">
							{character && <ClassIcon className={baseSpec.className} small />}
							{character ? `${spec.name}, pre-raid` : 'Pre-raid gear for WoW: Forever'}
						</p>
					</div>
				</div>
				<nav className="masthead-tools" aria-label="Settings, news and questions">
					{SIDE_TABS.map(t => (
						<button key={t.id} className="tool-link" aria-current={t.id === tab ? 'page' : undefined} onClick={() => {
								setTab(t.id);
								if (character) setImporting(false);
							}}>
							{t.id === 'news' && newsDot && <span className="tab-dot" title="New since your last visit" aria-label="new" />}
							{t.label}
						</button>
					))}
				</nav>
				<div className="masthead-side">
					<div className="tab-bar">
						<BarCap />
						<nav className="tabs" aria-label="Sections">
							{TABS.map(t => (
								<button key={t.id} className="tab" aria-current={t.id === tab ? 'page' : undefined} onClick={() => {
										setTab(t.id);
										if (character) setImporting(false);
									}}>
									{t.label}
								</button>
							))}
						</nav>
						<BarCap mirrored />
					</div>
				</div>
			</header>

			<main>
				{dataError && <p className="notice notice-error">The item data could not be loaded. Reload the page; if that does not help, run "npm run build-data".</p>}

				{character && importing && (
					<section className="home-characters" aria-labelledby="home-characters">
						<h2 id="home-characters">Your characters</h2>
						<p className="hint">Saved in this browser. Click one to open it.</p>
						<CharacterBar
							roster={roster}
							onSelect={index => {
								changeRoster(selectCharacter(roster, index));
								setWarnings([]);
								setTab('character');
								setImporting(false);
							}}
							onRemove={() => {
								changeRoster(removeActive(roster));
								setWarnings([]);
							}}
						/>
					</section>
				)}
				{/* The FAQ needs no character: it is there for the first visit too. */}
				{tab === 'faq' && !character && <FaqTab />}
				{(!character || importing) && tab !== 'faq' && <ImportPanel hasCharacter={Boolean(character)} onImported={onImported} onCancel={() => setImporting(false)} />}

				{character && !importing && (
					<CharacterBar
						roster={roster}
						onSelect={index => {
							changeRoster(selectCharacter(roster, index));
							setWarnings([]);
						}}
						onAdd={() => setImporting(true)}
						onRemove={() => {
							changeRoster(removeActive(roster));
							setWarnings([]);
						}}
					/>
				)}
				{character && !importing && (
					<SimProvider character={character}>
						{/* The Character page shows both sets itself, so the side panes stay away there. */}
						{data && tab !== 'character' && tab !== 'group' && <GearRails spec={spec} character={character} data={data} showEquipped={options.equippedPanel} showPlanned={options.plannedPanel} onShow={(kind, on) => changeOptions({ ...options, [kind === 'equipped' ? 'equippedPanel' : 'plannedPanel']: on })} filter={filter} onChange={update} />}
						{tab === 'simulate' && (
							<div className="view-switch" role="group" aria-label="How to pick upgrades">
								<button className="view-choice" aria-pressed={upgradeView === 'slots'} onClick={() => setUpgradeView('slots')}>
									<strong>Slot by slot</strong>
									<span>Every slot with its upgrades and alternatives, to pick by hand.</span>
								</button>
								<button className="view-choice" aria-pressed={upgradeView === 'plan'} onClick={() => setUpgradeView('plan')}>
									<strong>Plan for me</strong>
									<span>Say what content you do and get the best set with a to-do list.</span>
								</button>
							</div>
						)}
						{tab === 'simulate' && baseSpec.role === 'healer' && <HealingPicker character={character} spec={spec} onChange={update} />}
						{(tab === 'simulate' || tab === 'upgrades') && upgradeView === 'plan' && (data ? <PlanTab part={tab === 'simulate' ? 'sim' : 'list'} spec={spec} character={character} data={data} filter={filter} onFilterChange={setFilter} onChange={update} /> : <p>Loading item data…</p>)}

						{(tab === 'simulate' || tab === 'upgrades') && upgradeView === 'slots' && (data ? <UpgradesTab onShowList={() => setTab('upgrades')} part={tab === 'simulate' ? 'sim' : 'list'} spec={spec} defaultWeights={scenarioSpec.weights} onWeightsChange={changeWeights} character={character} data={data} onChange={update} filter={filter} onFilterChange={setFilter} /> : <p>Loading item data…</p>)}

						{tab === 'farm' && (data ? <FarmTab spec={spec} character={character} data={data} filter={filter} onChange={update} /> : <p>Loading item data…</p>)}
						{/* The group plan is about all saved characters, not the one that is open. */}
						{tab === 'group' && <div className="farm"><GroupFarm roster={roster} onRosterChange={changeRoster} /></div>}

						{tab === 'enchants' && (data ? <EnchantsTab spec={spec} character={character} data={data} filter={filter} onChange={update} /> : <p>Loading item data…</p>)}

						{tab === 'faq' && <FaqTab />}
						{tab === 'news' && <NewsTab myClass={baseSpec.className} onSeen={newsSeen} />}
						{tab === 'sim' && <SimSetupTab spec={spec} character={character} data={data} onChange={update} />}
						{tab === 'character' && (
							<>
								{warnings.length > 0 && (
									<div className="notice" role="status">
										<strong>Check after import</strong>
										<ul>
											{warnings.map(w => (
												<li key={w}>{w}</li>
											))}
										</ul>
										<button className="link" onClick={() => setWarnings([])}>
											Dismiss
										</button>
									</div>
								)}
								{characterSheet}
							</>
						)}
					</SimProvider>
				)}
			</main>
			<BackToTop />

			<footer className="colophon">
				Item data and stat weights from <a href="https://github.com/wowsims/forever">WoWSims Forever</a>
				{data && <>, data built {new Date(data.builtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>}. Drop chances, extra sources and the top picks of the linked guides from <a href="https://www.wowhead.com/forever">Wowhead</a>; the full guides are there. Further loot data from <a href="https://github.com/Hoizame/AtlasLootClassic">AtlasLootClassic</a> and <a href="https://www.curseforge.com/wow/addons/atlasloot-forever">AtlasLoot Classic Forever</a>. Item icons and game content are © Blizzard Entertainment. This is a fan project, not affiliated with or endorsed by Blizzard.
			</footer>
		</div>
	);
}

/**
 * Two buttons at the bottom right: back to the top once the page is scrolled a screen down, and down to the end
 * while there is more than a screen left below.
 */
function BackToTop() {
	const [shown, setShown] = useState({ top: false, bottom: false });
	useEffect(() => {
		const check = () => {
			const left = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
			const next = { top: window.scrollY > window.innerHeight * 0.8, bottom: left > window.innerHeight };
			setShown(was => (was.top === next.top && was.bottom === next.bottom ? was : next));
		};
		check();
		window.addEventListener('scroll', check, { passive: true });
		window.addEventListener('resize', check);
		// The page grows and shrinks with its lists: look again when it does.
		const watcher = new ResizeObserver(check);
		watcher.observe(document.body);
		return () => {
			window.removeEventListener('scroll', check);
			window.removeEventListener('resize', check);
			watcher.disconnect();
		};
	}, []);
	if (!shown.top && !shown.bottom) return null;
	const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
	return (
		<div className="page-jumps">
			{shown.top && (
				<button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior })} title="Back to the top of the page" aria-label="Back to the top of the page">
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
						<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
					</svg>
					Top
				</button>
			)}
			{shown.bottom && (
				<button className="back-to-top" onClick={() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior })} title="Down to the end of the page" aria-label="Down to the end of the page">
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
						<path d="M8 3v10M3.5 8.5 8 13l4.5-4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
					</svg>
					Bottom
				</button>
			)}
		</div>
	);
}
