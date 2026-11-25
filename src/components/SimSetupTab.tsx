import { useEffect, useMemo, useState } from 'react';

import { simClient } from '../lib/sim/client';
import type { GameData } from '../lib/gameData';
import { plannedGear } from '../lib/scoring';
import { type RotationChecks, type SimTemplate, withSimSettings, wowsimsSettings, bookChoices } from '../lib/sim/request';
import { countsMending, MENDING_STEP } from '../lib/sim/mending';
import {
	BUFF_SCOPES,
	type BuffField,
	type BuffScope,
	buffValue,
	clashingGroups,
	CONSUMABLE_FIELDS,
	type ConsumablePicks,
	describeCheck,
	describeFlags,
	describeOptions,
	describeRotation,
	parseTalents,
	type RotationLine,
	rotationSourceUrl,
	serializeTalents,
	splitMarks,
	talentBlocked,
	talentLocked,
	type TalentTree,
	type SimSetupData,
	talentPointsAt,
	talentPointsSpent,
} from '../lib/sim/setup';
import { healingChoice, healingFight } from '../lib/sim/healing';
import { wowheadItemUrl, wowheadSpellUrl, wowheadData } from '../lib/stats';
import { specsOfClass } from '../lib/specs';
import talentPresets from '../config/talentPresets.json';
import type { Character, SpecConfig } from '../lib/types';
import { ICON_SOURCES } from './ItemIcon';

interface Props {
	spec: SpecConfig;
	character: Character;
	/** The item data, for the planned gear in the settings export. */
	data?: GameData | null;
	onChange: (next: Character) => void;
}

const MAX_LEVEL = 60;

function Steps({ lines, showRaw, checks, names }: { lines: RotationLine[]; showRaw: boolean; checks?: string[][]; names?: SimSetupData }) {
	return (
		<ol className="rotation-steps">
			{lines.map((line, index) => {
				const remarks = (line.index !== undefined ? checks?.[line.index] : undefined) ?? [];
				// A step never fires when the spell it casts is one the character lacks. A missing spell that is
				// only asked about in the step's condition leaves the step working: that part just never applies.
				const own = ownSpell(line.raw);
				const lacksOwn = (remark: string) => own !== undefined && new RegExp(`does not know spell \\{(SpellID|ItemID): ${own}[,}]`).test(remark);
				const unusable = remarks.some(lacksOwn);
				return (
					<li key={index} className={unusable ? 'rotation-unused' : undefined} title={line.raw ? `The WoWSims rule behind this step:\n${line.raw}` : undefined}>
						<span className="rotation-do">
							<Rich text={line.text} names={names} />
						</span>
						{line.when && (
							<span className="rotation-when">
								{' '}
								when <Rich text={line.when} names={names} />
							</span>
						)}
						{line.estimate && (
							<span className="rotation-remark">
								<span className="tag-estimate">estimate</span> The simulator cannot cast this spell yet. Its healing is worked out by hand and added to the result, and the other steps give up the casts it takes. Switch it off
								with "Count Prayer of Mending" under "Build plan".
							</span>
						)}
						{remarks.map(remark => (
							<span key={remark} className="rotation-remark">
								{lacksOwn(remark) ? 'Skipped for you: ' : 'Note: '}
								{names ? describeCheck(remark, names) : remark}
								{!lacksOwn(remark) && /does not know/.test(remark) && '. The step still runs; only the part of its condition that asks about this never applies.'}
							</span>
						))}
						{showRaw && line.raw && <pre className="rotation-raw">{line.raw}</pre>}
						{line.children && <Steps lines={line.children} showRaw={false} names={names} />}
					</li>
				);
			})}
		</ol>
	);
}

/** The spell a rotation step itself casts or channels, from the step as WoWSims wrote it. */
function ownSpell(raw: string | undefined): number | undefined {
	if (!raw) return undefined;
	try {
		const action = JSON.parse(raw) as Record<string, { spellId?: { spellId?: number; itemId?: number } } | undefined>;
		for (const kind of ['castSpell', 'castFriendlySpell', 'channelSpell', 'multidot', 'strictMultidot', 'multishield']) {
			// An on-use item is cast by its item id.
			const id = action[kind]?.spellId?.spellId ?? action[kind]?.spellId?.itemId;
			if (id) return id;
		}
	} catch {
		// Not a single action (a group or a sequence): nothing of its own to cast.
	}
	return undefined;
}

/** Everything the simulator is given besides gear: shown in words, with talents and consumables open to change. */
export function SimSetupTab({ spec, character, data, onChange }: Props) {
	const books = bookChoices(character);
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

	// Where the character came from a WoWSims export, its settings stand in for the build's own.
	const imported = character.simSettings?.specId === spec.id;
	const ready = useMemo(() => (loaded?.specId === spec.id ? { ...loaded, template: withSimSettings(loaded.template, character) } : null), [loaded, spec.id, character.simSettings, character.specId]);
	const player = ready?.template.raid.parties[0].players[0];
	// A healer's rotation is the planner's own scenario, not a file of the WoWSims project.
	const healer = spec.role === 'healer';
	const rotation = useMemo(() => {
		if (!ready || !player) return null;
		const text = describeRotation(healer ? healingFight(healingChoice(character)).rotation : player.rotation, ready.setup, true);
		if (!healer || !countsMending(character, spec.talents)) return text;
		// Prayer of Mending is counted as an estimate: it gets its place in the list, ahead of the first heal.
		const firstHeal = text.priority.findIndex(line => /castFriendlySpell/.test(line.raw ?? ''));
		const at = firstHeal < 0 ? text.priority.length : firstHeal;
		return { ...text, priority: [...text.priority.slice(0, at), MENDING_STEP, ...text.priority.slice(at)] };
	}, [ready, player, healer, character]);
	// The talent string is typed into a field of its own, so a half-typed string never reaches the sim.
	const [typed, setTyped] = useState<string | null>(null);
	const [showRaw, setShowRaw] = useState(false);
	// The buff under the pointer, in words.
	const [pointed, setPointed] = useState<string | null>(null);
	const [copied, setCopied] = useState<string | null>(null);
	// What the simulator says about each rotation step for this character.
	const [checks, setChecks] = useState<RotationChecks | null>(null);
	useEffect(() => {
		let current = true;
		setChecks(null);
		if (import.meta.env.VITE_NO_SIM) return;
		simClient.rotationChecks(character).then(
			result => current && setChecks(result),
			() => undefined,
		);
		return () => {
			current = false;
		};
	}, [character]);

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
	// Ready-made talent sets: the WoWSims builds of this class, then extra ones with a named source (src/config/talentPresets.json).
	const talentChoices = (() => {
		const fromBuilds = specsOfClass(spec.className).map(build => ({ key: `build:${build.id}`, label: `WoWSims: ${build.preset ?? build.name}`, talents: build.talents ?? '', source: undefined as string | undefined, url: undefined as string | undefined }));
		const extra = ((talentPresets.byClass as Record<string, { name: string; talents: string; source: string; url?: string }[] | undefined>)[spec.className] ?? []).map((preset, i) => ({ key: `extra:${i}`, label: `${preset.source}: ${preset.name}`, talents: preset.talents, source: preset.source, url: preset.url }));
		return [...fromBuilds, ...extra].filter((choice, i, all) => choice.talents && all.findIndex(other => other.talents === choice.talents) === i);
	})();
	const shownChoice = talentChoices.find(choice => choice.talents === talents);
	// How far the talents are from the build's own: points that sit somewhere else.
	const own = parseTalents(presetTalents, trees);
	const moved = Math.round(points.reduce((sum, list, t) => sum + list.reduce((inner, value, i) => inner + Math.abs(value - (own[t]?.[i] ?? 0)), 0), 0) / 2);
	// No talents at all is written as "0": an empty string means "the build's own talents".
	const setTalents = (next: string) => onChange({ ...character, talents: next === presetTalents ? '' : next || '0' });
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

	// The settings as wowsims.com takes them, for a side-by-side run there.
	const hasPlan = Object.keys(character.plan ?? {}).length > 0;
	const exportOf = (planned: boolean) => JSON.stringify(wowsimsSettings(character, planned ? plannedGear(character, data ?? undefined) : character.gear, template));
	const copy = (planned: boolean) => {
		const text = exportOf(planned);
		const label = planned ? 'planned' : 'equipped';
		navigator.clipboard.writeText(text).then(
			() => setCopied(label),
			() => setCopied('failed'),
		);
	};
	const target = encounter?.targets?.[0] as { level?: number; stats?: number[] } | undefined;
	const ARMOR_STAT = 27;
	const commit = setup.simVersion?.commit;

	return (
		<div className="sim-setup">
			<section className="panel">
				<h2>What the sim runs</h2>
				<p>
					The "Simulated with WoWSims" numbers come from the WoWSims engine itself, running inside this page. It starts from the WoWSims settings for <strong>{spec.name}</strong> and swaps in your race,
					professions and gear, plus what you change below: talents, consumables, buffs and debuffs. The fight and the rotation are taken as WoWSims ships them.
				</p>
				{imported && (
					<p className="notice">
						<strong>Settings from your WoWSims export.</strong> This character was imported from a WoWSims export, so its consumables, buffs, debuffs, rotation and fight are the export's, not the build's own. The
						same export gives the same number on wowsims.com.{' '}
						<button className="link" onClick={() => onChange({ ...character, simSettings: undefined, consumables: undefined, buffs: undefined })}>
							Use the build's own settings instead
						</button>
					</p>
				)}
				<p className="hint">
					The quick scores under "Build plan" and "Customize" use fixed stat weights that were measured with the build's own talents, consumables and buffs. They do not follow changes made here; the simulated numbers
					do.
				</p>
			</section>

			<details className="fold compare-fold">
				<summary>
					Compare with another sim
					<span className="slot-source">Every setting of a run, to rebuild it on wowsims.com</span>
				</summary>
				<p>Everything a run depends on, so the same run can be set up elsewhere. If two sims disagree, one of these lines differs.</p>
				<dl className="compare-facts">
					<div>
						<dt>Simulator</dt>
						<dd>
							WoWSims Forever
							{commit && (
								<>
									, build <a href={`https://github.com/wowsims/forever/commit/${commit}`}>{commit.slice(0, 7)}</a>
								</>
							)}
							{setup.simVersion?.fetched && `, copied on ${setup.simVersion.fetched}`}. wowsims.com itself may run a newer build.
						</dd>
					</div>
					<div>
						<dt>Runs</dt>
						<dd>
							3,000 iterations for a whole set, 2,000 for a single item or enchant. The random seed is fixed, so the same settings give the same number here every time; another site rolls its own
							dice and lands within about 1 DPS of it.
						</dd>
					</div>
					<div>
						<dt>Fight</dt>
						<dd>
							{encounter?.duration ?? '?'} seconds, give or take {encounter?.durationVariation ?? 0}; {encounter?.targets?.length ?? 1} target
							{target?.level ? `, level ${target.level}` : ''}
							{target?.stats?.[ARMOR_STAT] ? `, ${target.stats[ARMOR_STAT].toLocaleString('en')} armor` : ''}.
						</dd>
					</div>
					<div>
						<dt>Character</dt>
						<dd>
							{spec.races.find(r => r.id === (character.race ?? player.race))?.name ?? String(character.race ?? player.race)}, professions {character.professions.join(' and ') || 'none'}, talents{' '}
							<span className="num">{talents}</span>
							{player.distanceFromTarget !== undefined && `, ${player.distanceFromTarget} yards from the target`}
							{player.reactionTimeMs !== undefined && `, ${player.reactionTimeMs} ms reaction time`}.
						</dd>
					</div>
					<div>
						<dt>Gear</dt>
						<dd>Your items with the enchants and random suffixes set under "Check gear". No item or enchant is added behind your back.</dd>
					</div>
					<div>
						<dt>Everything else</dt>
						<dd>Consumables, buffs, debuffs and the rotation exactly as listed further down this page.</dd>
					</div>
				</dl>
				<h3>Run the same thing on wowsims.com</h3>
				<p>
					Copy the settings, open the WoWSims page for your class, choose Import, then JSON, paste and simulate. That loads the gear, talents, consumables, buffs, debuffs, rotation and fight this page
					uses. If the result there still differs by more than a few DPS, the two simulator builds differ, not the settings.
				</p>
				<p className="compare-actions">
					<button className="button" onClick={() => copy(false)}>
						Copy settings with equipped gear
					</button>{' '}
					<button className="button" disabled={!hasPlan} onClick={() => copy(true)}>
						Copy settings with planned gear
					</button>{' '}
					{copied && copied !== 'failed' && (
						<span className="hint" role="status">
							Copied ({copied} gear).
						</span>
					)}
					{copied === 'failed' && (
						<span className="field-error" role="alert">
							Copying was blocked by the browser. Open "Show the settings" and copy the text by hand.
						</span>
					)}
				</p>
				<details>
					<summary>Show the settings</summary>
					<textarea className="compare-json" readOnly rows={6} value={exportOf(false)} onFocus={e => e.target.select()} aria-label="Settings with equipped gear, as JSON" />
				</details>
			</details>

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
						<span className="field-label">Talent presets</span>
						<select
							value={talentChoices.find(choice => choice.talents === talents)?.key ?? ''}
							onChange={e => {
								const choice = talentChoices.find(c => c.key === e.target.value);
								if (choice) setTalents(choice.talents);
							}}>
							<option value="">{talentChoices.some(choice => choice.talents === talents) ? '' : 'Your own talents'}</option>
							{talentChoices.map(choice => (
								<option key={choice.key} value={choice.key}>
									{choice.label}
								</option>
							))}
						</select>
					</label>
					<label>
						<span className="field-label">Talent string or talent calculator link</span>
						<input
							value={typed ?? talents}
							onChange={e => setTyped(e.target.value)}
							onBlur={() => {
								// A pasted talent calculator link ends in the same string: digits per talent, trees joined by "-".
								const pasted = typed?.trim().split(/[?#]/)[0].replace(/\/+$/, '').split('/').pop() ?? '';
								if (typed !== null && /^[0-9-]*$/.test(pasted)) setTalents(serializeTalents(parseTalents(pasted, trees)));
								setTyped(null);
							}}
							spellCheck={false}
						/>
					</label>
					<button className="button" disabled={usingPreset} onClick={() => setTalents(presetTalents)}>
						Use the WoWSims build's talents
					</button>
				</div>
				{moved >= 8 && (
					<p className="notice" role="status">
						These talents differ from the build "{spec.preset ?? spec.name}" by {moved} points. "Simulate" still uses them, but the simulator plays that build's rotation, and the quick numbers in the lists were measured with that build's talents. For a very different build, pick the matching build under Character details if there is one.
					</p>
				)}
				{shownChoice?.source && (
					<p className="hint">
						Preset from {shownChoice.url ? <a href={shownChoice.url} target="_blank" rel="noreferrer">{shownChoice.source}</a> : shownChoice.source}.
					</p>
				)}
				<div className="talent-trees">
					{trees.map((tree, t) => (
						<TalentTreeView
							key={tree.name}
							tree={tree}
							points={points[t]}
							pointsLeft={available - spent}
							onStep={(index, by) => step(t, index, by)}
							onReset={() => setTalents(serializeTalents(points.map((list, i) => (i === t ? list.map(() => 0) : list))))}
						/>
					))}
				</div>
				<p className="hint">
					Click a talent to put a point in, right-click (or Shift-click, or the small minus on a phone) to take one out. Rows open after 5 points per row above them and arrows need the talent they
					come from at its maximum, as in the game. A build pasted as a talent string is taken as it is.
				</p>
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
								{value !== 0 && <Named kind="item" id={value} name={elixirName(value)} names={setup} />}
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
									<input type="checkbox" checked aria-label={`Remove ${elixirName(id)}`} onChange={() => setPick({ elixirIds: elixirs.filter(e => e !== id) })} />
								</label>
								<Named kind="item" id={id} name={elixirName(id)} names={setup} />
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
									<input type="checkbox" checked aria-label={`Remove ${elixirName(id)}`} onChange={() => setPick({ extraIds: extras.filter(e => e !== id) })} />
								</label>
								<Named kind="item" id={id} name={elixirName(id)} names={setup} />
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
					{healer ? (
						`A ${healingFight(healingChoice(character)).duration} second fight (give or take 5). The heals go to the Priest's group of five; there is no incoming damage, so every heal counts in full.`
					) : (
						<>
							{encounter?.duration ? `A ${encounter.duration} second fight` : 'A fight'}
							{encounter?.durationVariation ? ` (give or take ${encounter.durationVariation})` : ''} against {encounter?.targets?.length ?? 1} target
							{(encounter?.targets?.length ?? 1) === 1 ? '' : 's'}
							{encounter?.targets?.[0]?.level ? ` of level ${encounter.targets[0].level}` : ''}.
						</>
					)}
				</p>
				{BUFF_SCOPES.map(({ scope, title }) => (
					<fieldset key={scope} className="buff-set">
						<legend>{title}</legend>
						<div className="buff-icons">
							{buffFields(scope).map(field => (
								<BuffIcon key={field.key} field={field} value={buffOf(scope, field.key)} onChange={value => setBuff(scope, field, value)} onPoint={() => setPointed(describeBuff(field, buffOf(scope, field.key)))} />
							))}
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
				<p className="buff-pointed" aria-live="polite">
					{pointed ?? 'Point at an icon to see what it is. Click switches it on or to the next level, right-click back.'}
				</p>
				<p className="hint">Every buff and debuff WoWSims knows is listed, and each can be switched on its own. The fight and the class options come from the build and cannot be changed here yet.</p>
			</section>

			{books.length > 0 && (
				<section className="panel">
					<h2>Spell ranks from books</h2>
					<p>
						The highest rank of some spells is not taught by a trainer but by a book that drops. Tick the ones you have learned: the simulation then casts that rank, otherwise the highest rank a trainer
						teaches.
					</p>
					{imported && <p className="hint">This character uses the rotation of its WoWSims import, ranks included, so these ticks change nothing for it.</p>}
					<div className="book-ranks">
						{books.map(choice => (
							<label key={choice.id} className="check">
								<input
									type="checkbox"
									checked={choice.learned}
									disabled={imported}
									onChange={event => onChange({ ...character, bookRanks: { ...character.bookRanks, [choice.id]: event.target.checked } })}
								/>
								<span>
									<strong>
										{choice.book.spell}, rank {choice.book.rank}
									</strong>{' '}
									<span className="slot-source">
										from {choice.book.item}
										{choice.shipped ? '' : `; without it the simulation casts rank ${choice.book.rank - 1}`}
									</span>
								</span>
							</label>
						))}
					</div>
				</section>
			)}

			<section className="panel">
				<h2>Rotation</h2>
				<p>
					The priority list is read from the top each time the character can act: the first step whose condition holds is used. Steps that are switched off in WoWSims are left out. The list is
					the build's, so it can name spells your character does not have; those steps are greyed out and marked "Skipped for you", and the simulator passes over them.
				</p>
				<p>
					{healer ? (
						<>
							Where it comes from: WoWSims has the Priest's heals in its engine but ships no healing rotation, so this one is written by this site for the healing scenario picked under "Build plan". It is short on purpose. Prayer
							of Mending cannot be cast in the engine yet (it stops with an error), so with the talent it is listed as an estimate: its healing is worked out by hand and added (see "What kind of healing?" under "Build plan"). Hover over a step to see the rule the simulator gets, or show them all:
						</>
					) : (
						<>
							Where it comes from: this is the rotation of the WoWSims project for this build, taken over unchanged
						{sourceUrl && (
							<>
								{' '}
								(<a href={sourceUrl}>the file on GitHub</a>)
							</>
						)}
						. The sim runs that file; the sentences here are only a translation of it into words, written by this site. Hover over a step to see the original rule, or show them all:
						</>
					)}
				</p>
				<p>
					<label className="check">
						<input type="checkbox" checked={showRaw} onChange={e => setShowRaw(e.target.checked)} /> Show the original WoWSims rule under each step
					</label>
				</p>
				{rotation.prepull.length > 0 && (
					<>
						<h3>Before the pull</h3>
						<Steps lines={rotation.prepull} showRaw={showRaw} checks={checks?.prepull} names={setup} />
					</>
				)}
				<h3>Priority list</h3>
				<Steps lines={rotation.priority} showRaw={showRaw} checks={checks?.priority} names={setup} />
				{rotation.groups.map((group, groupIndex) => (
					<div key={group.name}>
						<h3>Group "{group.name}"</h3>
						<Steps lines={group.lines} showRaw={showRaw} checks={checks?.groups[groupIndex]} names={setup} />
					</div>
				))}
				{rotation.variables.length > 0 && (
					<>
						<h3>Named values</h3>
						<dl className="rotation-variables">
							{rotation.variables.map(variable => (
								<div key={variable.name}>
									<dt>"{variable.name}"</dt>
									<dd>
										<Rich text={variable.value} names={setup} />
									</dd>
								</div>
							))}
						</dl>
					</>
				)}
			</section>
		</div>
	);
}

const CELL = 3.25;
const GAP = 0.75;
/** The middle of a grid cell, in rem. */
const middle = (index: number) => index * (CELL + GAP) + CELL / 2;

function TalentIcon({ icon }: { icon?: string }) {
	const [attempt, setAttempt] = useState(0);
	if (!icon || attempt >= ICON_SOURCES.length) return <span className="talent-icon-empty" aria-hidden="true" />;
	return <img src={ICON_SOURCES[attempt](icon)} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} />;
}

/** One talent tree laid out as in the game: click to add a point, right-click to take one out. */
function TalentTreeView({ tree, points, pointsLeft, onStep, onReset }: { tree: TalentTree; points: number[]; pointsLeft: number; onStep: (index: number, by: number) => void; onReset: () => void }) {
	const [focus, setFocus] = useState<number | null>(null);
	const rows = Math.max(...tree.talents.map(t => t.row)) + 1;
	const total = points.reduce((a, b) => a + b, 0);
	const shown = focus !== null ? tree.talents[focus] : undefined;
	const blockedNow = focus !== null ? talentBlocked(tree, points, focus, pointsLeft) : undefined;
	return (
		<div className="talent-tree">
			<h3>
				<span>
					{tree.name} <span className="num">{total}</span>
				</span>
				<button className="link" disabled={total === 0} onClick={onReset}>
					Reset
				</button>
			</h3>
			<div className="talent-grid" style={{ height: `${rows * CELL + (rows - 1) * GAP}rem` }}>
				<svg className="talent-arrows" viewBox={`0 0 ${4 * CELL + 3 * GAP} ${rows * CELL + (rows - 1) * GAP}`} aria-hidden="true">
					{tree.talents.map((talent, index) => {
						if (!talent.requires) return null;
						const from = tree.talents.findIndex(t => t.row === talent.requires!.row && t.col === talent.requires!.col);
						const met = from >= 0 && points[from] >= tree.talents[from].max;
						const sameRow = talent.requires.row === talent.row;
						const direction = Math.sign(talent.col - talent.requires.col);
						// From the edge of the required talent to the edge of this one.
						const x1 = sameRow ? middle(talent.requires.col) + (direction * CELL) / 2 : middle(talent.requires.col);
						const y1 = sameRow ? middle(talent.row) : middle(talent.requires.row) + CELL / 2;
						const x2 = sameRow ? middle(talent.col) - (direction * CELL) / 2 : middle(talent.col);
						const y2 = sameRow ? middle(talent.row) : middle(talent.row) - CELL / 2;
						// An arrow that changes column goes down first, then across, then down.
						const path = sameRow || x1 === x2 ? `M${x1} ${y1} L${x2} ${y2}` : `M${x1} ${y1} L${x1} ${y2 - GAP / 2} L${x2} ${y2 - GAP / 2} L${x2} ${y2}`;
						return <path key={index} d={path} className={met ? 'talent-arrow talent-arrow-met' : 'talent-arrow'} />;
					})}
				</svg>
				{tree.talents.map((talent, index) => {
					const blocked = talentBlocked(tree, points, index, pointsLeft);
					const locked = talentLocked(tree, points, index);
					const value = points[index];
					const state = value >= talent.max ? 'talent-full' : value > 0 ? 'talent-some' : blocked ? 'talent-closed' : 'talent-open';
					return (
						<div key={talent.name} className="talent-cell" style={{ left: `${talent.col * (CELL + GAP)}rem`, top: `${talent.row * (CELL + GAP)}rem` }}>
							<a
								role="button"
								href={talent.spellId ? wowheadSpellUrl(talent.spellId) : '#'}
								data-wowhead={talent.spellId ? wowheadData('spell', talent.spellId) : undefined}
								className={`talent-button ${state}`}
								aria-label={`${talent.name}, ${value} of ${talent.max} points${blocked && value < talent.max ? `. ${blocked}` : ''}`}
								aria-disabled={Boolean(blocked)}
								onClick={event => {
									// The link is only there for the Wowhead tooltip; a click spends a point.
									event.preventDefault();
									if (event.shiftKey) {
										if (!locked) onStep(index, -1);
									} else if (!blocked) onStep(index, 1);
								}}
								onContextMenu={event => {
									event.preventDefault();
									if (!locked) onStep(index, -1);
								}}
								onKeyDown={event => {
									if ((event.key === 'Backspace' || event.key === 'Delete' || event.key === '-') && !locked) onStep(index, -1);
								}}
								onMouseEnter={() => setFocus(index)}
								onFocus={() => setFocus(index)}>
								<TalentIcon icon={talent.icon} />
								<span className="talent-rank num">
									{value}/{talent.max}
								</span>
							</a>
							{value > 0 && !locked && (
								<button className="talent-minus" aria-label={`One point less in ${talent.name}`} onClick={() => onStep(index, -1)}>
									−
								</button>
							)}
						</div>
					);
				})}
			</div>
			<p className="talent-info">
				{shown ? (
					<>
						{shown.spellId ? (
							<a href={wowheadSpellUrl(shown.spellId)} data-wowhead={wowheadData('spell', shown.spellId)} target="_blank" rel="noreferrer">
								{shown.name}
							</a>
						) : (
							shown.name
						)}{' '}
						<span className="num">
							{points[focus!]}/{shown.max}
						</span>
						{blockedNow && points[focus!] < shown.max && <span className="talent-why"> {blockedNow}</span>}
					</>
				) : (
					'Point at a talent to see its name.'
				)}
			</p>
		</div>
	);
}

/** "Arcane Intellect: on", "Battle Shout: Rank 7", "Windfury Totem: off". */
function describeBuff(field: BuffField, value: number): string {
	const state = value <= 0 ? 'off' : field.steps ? (field.steps[Math.min(value, field.steps.length) - 1] ?? 'on') : field.count ? `${value}` : 'on';
	return `${field.label}: ${state}`;
}

/** One buff as its icon: lit when on, with the level as a small number. Click steps up, right-click down. */
function BuffIcon({ field, value, onChange, onPoint }: { field: BuffField; value: number; onChange: (value: number) => void; onPoint: () => void }) {
	const [attempt, setAttempt] = useState(0);
	const most = field.steps ? field.steps.length : field.count ? 20 : 1;
	const up = () => onChange(field.count ? Math.min(most, value + 1) : value >= most ? 0 : value + 1);
	const down = () => onChange(Math.max(0, value - 1));
	const href = field.spellId ? wowheadSpellUrl(field.spellId) : field.itemId ? wowheadItemUrl(field.itemId) : undefined;
	const body = (
		<>
			{field.icon && attempt < ICON_SOURCES.length ? <img src={ICON_SOURCES[attempt](field.icon)} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} /> : <span className="buff-letters">{field.label.replace(/[^A-Z]/g, '').slice(0, 3) || field.label.slice(0, 2)}</span>}
			{value > 0 && most > 1 && <span className="buff-level num">{field.steps ? value : `×${value}`}</span>}
		</>
	);
	const shared = {
		className: value > 0 ? 'buff-icon buff-icon-on' : 'buff-icon',
		'aria-label': describeBuff(field, value),
		'aria-pressed': value > 0,
		onMouseEnter: onPoint,
		onFocus: onPoint,
		onContextMenu: (event: { preventDefault: () => void }) => {
			event.preventDefault();
			down();
		},
	};
	// With a spell or item behind it, the icon is a link so Wowhead's tooltip shows on hover.
	return href ? (
		<a
			{...shared}
			role="button"
			href={href}
			data-wowhead={field.spellId ? wowheadData('spell', field.spellId) : field.itemId ? wowheadData('item', field.itemId) : undefined}
			onClick={event => {
				event.preventDefault();
				if (event.shiftKey) down();
				else up();
			}}>
			{body}
		</a>
	) : (
		<button {...shared} title={field.label} onClick={event => (event.shiftKey ? down() : up())}>
			{body}
		</button>
	);
}

/** A spell or item by name with its icon, linked to Wowhead so its tooltip shows on hover. */
function Named({ kind, id, name, names }: { kind: 'spell' | 'item'; id: number; name: string; names?: SimSetupData }) {
	const [attempt, setAttempt] = useState(0);
	const icon = kind === 'spell' ? names?.spellIcons?.[id] : (names?.itemIcons?.[id] ?? names?.consumables.find(c => c.id === id)?.icon);
	return (
		<a className="named" href={kind === 'spell' ? wowheadSpellUrl(id) : wowheadItemUrl(id)} data-wowhead={wowheadData(kind, id)} target="_blank" rel="noreferrer">
			{icon && attempt < ICON_SOURCES.length && <img src={ICON_SOURCES[attempt](icon)} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} />}
			{name}
		</a>
	);
}

/** Rotation text with its spells and items as icons with links. */
function Rich({ text, names }: { text: string; names?: SimSetupData }) {
	return <>{splitMarks(text).map((part, index) => (typeof part === 'string' ? part : <Named key={index} kind={part.kind} id={part.id} name={part.name} names={names} />))}</>;
}
