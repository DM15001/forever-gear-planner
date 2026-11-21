import { useState } from 'react';

import { importCharacter, ImportError, type ImportResult } from '../lib/importCharacter';
import type { SpecConfig } from '../lib/types';

interface Props {
	spec: SpecConfig;
	hasCharacter: boolean;
	onImported: (result: ImportResult) => void;
	onCancel: () => void;
}

export function ImportPanel({ spec, hasCharacter, onImported, onCancel }: Props) {
	const [text, setText] = useState('');
	const [error, setError] = useState<string | null>(null);

	const submit = () => {
		try {
			onImported(importCharacter(text, spec));
		} catch (err) {
			setError(err instanceof ImportError ? err.message : 'The export could not be read.');
		}
	};

	return (
		<section className="import" aria-labelledby="import-title">
			<h2 id="import-title">{hasCharacter ? 'Import another character' : 'Import your character'}</h2>
			<ol className="import-steps">
				<li>In game, open the WoWSims Exporter addon and copy the export text. A JSON export from the sim at wowsims.com works too.</li>
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
			{hasCharacter && <p className="hint">Importing replaces the character saved in this browser.</p>}
		</section>
	);
}
