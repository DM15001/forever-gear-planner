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
import { SimProvider } from './components/Sim';
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

/** A dwarf in sunglasses: one thumb up, the other hand pointing up at the Live/Dev switch. Drawn here, not a character from any game. */
function CheerDwarf() {
	return (
		<svg className="cheer-dwarf" viewBox="0 0 140 150" width="140" height="150" aria-hidden="true">
			{/* arm pointing up and to the right, at the switch */}
			<path d="M92 92 L118 44" stroke="#7a4a2a" strokeWidth="13" strokeLinecap="round" />
			<path d="M118 44 L127 22" stroke="#e8b48a" strokeWidth="7" strokeLinecap="round" />
			<circle cx="117" cy="45" r="9" fill="#e8b48a" />
			{/* thumbs-up arm */}
			<path d="M48 94 L24 78" stroke="#7a4a2a" strokeWidth="13" strokeLinecap="round" />
			<rect x="4" y="62" width="26" height="20" rx="7" fill="#e8b48a" />
			<path d="M25 66 Q27 54 21 49" fill="none" stroke="#e8b48a" strokeWidth="9" strokeLinecap="round" />
			<path d="M6 68 H19 M6 73 H19 M6 78 H18" stroke="#c98f66" strokeWidth="1.6" strokeLinecap="round" />
			{/* body, belt, boots */}
			<rect x="42" y="84" width="56" height="44" rx="14" fill="#7a4a2a" />
			<rect x="42" y="108" width="56" height="9" fill="#3a2414" />
			<rect x="63" y="106" width="14" height="13" rx="2" fill="#ffd100" />
			<rect x="44" y="126" width="22" height="16" rx="6" fill="#3a2414" />
			<rect x="74" y="126" width="22" height="16" rx="6" fill="#3a2414" />
			{/* head and helmet */}
			<circle cx="70" cy="56" r="26" fill="#e8b48a" />
			<path d="M43 50 Q70 8 97 50 Z" fill="#9aa3ad" />
			<rect x="41" y="46" width="58" height="8" rx="3" fill="#6d7680" />
			<path d="M43 48 Q30 34 34 20 Q46 30 50 44 Z" fill="#f2ead8" />
			<path d="M97 48 Q110 34 106 20 Q94 30 90 44 Z" fill="#f2ead8" />
			{/* beard */}
			<path d="M44 62 Q40 104 70 118 Q100 104 96 62 Q84 76 70 76 Q56 76 44 62 Z" fill="#d9772b" />
			<path d="M58 96 L58 112 M70 100 L70 118 M82 96 L82 112" stroke="#b55c1c" strokeWidth="3" strokeLinecap="round" />
			<path d="M54 78 Q70 90 86 78" fill="none" stroke="#1a1203" strokeWidth="3" strokeLinecap="round" />
			<ellipse cx="70" cy="70" rx="7" ry="6" fill="#d99a72" />
			{/* sunglasses */}
			<rect x="46" y="55" width="21" height="13" rx="4" fill="#0a0908" />
			<rect x="73" y="55" width="21" height="13" rx="4" fill="#0a0908" />
			<rect x="65" y="58" width="10" height="4" fill="#0a0908" />
			<path d="M50 58 L57 58 M77 58 L84 58" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" opacity="0.6" />
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
			if (next) cheerTimer = setTimeout(() => setCheer(false), 2800);
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

export function App() {
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
						{data && <GearRails spec={spec} character={character} data={data} />}
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
