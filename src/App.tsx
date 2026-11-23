import { useCallback, useEffect, useMemo, useState } from 'react';

import { CharacterSheet } from './components/CharacterSheet';
import { EnchantsTab } from './components/EnchantsTab';
import { castingShare, countsMending, mendingWeights } from './lib/sim/mending';
import { NewsTab, newsUnseen } from './components/NewsTab';
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
	{ id: 'upgrades', label: 'Upgrades', step: 2 },
	{ id: 'farm', label: 'Farm plan', step: 3 },
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

/** Hidden on the live site until the unlock word is typed anywhere outside a text field; typing it again hides it. The dev copy always shows it, as the way back. */
function ChannelSwitch() {
	const [unlocked, setUnlocked] = useState(switchUnlocked);
	useEffect(() => {
		let typed = '';
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
			if (event.key.length !== 1) return;
			typed = (typed + event.key.toLowerCase()).slice(-SWITCH_WORD.length);
			if (typed !== SWITCH_WORD) return;
			typed = '';
			setUnlocked(was => {
				try {
					if (was) localStorage.removeItem(SWITCH_KEY);
					else localStorage.setItem(SWITCH_KEY, '1');
				} catch {
					// Private windows may refuse storage; the switch then lasts until the page is closed.
				}
				return !was;
			});
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, []);
	if (!IS_DEV && !unlocked) return null;
	const other = IS_DEV ? '../' : './dev/';
	return (
		<nav className={`channel-switch${IS_DEV ? ' channel-dev' : ''}`} aria-label="Site version">
			{IS_DEV ? <a href={other}>Live</a> : <span aria-current="page">Live</span>}
			{IS_DEV ? <span aria-current="page">Dev</span> : <a href={other}>Dev</a>}
		</nav>
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
						{tab === 'upgrades' && (
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
						{tab === 'upgrades' && baseSpec.role === 'healer' && <HealingPicker character={character} spec={spec} onChange={update} />}
						{tab === 'upgrades' && upgradeView === 'plan' && (data ? <PlanTab spec={spec} character={character} data={data} filter={filter} onFilterChange={setFilter} onChange={update} /> : <p>Loading item data…</p>)}

						{tab === 'upgrades' && upgradeView === 'slots' && (data ? <UpgradesTab spec={spec} defaultWeights={scenarioSpec.weights} onWeightsChange={changeWeights} character={character} data={data} onChange={update} filter={filter} onFilterChange={setFilter} /> : <p>Loading item data…</p>)}

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
													setTab('upgrades');
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
