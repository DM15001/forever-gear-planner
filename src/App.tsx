import { useEffect, useMemo, useState } from 'react';

import { CharacterSheet } from './components/CharacterSheet';
import { EnchantsTab } from './components/EnchantsTab';
import { FarmTab } from './components/FarmTab';
import { ImportPanel } from './components/ImportPanel';
import { BarCap, Emblem } from './components/Ornaments';
import { PlanTab } from './components/PlanTab';
import { SimProvider } from './components/Sim';
import { UpgradesTab } from './components/UpgradesTab';
import { type GameData, loadGameData } from './lib/gameData';
import type { ImportResult } from './lib/importCharacter';
import type { SourceFilter } from './lib/scoring';
import { activeCharacter, addCharacter, characterLabel, removeActive, replaceActive, type Roster, selectCharacter, sharedCharacter, shareUrl } from './lib/roster';
import { specOf, specsOfClass } from './lib/specs';
import { loadFilter, loadRoster, loadTheme, loadWeights, saveFilter, saveRoster, saveTheme, saveWeights } from './lib/storage';
import { resolveTheme, THEME_CHOICES, type ThemeChoice } from './lib/theme';
import type { Character, SpecConfig } from './lib/types';


const TABS = [
	{ id: 'character', label: 'Character' },
	{ id: 'plan', label: 'Plan' },
	{ id: 'upgrades', label: 'Upgrades' },
	{ id: 'farm', label: 'Farm plan' },
	{ id: 'enchants', label: 'Enchants & professions' },
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
	// eslint-disable-next-line react-hooks/exhaustive-deps
	const customWeights = useMemo(() => loadWeights(baseSpec.id), [baseSpec.id, weightsVersion]);
	const spec = useMemo(() => (customWeights ? { ...baseSpec, weights: customWeights } : baseSpec), [baseSpec, customWeights]);
	const changeWeights = (weights: SpecConfig['weights'] | null) => {
		saveWeights(baseSpec.id, weights);
		setWeightsVersion(version => version + 1);
	};
	const changeRoster = (next: Roster) => {
		setRoster(next);
		saveRoster(next);
	};
	const [warnings, setWarnings] = useState<string[]>([]);
	const [importing, setImporting] = useState(false);
	const [tab, setTab] = useState('character');
	// The content choice, shared by every tab and remembered between visits.
	const [filter, setFilterState] = useState<SourceFilter>(loadFilter);
	const setFilter = (next: SourceFilter) => {
		setFilterState(next);
		saveFilter(next);
	};
	// The look: Alliance, Horde or the neutral Forever one. By default it follows the character's faction.
	const [themeChoice, setThemeChoice] = useState<ThemeChoice>(loadTheme);
	const theme = resolveTheme(themeChoice, character, baseSpec);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	// The item data is narrowed to the spec, so it is loaded again when the spec changes.
	const [loaded, setLoaded] = useState<{ specId: string; data: GameData } | null>(null);
	const [dataError, setDataError] = useState(false);
	const data = loaded?.specId === baseSpec.id ? loaded.data : null;

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
		<div className="page">
			<header className="masthead">
				<div className="masthead-title">
					<Emblem theme={theme} />
					<div>
						<h1>Forever Gear Planner</h1>
						<p className="masthead-sub">{character ? `${spec.name}, pre-raid` : 'Pre-raid gear for WoW: Forever'}</p>
					</div>
				</div>
				<div className="masthead-side">
					<label className="theme-picker">
						Theme
						<select
							value={themeChoice}
							onChange={e => {
								const next = e.target.value as ThemeChoice;
								setThemeChoice(next);
								saveTheme(next);
							}}
						>
							{THEME_CHOICES.map(c => (
								<option key={c.id} value={c.id}>
									{c.label}
								</option>
							))}
						</select>
					</label>
					<div className="tab-bar">
						<BarCap />
						<nav className="tabs" aria-label="Sections">
							{TABS.map(t => (
								<button key={t.id} className="tab" aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
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

				{(!character || importing) && <ImportPanel hasCharacter={Boolean(character)} onImported={onImported} onCancel={() => setImporting(false)} />}

				{character && !importing && (
					<SimProvider character={character}>
						{tab === 'plan' && (data ? <PlanTab spec={spec} character={character} data={data} filter={filter} onFilterChange={setFilter} onChange={update} /> : <p>Loading item data…</p>)}

						{tab === 'upgrades' && (data ? <UpgradesTab spec={spec} defaultWeights={baseSpec.weights} onWeightsChange={changeWeights} character={character} data={data} onChange={update} filter={filter} onFilterChange={setFilter} /> : <p>Loading item data…</p>)}

						{tab === 'farm' && (data ? <FarmTab spec={spec} character={character} data={data} filter={filter} /> : <p>Loading item data…</p>)}

						{tab === 'enchants' && (data ? <EnchantsTab spec={spec} character={character} data={data} filter={filter} onChange={update} /> : <p>Loading item data…</p>)}

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
									<button className="button button-primary" onClick={() => setTab('plan')}>
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
				{data && <>, data built {new Date(data.builtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>}. Drop chances and extra sources from Wowhead, <a href="https://github.com/Hoizame/AtlasLootClassic">AtlasLootClassic</a> and <a href="https://www.curseforge.com/wow/addons/atlasloot-forever">AtlasLoot Classic Forever</a>. Item icons and game content are © Blizzard Entertainment. This is a fan project, not affiliated with or endorsed by Blizzard.
			</footer>
		</div>
	);
}
