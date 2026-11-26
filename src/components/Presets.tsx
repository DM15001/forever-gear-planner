import { Help } from './Help';
import { createContext, useContext, useEffect, useRef, useState } from 'react';

/** The gear presets of the open character: the same character saved under several names (Main, Fire, vs beasts), each with its own build, worn gear and plan. */
export interface Presets {
	list: { index: number; label: string; /** The build of that preset, to tell them apart. */ spec?: string }[];
	/** Place of the open preset in the saved list. */
	active: number;
	create: (name: string) => void;
	select: (index: number) => void;
	remove: (index: number) => void;
}

export const PresetContext = createContext<Presets | null>(null);

/** A small window that asks before a preset is deleted. */
function ConfirmDelete({ label, onYes, onNo }: { label: string; onYes: () => void; onNo: () => void }) {
	const no = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		no.current?.focus();
		const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onNo();
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [onNo]);
	return (
		<div className="preset-confirm-veil" onClick={onNo}>
			<div className="preset-confirm" role="alertdialog" aria-modal="true" aria-labelledby="preset-confirm-title" onClick={event => event.stopPropagation()}>
				<h3 id="preset-confirm-title">Delete the preset "{label}"?</h3>
				<p>Its build, worn gear and plan are gone for good. Your other presets stay.</p>
				<div className="preset-confirm-actions">
					<button className="button button-danger" onClick={onYes}>
						Delete preset
					</button>
					<button className="button" ref={no} onClick={onNo}>
						Keep it
					</button>
				</div>
			</div>
		</div>
	);
}

/** The form that names a new preset. */
function NewPreset({ onCreate, onCancel }: { onCreate: (name: string) => void; onCancel: () => void }) {
	const [name, setName] = useState('');
	return (
		<form
			className="preset-new"
			onSubmit={event => {
				event.preventDefault();
				if (name.trim()) onCreate(name);
			}}>
			<input type="text" autoFocus maxLength={30} value={name} onChange={event => setName(event.target.value)} placeholder="Name: Fire, vs beasts…" aria-label="Name of the new preset" />
			<button className="button button-primary button-small" type="submit" disabled={!name.trim()}>
				Create
			</button>
			<button className="link" type="button" onClick={onCancel}>
				Cancel
			</button>
		</form>
	);
}

/** On the Character page: a list to pick the preset, and below it two buttons, create and delete. */
export function PresetField() {
	const presets = useContext(PresetContext);
	const [naming, setNaming] = useState(false);
	const [asking, setAsking] = useState(false);
	if (!presets) return null;
	const current = presets.list.find(preset => preset.index === presets.active);
	const only = presets.list.length < 2;
	return (
		<div className="preset-field">
			<label className="field-label" htmlFor="preset">
				Preset
				<Help label="What a preset is">
					A preset is this character once more, with its own build, worn gear and plan: one for fire, one for frost, one against beasts. A new preset starts as a copy of the one that is open.
				</Help>
			</label>
			<select id="preset" value={presets.active} onChange={event => presets.select(Number(event.target.value))}>
				{presets.list.map(preset => (
					<option key={preset.index} value={preset.index}>
						{preset.label}
						{preset.spec ? ` (${preset.spec})` : ''}
					</option>
				))}
			</select>
			{naming ? (
				<NewPreset
					onCreate={name => {
						presets.create(name);
						setNaming(false);
					}}
					onCancel={() => setNaming(false)}
				/>
			) : (
				<div className="preset-buttons">
					<button className="button" onClick={() => setNaming(true)} title="Create a preset: a copy of this one under a name of your choice">
						Create<span className="preset-word"> preset</span>
					</button>
					<button className="button" disabled={only} onClick={() => setAsking(true)} title={only ? 'This is the only preset of this character.' : `Delete the preset "${current?.label}"`}>
						Delete<span className="preset-word"> preset</span>
					</button>
				</div>
			)}
			{asking && current && (
				<ConfirmDelete
					label={current.label}
					onYes={() => {
						setAsking(false);
						presets.remove(current.index);
					}}
					onNo={() => setAsking(false)}
				/>
			)}
		</div>
	);
}

/** In the gear panes at the side: a small menu. New preset at the top, then the presets, each with a minus to delete it. */
export function PresetMenu() {
	const presets = useContext(PresetContext);
	const [open, setOpen] = useState(false);
	const [naming, setNaming] = useState(false);
	const [asking, setAsking] = useState<{ index: number; label: string; spec?: string } | null>(null);
	const box = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const away = (event: MouseEvent) => {
			if (!box.current?.contains(event.target as Node)) {
				setOpen(false);
				setNaming(false);
			}
		};
		const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
		document.addEventListener('mousedown', away);
		window.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('mousedown', away);
			window.removeEventListener('keydown', onKey);
		};
	}, [open]);
	if (!presets) return null;
	const current = presets.list.find(preset => preset.index === presets.active);
	const only = presets.list.length < 2;
	return (
		<div className="preset-menu" ref={box}>
			<button className="preset-menu-button" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen(!open)} title="Presets of this character">
				<span>
					{current?.label ?? 'Main'}
					{current?.spec && <small>{current.spec}</small>}
				</span>
				<svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true">
					<path d="M3 6l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
				</svg>
			</button>
			{open && (
				<div className="preset-menu-list">
					{naming ? (
						<NewPreset
							onCreate={name => {
								presets.create(name);
								setNaming(false);
								setOpen(false);
							}}
							onCancel={() => setNaming(false)}
						/>
					) : (
						<button className="preset-menu-new" onClick={() => setNaming(true)}>
							+ New preset
						</button>
					)}
					{presets.list.map(preset => (
						<div key={preset.index} className={`preset-menu-row${preset.index === presets.active ? ' preset-menu-on' : ''}`}>
							<button className="preset-menu-minus" disabled={only} onClick={() => setAsking(preset)} title={only ? 'The only preset cannot be deleted.' : `Delete the preset "${preset.label}"`} aria-label={`Delete the preset ${preset.label}`}>
								−
							</button>
							<button
								className="preset-menu-pick"
								aria-current={preset.index === presets.active ? 'true' : undefined}
								onClick={() => {
									presets.select(preset.index);
									setOpen(false);
								}}>
								{preset.label}
								{preset.spec && <small>{preset.spec}</small>}
							</button>
						</div>
					))}
				</div>
			)}
			{asking && (
				<ConfirmDelete
					label={asking.label}
					onYes={() => {
						presets.remove(asking.index);
						setAsking(null);
						setOpen(false);
					}}
					onNo={() => setAsking(null)}
				/>
			)}
		</div>
	);
}
