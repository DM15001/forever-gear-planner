import { useState } from 'react';

import { importCharacter, ImportError, type ImportResult } from '../lib/importCharacter';
import { SPECS } from '../lib/specs';

interface Props {
	hasCharacter: boolean;
	onImported: (result: ImportResult) => void;
	onCancel: () => void;
}

export function ImportPanel({ hasCharacter, onImported, onCancel }: Props) {
	const [text, setText] = useState('');
	const [error, setError] = useState<string | null>(null);

	const [example, setExample] = useState(SPECS[0].id);
	const [loading, setLoading] = useState(false);

	// An example is the gear, talents and race WoWSims ships as the preset of a build.
	const loadExample = async () => {
		setLoading(true);
		setError(null);
		try {
			const response = await fetch(`${import.meta.env.BASE_URL}sim/template.${example}.json`);
			if (!response.ok) throw new Error(String(response.status));
			const template = await response.json();
			onImported(importCharacter(JSON.stringify({ player: template.raid.parties[0].players[0] })));
		} catch {
			setError('The example could not be loaded.');
		} finally {
			setLoading(false);
		}
	};
	const classes = [...new Set(SPECS.map(spec => spec.className))].map(name => name.charAt(0).toUpperCase() + name.slice(1));

	const submit = () => {
		try {
			onImported(importCharacter(text));
		} catch (err) {
			setError(err instanceof ImportError ? err.message : 'The export could not be read.');
		}
	};

	// The WoWSims preset of a build as a character: its gear, talents and race. Builds are grouped by class.
	const presetPicker = (label: string) => (
		<div className="start-example">
			<label className="field-label" htmlFor="example-build">
				{label}
			</label>
			<div className="start-example-row">
				<select id="example-build" value={example} onChange={e => setExample(e.target.value)}>
					{[...new Set(SPECS.map(spec => spec.className))].map(className => (
						<optgroup key={className} label={className.charAt(0).toUpperCase() + className.slice(1)}>
							{SPECS.filter(spec => spec.className === className).map(spec => (
								<option key={spec.id} value={spec.id}>
									{spec.name}
								</option>
							))}
						</optgroup>
					))}
				</select>
				<button className="button" onClick={loadExample} disabled={loading}>
					{loading ? 'Loading…' : 'Load the WoWSims preset'}
				</button>
			</div>
		</div>
	);

	return (
		<div className={hasCharacter ? undefined : 'start'}>
			{!hasCharacter && (
				<section className="start-intro" aria-labelledby="start-title">
					<h2 id="start-title">Plan your pre-raid gear</h2>
					<ul className="start-points">
						<li>
							<strong>See what to upgrade.</strong> Every item per slot, ranked against what you wear.
						</li>
						<li>
							<strong>See where to get it.</strong> A farm plan by dungeon, with drop chances and runs to expect.
						</li>
						<li>
							<strong>See what it is worth.</strong> The real WoWSims simulator runs in this page and shows the DPS.
						</li>
					</ul>
					<p className="slot-source">
						Damage builds for {classes.slice(0, -1).join(', ')} and {classes[classes.length - 1]}. Your characters stay in this browser; nothing is sent to a server.
					</p>
					{presetPicker('No export at hand? Try an example')}
				</section>
			)}
			<section className="import" aria-labelledby="import-title">
			<h2 id="import-title">{hasCharacter ? 'Add another character' : 'Import your character'}</h2>
			<ol className="import-steps">
				<li>Install the "WoWSims Exporter" addon (CurseForge or any addon manager) and log in.</li>
				<li>Type /wse in the chat and copy the text it shows. A JSON export from the sim at wowsims.com works too.</li>
				<li>Paste it here.</li>
			</ol>
			<label className="field-label" htmlFor="import-text">
				Character export
			</label>
			<textarea
				id="import-text"
				className="import-text"
				value={text}
				spellCheck={false}
				placeholder='{ "class": "shaman", "gear": { "items": [ ... ] } }'
				aria-invalid={error ? true : undefined}
				aria-describedby={error ? 'import-error' : undefined}
				onChange={e => {
					setText(e.target.value);
					setError(null);
				}}
			/>
			{error && (
				<p id="import-error" className="field-error" role="alert">
					{error}
				</p>
			)}
			<div className="actions">
				<button className="button button-primary" onClick={submit} disabled={!text.trim()}>
					Import character
				</button>
				{hasCharacter && (
					<button className="button" onClick={onCancel}>
						Cancel
					</button>
				)}
			</div>
			{hasCharacter && (
				<>
					<p className="hint">The new character is added next to the ones saved in this browser.</p>
					{presetPicker('Or start from a ready-made WoWSims character')}
				</>
			)}
			</section>
		</div>
	);
}
