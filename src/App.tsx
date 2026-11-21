import { useEffect, useState } from 'react';

import { CharacterSheet } from './components/CharacterSheet';
import { ImportPanel } from './components/ImportPanel';
import { type GameData, loadGameData } from './lib/gameData';
import type { ImportResult } from './lib/importCharacter';
import { loadCharacter, saveCharacter } from './lib/storage';
import type { Character, SpecConfig } from './lib/types';
import specJson from './specs/enhancement-shaman.json';

const spec = specJson as unknown as SpecConfig;

const TABS = [
	{ id: 'character', label: 'Character', ready: true },
	{ id: 'upgrades', label: 'Upgrades', ready: false },
	{ id: 'farm', label: 'Farm plan', ready: false },
	{ id: 'enchants', label: 'Enchants & professions', ready: false },
];

export function App() {
	const [character, setCharacter] = useState<Character | null>(loadCharacter);
	const [warnings, setWarnings] = useState<string[]>([]);
	const [importing, setImporting] = useState(false);
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
				<nav className="tabs" aria-label="Sections">
					{TABS.map(tab => (
						<button key={tab.id} className="tab" aria-current={tab.id === 'character' ? 'page' : undefined} disabled={!tab.ready} title={tab.ready ? undefined : 'Not built yet'}>
							{tab.label}
						</button>
					))}
				</nav>
			</header>

			<main>
				{dataError && <p className="notice notice-error">The item data could not be loaded. Reload the page; if that does not help, run "npm run build-data".</p>}

				{(!character || importing) && <ImportPanel spec={spec} hasCharacter={Boolean(character)} onImported={onImported} onCancel={() => setImporting(false)} />}

				{character && !importing && (
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
							onImportAnother={() => setImporting(true)}
							onRemove={() => {
								update(null);
								setWarnings([]);
							}}
						/>
					</>
				)}
			</main>

			<footer className="colophon">
				Item data and stat weights from <a href="https://github.com/wowsims/forever">WoWSims Forever</a>
				{data && <>, data built {new Date(data.builtAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}</>}. Not affiliated with Blizzard.
			</footer>
		</div>
	);
}
