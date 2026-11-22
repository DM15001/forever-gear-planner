import { useEffect, useMemo, useState } from 'react';

import { CharacterSheet } from './components/CharacterSheet';
import { EnchantsTab } from './components/EnchantsTab';
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
import { type GameData, loadGameData } from './lib/gameData';
import type { ImportResult } from './lib/importCharacter';
import type { SourceFilter } from './lib/scoring';
import { activeCharacter, addCharacter, characterLabel, removeActive, replaceActive, type Roster, selectCharacter, sharedCharacter, shareUrl } from './lib/roster';
import { specOf, specsOfClass } from './lib/specs';
import { loadFilter, loadRoster, loadWeights, saveFilter, saveRoster, saveWeights } from './lib/storage';
import type { Character, SpecConfig } from './lib/types';


const TABS = [
	{ id: 'character', label: 'Character', step: 1 },
	{ id: 'upgrades', label: 'Upgrades', step: 2 },
	{ id: 'farm', label: 'Farm plan', step: 3 },
	{ id: 'enchants', label: 'Enchants & professions' },
	{ id: 'sim', label: 'Sim setup' },
];

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
	const scenarioSpec = useMemo(() => {
		const measured = baseSpec.healing?.scenarios[healingKey];
		return measured ? { ...baseSpec, weights: { ...baseSpec.weights, stats: measured.weights } } : baseSpec;
	}, [baseSpec, healingKey]);
	const weightsKey = healingKey ? `${baseSpec.id}.${healingKey}` : baseSpec.id;
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
	// Step 2 has two ways in: the automatic plan, or every slot by hand.
	const [upgradeView, setUpgradeView] = useState<'plan' | 'slots'>(() => (Object.keys(character?.plan ?? {}).length > 0 ? 'slots' : 'plan'));
	// Stat weights, the sim comparison and raw rotation rules stay out of the way unless asked for.
	const [expert, setExpertState] = useState(() => {
		try {
			return localStorage.getItem('forever-gear-planner.expert') === '1';
		} catch {
			return false;
		}
	});
	const setExpert = (on: boolean) => {
		setExpertState(on);
		try {
			localStorage.setItem('forever-gear-planner.expert', on ? '1' : '0');
		} catch {
			// Private mode: the choice lasts for this visit only.
		}
	};
	// The content choice, shared by every tab and remembered between visits.
	const [filter, setFilterState] = useState<SourceFilter>(loadFilter);
	const setFilter = (next: SourceFilter) => {
		setFilterState(next);
		saveFilter(next);
	};
	// The item data is narrowed to the spec, so it is loaded again when the spec changes.
	const [loaded, setLoaded] = useState<{ specId: string; data: GameData } | null>(null);
	const [dataError, setDataError] = useState(false);
	const loadedData = loaded?.specId === baseSpec.id ? loaded.data : null;
	// The scores follow the enemy kind and terrain the character is set to fight.
	const fight = character?.fight;
	const data = useMemo(() => (loadedData ? { ...loadedData, fight } : null), [loadedData, fight]);

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
		changeRoster(addCharacter(roster, result.character));
		setTab('character');
		setWarnings(result.warnings);
		setImporting(false);
	};

	return (
		<div className={expert ? 'page' : 'page page-simple'}>
			<header className="masthead">
				<div className="masthead-title">
					<Emblem />
					<div>
						<h1>Forever Gear Planner</h1>
						<p className="masthead-sub">{character ? `${spec.name}, pre-raid` : 'Pre-raid gear for WoW: Forever'}</p>
					</div>
				</div>
				<div className="masthead-side">
					<div className="tab-bar">
						<BarCap />
						<nav className="tabs" aria-label="Sections">
							{TABS.map(t => (
								<button key={t.id} className="tab" aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
									{'step' in t && <span className="tab-step">{t.step}</span>}
									{t.label}
								</button>
							))}
						</nav>
						<BarCap mirrored />
					</div>
					{character && (
						<label className="expert-switch" title="Shows the stat weights, the side-by-side comparison with other sims and the raw rotation rules.">
							<input type="checkbox" checked={expert} onChange={e => setExpert(e.target.checked)} /> Expert details
						</label>
					)}
				</div>
			</header>

			<main>
				{dataError && <p className="notice notice-error">The item data could not be loaded. Reload the page; if that does not help, run "npm run build-data".</p>}

				{(!character || importing) && <ImportPanel hasCharacter={Boolean(character)} onImported={onImported} onCancel={() => setImporting(false)} />}

				{character && !importing && (
					<SimProvider character={character}>
						{tab === 'upgrades' && (
							<div className="view-switch" role="group" aria-label="How to pick upgrades">
								<button className="button button-small" aria-pressed={upgradeView === 'plan'} onClick={() => setUpgradeView('plan')}>
									Plan for me
								</button>
								<button className="button button-small" aria-pressed={upgradeView === 'slots'} onClick={() => setUpgradeView('slots')}>
									Slot by slot
								</button>
								<span className="slot-source">{upgradeView === 'plan' ? 'Say what content you do and get the best set with a to-do list.' : 'Every slot with its upgrades and alternatives, to pick by hand.'}</span>
							</div>
						)}
						{tab === 'upgrades' && baseSpec.role === 'healer' && <HealingPicker character={character} spec={baseSpec} onChange={update} />}
						{tab === 'upgrades' && upgradeView === 'plan' && (data ? <PlanTab spec={spec} character={character} data={data} filter={filter} onFilterChange={setFilter} onChange={update} /> : <p>Loading item data…</p>)}

						{tab === 'upgrades' && upgradeView === 'slots' && (data ? <UpgradesTab spec={spec} defaultWeights={scenarioSpec.weights} onWeightsChange={changeWeights} character={character} data={data} onChange={update} filter={filter} onFilterChange={setFilter} /> : <p>Loading item data…</p>)}

						{tab === 'farm' && (data ? <FarmTab spec={spec} character={character} data={data} filter={filter} onChange={update} /> : <p>Loading item data…</p>)}

						{tab === 'enchants' && (data ? <EnchantsTab spec={spec} character={character} data={data} filter={filter} onChange={update} /> : <p>Loading item data…</p>)}

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
								<p className="next-step">
									Check race, professions and enchants below, then{' '}
									<button className="button button-primary" onClick={() => {
											setUpgradeView('plan');
											setTab('upgrades');
										}}>
										Build my gear plan
									</button>
								</p>
								<CharacterSheet
									spec={spec}
									character={character}
									data={data}
									onChange={update}
									onImportAnother={() => setImporting(true)}
									onRemove={() => {
										changeRoster(removeActive(roster));
										setWarnings([]);
									}}
									names={roster.characters.map((c, i) => characterLabel(c, i, specOf(c)))}
									builds={specsOfClass(baseSpec.className)}
									activeIndex={roster.active}
									onSelect={index => {
										changeRoster(selectCharacter(roster, index));
										setWarnings([]);
									}}
									shareLink={shareUrl(character, window.location.href)}
								/>
							</>
						)}
					</SimProvider>
				)}
			</main>

			<footer className="colophon">
				Item data and stat weights from <a href="https://github.com/wowsims/forever">WoWSims Forever</a>
				{data && <>, data built {new Date(data.builtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>}. Drop chances, extra sources and the top picks of the linked guides from <a href="https://www.wowhead.com/forever">Wowhead</a>; the full guides are there. Further loot data from <a href="https://github.com/Hoizame/AtlasLootClassic">AtlasLootClassic</a> and <a href="https://www.curseforge.com/wow/addons/atlasloot-forever">AtlasLoot Classic Forever</a>. Item icons and game content are © Blizzard Entertainment. This is a fan project, not affiliated with or endorsed by Blizzard.
			</footer>
		</div>
	);
}
