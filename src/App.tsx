import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { CharacterSheet } from './components/CharacterSheet';
import { EnchantsTab } from './components/EnchantsTab';
import { castingShare, countsMending, mendingWeights } from './lib/sim/mending';
import { NewsTab, newsUnseen } from './components/NewsTab';
import { GearRails } from './components/GearRail';
import { CharacterBar } from './components/CharacterBar';
import { ClassIcon } from './components/ClassIcon';
import { FarmTab } from './components/FarmTab';
import { HealingPicker } from './components/HealingPicker';
import { setUnit } from './lib/format';
import { healingChoice, scenarioKey } from './lib/sim/healing';
import { ImportPanel } from './components/ImportPanel';
import { BarCap, Emblem } from './components/Ornaments';
import { PlanTab } from './components/PlanTab';
import { SimSetupTab } from './components/SimSetupTab';
import { Modal, SimProvider } from './components/Sim';
import { UpgradesTab } from './components/UpgradesTab';
import { type GameData, loadGameData, dataFor } from './lib/gameData';
import type { ImportResult } from './lib/importCharacter';
import { DEFAULT_FILTER, type SourceFilter } from './lib/scoring';
import { activeCharacter, addCharacter, characterLabel, removeActive, replaceActive, type Roster, selectCharacter, sharedCharacter, shareUrl } from './lib/roster';
import { specOf, specsOfClass } from './lib/specs';
import { loadFilter, loadRoster, loadWeights, normalFilter, saveRoster, saveWeights } from './lib/storage';
import type { Character, SpecConfig } from './lib/types';


const TABS = [
	{ id: 'character', label: 'Character', step: 1 },
	{ id: 'simulate', label: 'Simulation', step: 2 },
	{ id: 'upgrades', label: 'Upgrades', step: 3 },
	{ id: 'farm', label: 'Farm plan', step: 4 },
	{ id: 'enchants', label: 'Enchants & professions' },
	{ id: 'sim', label: 'Sim setup' },
	{ id: 'news', label: 'News' },
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

/** The site owner's dwarf as a cartoon: chain coif, long red beard, white tabard, big gauntlets. Sunglasses on, a smoke in the mouth, one finger for the world and the other hand pointing up at the Live/Dev switch. Drawn here. */
function CheerDwarf() {
	return (
		<svg className="cheer-dwarf" viewBox="0 0 180 200" width="180" height="200" aria-hidden="true">
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
			{/* legs and boots */}
			<rect x="64" y="150" width="22" height="26" rx="6" fill="#7a5a3c" />
			<rect x="94" y="150" width="22" height="26" rx="6" fill="#7a5a3c" />
			<rect x="62" y="158" width="26" height="7" rx="3" fill="#b8402e" />
			<rect x="92" y="158" width="26" height="7" rx="3" fill="#b8402e" />
			<ellipse cx="72" cy="182" rx="18" ry="10" fill="#8a7fb8" />
			<ellipse cx="108" cy="182" rx="18" ry="10" fill="#8a7fb8" />
			{/* shoulder pads, mail, tabard, belt */}
			<ellipse cx="54" cy="98" rx="22" ry="14" fill="#2b2a33" />
			<ellipse cx="126" cy="98" rx="22" ry="14" fill="#2b2a33" />
			<path d="M40 94 Q52 82 66 90 M114 90 Q128 82 140 94" fill="none" stroke="#55535f" strokeWidth="3" strokeLinecap="round" />
			<rect x="58" y="92" width="64" height="64" rx="16" fill="#8d949c" />
			<path d="M68 92 H112 V148 Q90 160 68 148 Z" fill="#f4f1e8" stroke="#d6a52c" strokeWidth="3" />
			<path d="M80 108 L90 118 L100 108 L96 124 L90 130 L84 124 Z" fill="#3a3a44" />
			<rect x="58" y="132" width="64" height="11" rx="4" fill="#d6a52c" />
			<circle cx="74" cy="137.5" r="3.5" fill="#5fc4e8" />
			<circle cx="90" cy="137.5" r="4.5" fill="#5fc4e8" />
			<circle cx="106" cy="137.5" r="3.5" fill="#5fc4e8" />
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
			{/* sunglasses */}
			<path d="M64 52 H116" stroke="#0a0908" strokeWidth="3" />
			<path d="M66 52 H87 V60 Q87 68 77 68 Q66 68 66 60 Z" fill="#0a0908" />
			<path d="M93 52 H114 V60 Q114 68 103 68 Q93 68 93 60 Z" fill="#0a0908" />
			<path d="M70 56 L78 56 M97 56 L105 56" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.65" />
			{/* the smoke */}
			<path d="M96 86 L122 94" stroke="#f4f1e8" strokeWidth="6" strokeLinecap="round" />
			<path d="M119 93 L123 94.3" stroke="#ff7a1a" strokeWidth="6" strokeLinecap="round" />
			<circle className="cheer-smoke cheer-smoke-1" cx="128" cy="90" r="5" fill="#cfd4d8" />
			<circle className="cheer-smoke cheer-smoke-2" cx="130" cy="88" r="6" fill="#cfd4d8" />
			<circle className="cheer-smoke cheer-smoke-3" cx="127" cy="89" r="4" fill="#cfd4d8" />
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
			{cheer && <CheerDwarf />}
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

/** The gear button at the top right and the small window it opens. */
function OptionsButton({ options, onChange }: { options: ViewOptions; onChange: (next: ViewOptions) => void }) {
	const [open, setOpen] = useState(false);
	const tick = (key: keyof ViewOptions, label: string, hint: string) => (
		<label className="option-row">
			<input type="checkbox" checked={options[key]} onChange={event => onChange({ ...options, [key]: event.target.checked })} />
			<span>
				<strong>{label}</strong>
				<span className="slot-source">{hint}</span>
			</span>
		</label>
	);
	return (
		<>
			<button className="options-button" onClick={() => setOpen(true)} aria-label="Options" title="Options">
				<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
					<path
						d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zm8.4 5.1-1.7-.3a7 7 0 0 1-.6 1.5l1 1.4-1.6 1.6-1.4-1a7 7 0 0 1-1.5.6l-.3 1.7h-2.3l-.3-1.7a7 7 0 0 1-1.5-.6l-1.4 1-1.6-1.6 1-1.4a7 7 0 0 1-.6-1.5l-1.7-.3v-2.3l1.7-.3a7 7 0 0 1 .6-1.5l-1-1.4 1.6-1.6 1.4 1a7 7 0 0 1 1.5-.6l.3-1.7h2.3l.3 1.7a7 7 0 0 1 1.5.6l1.4-1 1.6 1.6-1 1.4a7 7 0 0 1 .6 1.5l1.7.3z"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.6"
						strokeLinejoin="round"
					/>
				</svg>
			</button>
			{open && (
				<Modal title="Options" onClose={() => setOpen(false)}>
					<p className="hint">Saved in this browser, for all your characters.</p>
					{tick('equippedPanel', 'Equipped gear at the left', 'The small list of what you wear, beside the page.')}
					{tick('plannedPanel', 'Planned gear at the right', 'The small list of your plan, beside the page.')}
					<p className="hint">Both lists only fit on wide screens (about 1600 pixels and up); narrower screens never show them.</p>
				</Modal>
			)}
		</>
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

	return (
		<div className="page">
			<ChannelSwitch />
			<OptionsButton options={options} onChange={changeOptions} />
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
				<div className="masthead-side">
					<div className="tab-bar">
						<BarCap />
						<nav className="tabs" aria-label="Sections">
							{TABS.map(t => (
								<button key={t.id} className="tab" aria-current={t.id === tab ? 'page' : undefined} onClick={() => {
										setTab(t.id);
										if (character) setImporting(false);
									}}>
									{'step' in t && <span className="tab-step">{t.step}</span>}
									{t.id === 'news' && newsDot && <span className="tab-dot" title="New since your last visit" aria-label="new" />}
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
				{(!character || importing) && <ImportPanel hasCharacter={Boolean(character)} onImported={onImported} onCancel={() => setImporting(false)} />}

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
						{data && <GearRails spec={spec} character={character} data={data} showEquipped={options.equippedPanel} showPlanned={options.plannedPanel} />}
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

						{(tab === 'simulate' || tab === 'upgrades') && upgradeView === 'slots' && (data ? <UpgradesTab part={tab === 'simulate' ? 'sim' : 'list'} spec={spec} defaultWeights={scenarioSpec.weights} onWeightsChange={changeWeights} character={character} data={data} onChange={update} filter={filter} onFilterChange={setFilter} /> : <p>Loading item data…</p>)}

						{tab === 'farm' && (data ? <FarmTab spec={spec} character={character} data={data} filter={filter} onChange={update} /> : <p>Loading item data…</p>)}

						{tab === 'enchants' && (data ? <EnchantsTab spec={spec} character={character} data={data} filter={filter} onChange={update} /> : <p>Loading item data…</p>)}

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
								<CharacterSheet
									spec={spec}
									character={character}
									data={data}
									onChange={update}
									names={roster.characters.map((c, i) => characterLabel(c, i, specOf(c)))}
									builds={specsOfClass(baseSpec.className)}
									activeIndex={roster.active}
									shareLink={shareUrl(character, window.location.href)}
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

/** A button that brings the page back to its top; it appears once the page is scrolled a screen down. */
function BackToTop() {
	const [shown, setShown] = useState(false);
	useEffect(() => {
		const check = () => setShown(window.scrollY > window.innerHeight * 0.8);
		check();
		window.addEventListener('scroll', check, { passive: true });
		return () => window.removeEventListener('scroll', check);
	}, []);
	if (!shown) return null;
	const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	return (
		<button className="back-to-top" onClick={() => window.scrollTo({ top: 0, behavior: still ? 'auto' : 'smooth' })} title="Back to the top of the page" aria-label="Back to the top of the page">
			<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
				<path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
			</svg>
			Top
		</button>
	);
}
