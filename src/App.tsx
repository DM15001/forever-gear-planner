import { useEffect, useMemo, useState } from 'react';

import { CharacterSheet } from './components/CharacterSheet';
import { EnchantsTab } from './components/EnchantsTab';
import { FarmTab } from './components/FarmTab';
import { ImportPanel } from './components/ImportPanel';
import { PlanTab } from './components/PlanTab';
import { SimProvider } from './components/Sim';
import { UpgradesTab } from './components/UpgradesTab';
import { type GameData, loadGameData } from './lib/gameData';
import type { ImportResult } from './lib/importCharacter';
import type { SourceFilter } from './lib/scoring';
import { loadCharacter, loadFilter, loadTheme, loadWeights, saveCharacter, saveFilter, saveTheme, saveWeights } from './lib/storage';
import { resolveTheme, THEME_CHOICES, type ThemeChoice } from './lib/theme';
import type { Character, SpecConfig } from './lib/types';
import specJson from './specs/enhancement-shaman.json';

const defaultSpec = specJson as unknown as SpecConfig;

const TABS = [
	{ id: 'character', label: 'Character' },
	{ id: 'plan', label: 'Plan' },
	{ id: 'upgrades', label: 'Upgrades' },
	{ id: 'farm', label: 'Farm plan' },
	{ id: 'enchants', label: 'Enchants & professions' },
];

export function App() {
	// The user's own stat weights replace the spec's defaults everywhere a score is computed.
	const [customWeights, setCustomWeights] = useState(() => loadWeights(defaultSpec.id));
	const spec = useMemo(() => (customWeights ? { ...defaultSpec, weights: customWeights } : defaultSpec), [customWeights]);
	const changeWeights = (weights: SpecConfig['weights'] | null) => {
		setCustomWeights(weights);
		saveWeights(defaultSpec.id, weights);
	};
	const [character, setCharacter] = useState<Character | null>(loadCharacter);
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
	const theme = resolveTheme(themeChoice, character, defaultSpec);
	useEffect(() => {
		document.documentElement.dataset.theme = theme;
	}, [theme]);
	const [data, setData] = useState<GameData | null>(null);
	const [dataError, setDataError] = useState(false);

	useEffect(() => {
		loadGameData().then(setData, () => setDataError(true));
	}, []);

	const update = (next: Character | null) => {
		setCharacter(next);
		saveCharacter(next);
	};

	const onImported = (result: ImportResult) => {
		update(result.character);
		setTab('character');
		setWarnings(result.warnings);
		setImporting(false);
	};

	return (
		<div className="page">
			<header className="masthead">
				<div>
					<h1>Forever Gear Planner</h1>
					<p className="masthead-sub">{spec.name}, pre-raid</p>
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
					<nav className="tabs" aria-label="Sections">
						{TABS.map(t => (
							<button key={t.id} className="tab" aria-current={t.id === tab ? 'page' : undefined} onClick={() => setTab(t.id)}>
								{t.label}
							</button>
						))}
					</nav>
				</div>
			</header>

			<main>
				{dataError && <p className="notice notice-error">The item data could not be loaded. Reload the page; if that does not help, run "npm run build-data".</p>}

				{(!character || importing) && <ImportPanel spec={spec} hasCharacter={Boolean(character)} onImported={onImported} onCancel={() => setImporting(false)} />}

				{character && !importing && (
					<SimProvider character={character}>
						{tab === 'plan' && (data ? <PlanTab spec={spec} character={character} data={data} filter={filter} onFilterChange={setFilter} onChange={update} /> : <p>Loading item data…</p>)}

						{tab === 'upgrades' && (data ? <UpgradesTab spec={spec} defaultWeights={defaultSpec.weights} onWeightsChange={changeWeights} character={character} data={data} onChange={update} filter={filter} onFilterChange={setFilter} /> : <p>Loading item data…</p>)}

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
										update(null);
										setWarnings([]);
									}}
								/>
							</>
						)}
					</SimProvider>
				)}
			</main>

			<footer className="colophon">
				Item data and stat weights from <a href="https://github.com/wowsims/forever">WoWSims Forever</a>
				{data && <>, data built {new Date(data.builtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>}. Item icons and game content are © Blizzard Entertainment. This is a fan project, not affiliated with or endorsed by Blizzard.
			</footer>
		</div>
	);
}
