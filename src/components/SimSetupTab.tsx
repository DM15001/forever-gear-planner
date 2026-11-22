import { useEffect, useMemo, useState } from 'react';

import { simClient } from '../lib/sim/client';
import type { SimTemplate } from '../lib/sim/request';
import {
	BUFF_SCOPES,
	type BuffField,
	type BuffScope,
	buffValue,
	clashingGroups,
	CONSUMABLE_FIELDS,
	type ConsumablePicks,
	describeFlags,
	describeOptions,
	describeRotation,
	parseTalents,
	type RotationLine,
	rotationSourceUrl,
	serializeTalents,
	type SimSetupData,
	talentPointsAt,
	talentPointsSpent,
} from '../lib/sim/setup';
import type { Character, SpecConfig } from '../lib/types';

interface Props {
	spec: SpecConfig;
	character: Character;
	onChange: (next: Character) => void;
}

const MAX_LEVEL = 60;

function Steps({ lines, showRaw }: { lines: RotationLine[]; showRaw: boolean }) {
	return (
		<ol className="rotation-steps">
			{lines.map((line, index) => (
				<li key={index} title={line.raw ? `The WoWSims rule behind this step:\n${line.raw}` : undefined}>
					<span className="rotation-do">{line.text}</span>
					{line.when && <span className="rotation-when"> when {line.when}</span>}
					{showRaw && line.raw && <pre className="rotation-raw">{line.raw}</pre>}
					{line.children && <Steps lines={line.children} showRaw={false} />}
				</li>
			))}
		</ol>
	);
}

/** Everything the simulator is given besides gear: shown in words, with talents and consumables open to change. */
export function SimSetupTab({ spec, character, onChange }: Props) {
	const [loaded, setLoaded] = useState<{ specId: string; setup: SimSetupData; template: SimTemplate } | null>(null);
	const [failed, setFailed] = useState<string | null>(null);
	useEffect(() => {
		let current = true;
		setFailed(null);
		Promise.all([simClient.setup(), simClient.template(spec.id)]).then(
			([setup, template]) => current && setLoaded({ specId: spec.id, setup, template }),
			(err: Error) => current && setFailed(err.message),
		);
		return () => {
			current = false;
		};
	}, [spec.id]);

	const ready = loaded?.specId === spec.id ? loaded : null;
	const player = ready?.template.raid.parties[0].players[0];
	const rotation = useMemo(() => (ready && player ? describeRotation(player.rotation, ready.setup) : null), [ready, player]);
	// The talent string is typed into a field of its own, so a half-typed string never reaches the sim.
	const [typed, setTyped] = useState<string | null>(null);
	const [showRaw, setShowRaw] = useState(false);

	if (failed) {
		return (
			<section className="panel">
				<h2>Sim setup</h2>
				<p className="hint">The simulator files could not be loaded ({failed}). A preview copy of the site comes without them.</p>
			</section>
		);
	}
	if (!ready || !player || !rotation) return <p>Loading the sim settings…</p>;

	const { setup, template } = ready;
	const trees = setup.trees[spec.className.toLowerCase()] ?? [];
	const presetTalents: string = player.talentsString ?? '';
	const usingPreset = !character.talents || character.talents === presetTalents;
	const talents = character.talents || presetTalents;
	const points = parseTalents(talents, trees);
	const spent = talentPointsSpent(points);
	const available = talentPointsAt(character.level ?? MAX_LEVEL);
	const setTalents = (next: string) => onChange({ ...character, talents: next === presetTalents ? '' : next });
	const step = (tree: number, index: number, by: number) => {
		const next = points.map(list => [...list]);
		next[tree][index] = Math.max(0, Math.min(trees[tree].talents[index].max, next[tree][index] + by));
		setTalents(serializeTalents(next));
	};

	const presetConsumables: ConsumablePicks = player.consumables ?? {};
	const picks: ConsumablePicks = { ...presetConsumables, ...character.consumables };
	const setPick = (change: ConsumablePicks) => onChange({ ...character, consumables: { ...character.consumables, ...change } });
	const changedConsumables = Object.keys(character.consumables ?? {}).length > 0;
	const byKind = (kind: string) => setup.consumables.filter(c => c.kind === kind).sort((a, b) => (b.level ?? 0) - (a.level ?? 0) || a.name.localeCompare(b.name));
	const fields = CONSUMABLE_FIELDS.filter(f => {
		if (f.field.startsWith('oh') && !spec.canDualWield && !presetConsumables[f.field]) return false;
		if (f.kind === 'weaponImbue' && !presetConsumables[f.field] && spec.className.toLowerCase() !== 'warlock') return false;
		return true;
	});
	const elixirs = picks.elixirIds ?? [];
	const extras = picks.extraIds ?? [];
	const extraOptions = [...byKind('scroll'), ...byKind('other')];
	const clashes = clashingGroups([...elixirs, ...extras], setup.consumables);
	const withGroup = (c: { name: string; group?: string }) => (c.group ? `${c.name} (${c.group})` : c.name);
	const elixirName = (id: number) => setup.consumables.find(c => c.id === id)?.name ?? setup.items[id] ?? `Item ${id}`;

	const sourceUrl = rotationSourceUrl(spec.id);
	const encounter = template.encounter as { duration?: number; durationVariation?: number; targets?: { level?: number; name?: string }[] } | undefined;
	const party = template.raid.parties[0];
	const presetBuffs: Record<BuffScope, Record<string, unknown>> = {
		raid: (template.raid.buffs ?? {}) as Record<string, unknown>,
		party: (party.buffs ?? {}) as Record<string, unknown>,
		player: (player.buffs ?? {}) as Record<string, unknown>,
		debuffs: (template.raid.debuffs ?? {}) as Record<string, unknown>,
	};
	const buffOf = (scope: BuffScope, key: string) => buffValue({ ...presetBuffs[scope], ...character.buffs?.[scope] }, key);
	const setBuff = (scope: BuffScope, field: BuffField, value: number) =>
		onChange({ ...character, buffs: { ...character.buffs, [scope]: { ...character.buffs?.[scope], [field.key]: field.steps || field.count ? value : value > 0 } } });
	const changedBuffs = Object.values(character.buffs ?? {}).some(scope => Object.keys(scope ?? {}).length > 0);
	// Without the full list (an older data file) only the buffs the build uses can be shown.
	const buffFields = (scope: BuffScope): BuffField[] => setup.buffs?.[scope] ?? Object.keys(presetBuffs[scope]).map(key => ({ key, label: describeFlags({ [key]: true })[0] ?? key }));
	const classOptions = describeOptions((player[spec.simKey] as Record<string, unknown> | undefined)?.options);

	return (
		<div className="sim-setup">
			<section className="panel">
				<h2>What the sim runs</h2>
				<p>
					The "Simulated with WoWSims" numbers come from the WoWSims engine itself, running inside this page. It starts from the WoWSims settings for <strong>{spec.name}</strong> and swaps in your race,
					professions and gear, plus what you change below: talents, consumables, buffs and debuffs. The fight and the rotation are taken as WoWSims ships them.
				</p>
				<p className="hint">
					The quick scores on the Plan and Upgrades tabs use fixed stat weights that were measured with the build's own talents, consumables and buffs. They do not follow changes made here; the simulated numbers
					do.
				</p>
			</section>

			<section className="panel">
				<h2>Talents</h2>
				<p>
					{usingPreset ? 'Using the talents of the WoWSims build.' : 'Using your own talents.'}{' '}
					<span className={spent > available ? 'field-error' : 'num'}>
						{spent} of {available} points spent
					</span>
					{spent > available && ', more than the character has'}.
				</p>
				<div className="talent-bar">
					<label>
						<span className="field-label">Talent string</span>
						<input
							value={typed ?? talents}
							onChange={e => setTyped(e.target.value)}
							onBlur={() => {
								if (typed !== null && /^[0-9-]*$/.test(typed.trim())) setTalents(serializeTalents(parseTalents(typed.trim(), trees)));
								setTyped(null);
							}}
							spellCheck={false}
						/>
					</label>
					<button className="button" disabled={usingPreset} onClick={() => setTalents(presetTalents)}>
						Use the WoWSims build's talents
					</button>
				</div>
				<div className="talent-trees">
					{trees.map((tree, t) => (
						<div key={tree.name} className="talent-tree">
							<h3>
								{tree.name} <span className="num">{points[t].reduce((a, b) => a + b, 0)}</span>
							</h3>
							<ul className="plain-list">
								{tree.talents
									.map((talent, index) => ({ talent, index }))
									.sort((a, b) => a.talent.row - b.talent.row || a.talent.col - b.talent.col)
									.map(({ talent, index }) => (
										<li key={talent.name} className={points[t][index] > 0 ? 'talent talent-taken' : 'talent'}>
											<span className="talent-name">{talent.name}</span>
											<span className="talent-points">
												<button className="button button-small" aria-label={`One point less in ${talent.name}`} disabled={points[t][index] === 0} onClick={() => step(t, index, -1)}>
													−
												</button>
												<span className="num">
													{points[t][index]}/{talent.max}
												</span>
												<button
													className="button button-small"
													aria-label={`One point more in ${talent.name}`}
													disabled={points[t][index] === talent.max}
													onClick={() => step(t, index, 1)}>
													+
												</button>
											</span>
										</li>
									))}
							</ul>
						</div>
					))}
				</div>
				<p className="hint">Talents are listed row by row. Row requirements and prerequisites are not checked here, so a build the game would not allow can be entered.</p>
			</section>

			<section className="panel">
				<h2>Consumables</h2>
				<div className="consumables">
					{fields.map(f => {
						const options = byKind(f.kind).filter(c => !f.resourceOnly || c.resource);
						const value = picks[f.field] ?? 0;
						return (
							<label key={f.field}>
								<span className="field-label">{f.label}</span>
								<select value={value} onChange={e => setPick({ [f.field]: Number(e.target.value) })}>
									<option value={0}>None</option>
									{value !== 0 && !options.some(c => c.id === value) && <option value={value}>{elixirName(value)}</option>}
									{options.map(c => (
										<option key={c.id} value={c.id}>
											{c.name}
										</option>
									))}
								</select>
							</label>
						);
					})}
				</div>
				<div className="elixirs">
					<span className="field-label">Elixirs</span>
					<ul className="plain-list elixir-list">
						{elixirs.map(id => (
							<li key={id}>
								<label className="check">
									<input type="checkbox" checked onChange={() => setPick({ elixirIds: elixirs.filter(e => e !== id) })} /> {elixirName(id)}
								</label>
							</li>
						))}
						{elixirs.length === 0 && <li className="hint">None</li>}
					</ul>
					<label>
						<span className="field-label">Add an elixir</span>
						<select value={0} onChange={e => Number(e.target.value) && setPick({ elixirIds: [...elixirs, Number(e.target.value)] })}>
							<option value={0}>Choose…</option>
							{byKind('elixir')
								.filter(c => !elixirs.includes(c.id))
								.map(c => (
									<option key={c.id} value={c.id}>
										{withGroup(c)}
									</option>
								))}
						</select>
					</label>
				</div>
				<div className="elixirs">
					<span className="field-label">Scrolls and other consumables</span>
					<ul className="plain-list elixir-list">
						{extras.map(id => (
							<li key={id}>
								<label className="check">
									<input type="checkbox" checked onChange={() => setPick({ extraIds: extras.filter(e => e !== id) })} /> {elixirName(id)}
								</label>
							</li>
						))}
						{extras.length === 0 && <li className="hint">None</li>}
					</ul>
					<label>
						<span className="field-label">Add a scroll or other consumable</span>
						<select value={0} onChange={e => Number(e.target.value) && setPick({ extraIds: [...extras, Number(e.target.value)] })}>
							<option value={0}>Choose…</option>
							{extraOptions
								.filter(c => !extras.includes(c.id))
								.map(c => (
									<option key={c.id} value={c.id}>
										{withGroup(c)}
									</option>
								))}
						</select>
					</label>
				</div>
				{clashes.map(clash => (
					<p key={clash.group} className="field-error" role="status">
						{clash.names.join(' and ')} both buff {clash.group}: they overwrite each other, so only one of them counts.
					</p>
				))}
				<p>
					<button
						className="button"
						disabled={!changedConsumables}
						onClick={() => {
							const { consumables: _dropped, ...rest } = character;
							onChange(rest);
						}}>
						Use the WoWSims build's consumables
					</button>
				</p>
				<p className="hint">
					Every consumable WoWSims knows can be picked. Flask, food and the other single choices replace each other by design. Elixirs and scrolls that buff the same thing overwrite each other; the
					page warns about those. The sim applies its own stacking rules on top, for example a scroll against the raid buff of the same stat. Simulate before and after to see what a consumable is
					worth.
				</p>
			</section>

			<section className="panel">
				<h2>Buffs and fight</h2>
				<p>
					{encounter?.duration ? `A ${encounter.duration} second fight` : 'A fight'}
					{encounter?.durationVariation ? ` (give or take ${encounter.durationVariation})` : ''} against {encounter?.targets?.length ?? 1} target
					{(encounter?.targets?.length ?? 1) === 1 ? '' : 's'}
					{encounter?.targets?.[0]?.level ? ` of level ${encounter.targets[0].level}` : ''}.
				</p>
				{BUFF_SCOPES.map(({ scope, title }) => (
					<fieldset key={scope} className="buff-set">
						<legend>{title}</legend>
						<div className="buff-grid">
							{buffFields(scope).map(field => {
								const value = buffOf(scope, field.key);
								if (field.steps) {
									return (
										<label key={field.key} className={value ? 'buff buff-on' : 'buff'}>
											<span>{field.label}</span>
											<select value={Math.min(value, field.steps.length)} onChange={e => setBuff(scope, field, Number(e.target.value))}>
												<option value={0}>Off</option>
												{field.steps.map((step, index) => (
													<option key={step} value={index + 1}>
														{step}
													</option>
												))}
											</select>
										</label>
									);
								}
								if (field.count) {
									return (
										<label key={field.key} className={value ? 'buff buff-on' : 'buff'}>
											<span>{field.label}</span>
											<input type="number" min={0} max={20} value={value} onChange={e => setBuff(scope, field, Math.max(0, Math.round(Number(e.target.value) || 0)))} />
										</label>
									);
								}
								return (
									<label key={field.key} className={value ? 'buff buff-on check' : 'buff check'}>
										<input type="checkbox" checked={value > 0} onChange={e => setBuff(scope, field, e.target.checked ? 1 : 0)} /> {field.label}
									</label>
								);
							})}
						</div>
					</fieldset>
				))}
				<p>
					<button
						className="button"
						disabled={!changedBuffs}
						onClick={() => {
							const { buffs: _dropped, ...rest } = character;
							onChange(rest);
						}}>
						Use the WoWSims build's buffs and debuffs
					</button>
				</p>
				{classOptions.length > 0 && (
					<dl className="buff-groups">
						<div>
							<dt>Class options of the build</dt>
							<dd>{classOptions.join(', ')}</dd>
						</div>
					</dl>
				)}
				<p className="hint">Every buff and debuff WoWSims knows is listed, and each can be switched on its own. The fight and the class options come from the build and cannot be changed here yet.</p>
			</section>

			<section className="panel">
				<h2>Rotation</h2>
				<p>
					The priority list is read from the top each time the character can act: the first step whose condition holds is used. Steps that are switched off in WoWSims are left out.
				</p>
				<p>
					Where it comes from: this is the rotation of the WoWSims project for this build, taken over unchanged
					{sourceUrl && (
						<>
							{' '}
							(<a href={sourceUrl}>the file on GitHub</a>)
						</>
					)}
					. The sim runs that file; the sentences here are only a translation of it into words, written by this site. Hover over a step to see the original rule, or show them all:
				</p>
				<p>
					<label className="check">
						<input type="checkbox" checked={showRaw} onChange={e => setShowRaw(e.target.checked)} /> Show the original WoWSims rule under each step
					</label>
				</p>
				{rotation.prepull.length > 0 && (
					<>
						<h3>Before the pull</h3>
						<Steps lines={rotation.prepull} showRaw={showRaw} />
					</>
				)}
				<h3>Priority list</h3>
				<Steps lines={rotation.priority} showRaw={showRaw} />
				{rotation.groups.map(group => (
					<div key={group.name}>
						<h3>Group "{group.name}"</h3>
						<Steps lines={group.lines} showRaw={showRaw} />
					</div>
				))}
				{rotation.variables.length > 0 && (
					<>
						<h3>Named values</h3>
						<dl className="rotation-variables">
							{rotation.variables.map(variable => (
								<div key={variable.name}>
									<dt>"{variable.name}"</dt>
									<dd>{variable.value}</dd>
								</div>
							))}
						</dl>
					</>
				)}
			</section>
		</div>
	);
}
