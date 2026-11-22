import { useEffect, useMemo, useState } from 'react';

import { simClient } from '../lib/sim/client';
import type { SimTemplate } from '../lib/sim/request';
import {
	CONSUMABLE_FIELDS,
	type ConsumablePicks,
	describeFlags,
	describeRotation,
	parseTalents,
	type RotationLine,
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

function Steps({ lines }: { lines: RotationLine[] }) {
	return (
		<ol className="rotation-steps">
			{lines.map((line, index) => (
				<li key={index}>
					<span className="rotation-do">{line.text}</span>
					{line.when && <span className="rotation-when"> when {line.when}</span>}
					{line.children && <Steps lines={line.children} />}
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
	const elixirName = (id: number) => setup.consumables.find(c => c.id === id)?.name ?? setup.items[id] ?? `Item ${id}`;

	const encounter = template.encounter as { duration?: number; durationVariation?: number; targets?: { level?: number; name?: string }[] } | undefined;
	const party = template.raid.parties[0];
	const buffGroups = [
		{ title: 'Raid buffs', list: describeFlags(template.raid.buffs as Record<string, unknown>) },
		{ title: 'Party buffs', list: describeFlags(party.buffs as Record<string, unknown>) },
		{ title: 'Buffs on you', list: describeFlags(player.buffs) },
		{ title: 'Debuffs on the target', list: describeFlags(template.raid.debuffs as Record<string, unknown>) },
	].filter(group => group.list.length > 0);

	return (
		<div className="sim-setup">
			<section className="panel">
				<h2>What the sim runs</h2>
				<p>
					The "Simulated with WoWSims" numbers come from the WoWSims engine itself, running inside this page. It starts from the WoWSims settings for <strong>{spec.name}</strong> and swaps in your race,
					professions and gear, plus the talents and consumables below. Buffs, the fight and the rotation are taken as WoWSims ships them.
				</p>
				<p className="hint">
					The quick scores on the Plan and Upgrades tabs use fixed stat weights that were measured with the build's own talents and consumables. They do not follow changes made here; the simulated numbers
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
										{c.name}
									</option>
								))}
						</select>
					</label>
				</div>
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
					This page does not block combinations. Where two consumables would not stack, the sim settles it by its own rules, so adding a second one of the same kind may change nothing. Simulate
					before and after to see what a consumable is worth.
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
				<dl className="buff-groups">
					{buffGroups.map(group => (
						<div key={group.title}>
							<dt>{group.title}</dt>
							<dd>{group.list.join(', ')}</dd>
						</div>
					))}
				</dl>
				<p className="hint">These come from the WoWSims build and cannot be changed here yet.</p>
			</section>

			<section className="panel">
				<h2>Rotation</h2>
				<p>
					The priority list is read from the top each time the character can act: the first step whose condition holds is used. It is the rotation WoWSims ships for this build, in words; steps that are
					switched off there are left out.
				</p>
				{rotation.prepull.length > 0 && (
					<>
						<h3>Before the pull</h3>
						<Steps lines={rotation.prepull} />
					</>
				)}
				<h3>Priority list</h3>
				<Steps lines={rotation.priority} />
				{rotation.groups.map(group => (
					<div key={group.name}>
						<h3>Group "{group.name}"</h3>
						<Steps lines={group.lines} />
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
