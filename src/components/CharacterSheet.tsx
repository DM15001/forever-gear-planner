import { useState } from 'react';

import { GEAR_SLOTS, PROFESSIONS, SHEET_LAYOUT } from '../lib/constants';
import { applicableEnchants } from '../lib/enchants';
import type { GameData } from '../lib/gameData';
import { gearStats, hitSummary, pieceStats, STAT_LABELS, statLine, wowheadItemUrl, wowheadData } from '../lib/stats';
import type { Character, GearPiece, SpecConfig, Stats } from '../lib/types';
import { EVERYTHING, withItem } from '../lib/scoring';
import { ItemIcon } from './ItemIcon';
import { SourceLabel } from './SourceLabel';
import { ItemPicker } from './ItemPicker';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData | null;
	onChange: (next: Character) => void;
	onImportAnother: () => void;
	onRemove: () => void;
	/** The names of all saved characters, to switch between them. */
	names: string[];
	/** The builds of this character's class to plan it as. */
	builds: SpecConfig[];
	activeIndex: number;
	onSelect: (index: number) => void;
	/** A link that opens this character and its plan on another device. */
	shareLink: string;
}

export function CharacterSheet({ spec, character, data, onChange, onImportAnother, onRemove, names, builds, activeIndex, onSelect, shareLink }: Props) {
	// 'copied' after the link went to the clipboard, 'shown' when the browser refused and the link is shown to copy by hand.
	const [shared, setShared] = useState<'idle' | 'copied' | 'shown'>('idle');
	// The slot whose item is being swapped by hand, if any.
	const [picking, setPicking] = useState<number | null>(null);
	const share = () => {
		navigator.clipboard.writeText(shareLink).then(
			() => setShared('copied'),
			() => setShared('shown'),
		);
	};
	const race = spec.races.find(r => r.id === character.race);
	const enchantCount = character.gear.filter(piece => piece?.enchant).length;
	const stats = data ? gearStats(character, data) : null;

	const setPiece = (index: number, piece: GearPiece | null) => onChange({ ...character, gear: character.gear.map((old, i) => (i === index ? piece : old)) });

	const setProfession = (index: number, name: string) => {
		const next = [character.professions[0] ?? '', character.professions[1] ?? ''];
		next[index] = name;
		onChange({ ...character, professions: next.filter(Boolean) });
	};

	const removeAllEnchants = () =>
		onChange({
			...character,
			gear: character.gear.map(piece => {
				if (!piece) return piece;
				const { enchant: _removed, ...rest } = piece;
				return rest;
			}),
		});

	const slot = (index: number, mirrored = false) => (
		<GearSlot key={GEAR_SLOTS[index].key} index={index} mirrored={mirrored} piece={character.gear[index]} data={data} onChange={piece => setPiece(index, piece)} onPick={() => setPicking(index)} />
	);

	// Swapping an item by hand keeps the enchant when it also fits the new item.
	const pickItem = (index: number, itemId: number | null) => {
		if (!data) return;
		// A two-hander empties the off hand and the other way round; an enchant stays only where it still fits.
		const gear = withItem(character.gear, index, itemId, data).map((piece, slot) => {
			if (!piece?.enchant) return piece;
			const item = data.itemById.get(piece.id);
			return item && applicableEnchants(slot, item, data).some(e => e.effectId === piece.enchant) ? piece : { id: piece.id };
		});
		onChange({ ...character, gear });
		setPicking(null);
	};

	return (
		<section className="sheet" aria-label="Character">
			<div className="sheet-column">{SHEET_LAYOUT.left.map(i => slot(i))}</div>

			<div className="sheet-center">
				<div className="panel identity">
					<h2>{character.name ?? `Your ${spec.className}`}</h2>
					<p className="identity-line">
						{race ? `${race.name}, ${race.faction === 'alliance' ? 'Alliance' : 'Horde'}` : 'Race not set'}
						{character.level ? `, level ${character.level}` : ''}
					</p>
					{stats && <StatsPanel stats={stats} character={character} spec={spec} />}
				</div>

				<div className="panel">
					<h3>Character details</h3>
					{names.length > 1 && (
						<>
							<label className="field-label" htmlFor="character-pick">
								Character
							</label>
							<select
								id="character-pick"
								value={activeIndex}
								onChange={e => {
									setShared('idle');
									onSelect(Number(e.target.value));
								}}>
								{names.map((name, index) => (
									<option key={index} value={index}>
										{name}
									</option>
								))}
							</select>
						</>
					)}
					<label className="field-label" htmlFor="character-name">
						Name
					</label>
					<input id="character-name" type="text" maxLength={60} placeholder={names[activeIndex]} value={character.name ?? ''} onChange={e => onChange({ ...character, name: e.target.value || undefined })} />
					{builds.length > 0 && (
						<>
							<label className="field-label" htmlFor="build">
								Build
							</label>
							{/* Another build has other stat weights, so the old plan no longer holds. Its talents, consumables and buffs replace the ones set before. */}
							<select
								id="build"
								value={spec.id}
								onChange={e => {
									const { consumables: _consumables, buffs: _buffs, ...rest } = character;
									onChange({ ...rest, specId: e.target.value, talents: '', plan: undefined, planEnchants: undefined });
								}}>
								{builds.map(build => (
									<option key={build.id} value={build.id}>
										{build.preset ?? build.name}
									</option>
								))}
							</select>
							<p className="hint build-note">
								The WoWSims preset configurations for this class. Picking one sets its talents, rotation, consumables, buffs, debuffs and class options for the sim; see the Sim setup tab.
								{character.talents && (
									<>
										{' '}
										The sim is using your own talents ({character.talents}), not the preset's.{' '}
										<button className="link" onClick={() => onChange({ ...character, talents: '' })}>
											Use the preset's talents
										</button>
									</>
								)}
							</p>
						</>
					)}
					<label className="field-label" htmlFor="race">
						Race
					</label>
					<select id="race" value={character.race ?? ''} onChange={e => onChange({ ...character, race: e.target.value || null })}>
						<option value="">Pick a race</option>
						{spec.races.map(r => (
							<option key={r.id} value={r.id}>
								{r.name}
							</option>
						))}
					</select>

					{[0, 1].map(index => (
						<div key={index}>
							<label className="field-label" htmlFor={`profession-${index}`}>
								Profession {index + 1}
							</label>
							<select id={`profession-${index}`} value={character.professions[index] ?? ''} onChange={e => setProfession(index, e.target.value)}>
								<option value="">None</option>
								{PROFESSIONS.filter(p => p === character.professions[index] || !character.professions.includes(p)).map(p => (
									<option key={p} value={p}>
										{p}
									</option>
								))}
							</select>
						</div>
					))}

					{character.talents && (
						<p className="identity-talents">
							<span className="field-label">Talents</span>
							<span className="talents">{character.talents}</span>
						</p>
					)}

					<div className="identity-actions">
						<button className="button" onClick={removeAllEnchants} disabled={enchantCount === 0}>
							Remove all enchants{enchantCount > 0 ? ` (${enchantCount})` : ''}
						</button>
						<button className="button" onClick={onImportAnother}>
							Add another character
						</button>
						<button className="button" onClick={share}>
							{shared === 'copied' ? 'Link copied' : 'Copy share link'}
						</button>
						{shared === 'shown' && <input type="text" readOnly aria-label="Share link" value={shareLink} onFocus={e => e.target.select()} />}
						<p className="hint">The link holds this character's gear and plan. Whoever opens it gets a copy next to their own characters.</p>
						<button className="link link-danger" onClick={onRemove}>
							Remove this character
						</button>
					</div>
				</div>
			</div>

			<div className="sheet-column">{SHEET_LAYOUT.right.map(i => slot(i, true))}</div>
			<div className="sheet-weapons">{SHEET_LAYOUT.bottom.map(i => slot(i))}</div>
			{picking !== null && data && (
				<ItemPicker slotIndex={picking} gear={character.gear} character={character} data={data} spec={spec} filter={EVERYTHING} startWithAll allowEmpty onPick={id => pickItem(picking, id)} onClose={() => setPicking(null)} />
			)}
		</section>
	);
}

const MELEE_KEYS = ['attackPower', 'critRating', 'hasteRating', 'expertiseRating'];
const SCHOOL_KEYS = ['natureDamage', 'shadowDamage', 'fireDamage', 'frostDamage', 'arcaneDamage', 'holyDamage'];

/** The stats worth showing for a spec: a caster has no use for attack power, a shaman none for frost damage. */
function statGroups(spec: SpecConfig): { title: string; keys: string[] }[] {
	const weighted = (key: string) => (spec.weights.stats[key] ?? 0) > 0;
	const melee = weighted('attackPower');
	return [
		{ title: 'Attributes', keys: melee ? ['strength', 'agility', 'stamina', 'intellect', 'spirit'] : ['stamina', 'intellect', 'spirit'] },
		melee ? { title: 'Melee', keys: MELEE_KEYS } : { title: 'Ratings', keys: ['critRating', 'hasteRating'] },
		{ title: 'Spell', keys: ['spellDamage', ...SCHOOL_KEYS.filter(weighted), ...(melee ? ['healingPower'] : ['spellPiercing'])] },
	];
}
const LONG_LABEL = new Map(STAT_LABELS.map(([key, , long]) => [key, long]));

function StatsPanel({ stats, character, spec }: { stats: Stats; character: Character; spec: SpecConfig }) {
	const hit = hitSummary(stats, character, spec);
	const percent = (value: number) => `${value.toFixed(1)}%`;
	let hitNote: string;
	if (hit.ratingOver > 0) hitNote = `${hit.ratingOver} hit rating over the cap`;
	else if (hit.ratingMissing > 0) hitNote = `${hit.ratingMissing} hit rating short of the cap`;
	else hitNote = 'At the cap';

	return (
		<div className="stats">
			<div className={`hit${hit.ratingOver > 0 ? ' hit-over' : ''}`}>
				<div className="hit-head">
					<span>Hit</span>
					<span className="num">
						{percent(hit.total)} of {hit.cap}%
					</span>
				</div>
				<div className="hit-bar" role="img" aria-label={`Hit ${percent(hit.total)} of ${hit.cap}% cap`}>
					<span style={{ width: `${Math.min(100, (hit.total / hit.cap) * 100)}%` }} />
				</div>
				<p className="hit-note">
					{hitNote}. {percent(hit.fromGear)} from gear{hit.fromRace ? `, ${percent(hit.fromRace)} racial` : ''}
					{hit.fromTalents ? `, ${percent(hit.fromTalents)} from the build's talents` : ''}.
				</p>
			</div>

			{statGroups(spec).map(group => (
				<dl key={group.title} className="stat-group">
					<dt className="stat-group-title">{group.title}</dt>
					{group.keys.map(key => (
						<div key={key} className="stat-row">
							<dt>{LONG_LABEL.get(key)}</dt>
							<dd className="num">{stats[key] ? `+${stats[key]}` : '0'}</dd>
						</div>
					))}
				</dl>
			))}
			<p className="hint">From gear and enchants only. Base stats, talents and buffs are not included.</p>
		</div>
	);
}

interface SlotProps {
	index: number;
	mirrored: boolean;
	piece: GearPiece | null;
	data: GameData | null;
	onChange: (piece: GearPiece | null) => void;
	/** Opens the list of items for this slot. */
	onPick: () => void;
}

function GearSlot({ index, mirrored, piece, data, onChange, onPick }: SlotProps) {
	const { label, key } = GEAR_SLOTS[index];
	const item = piece ? data?.itemById.get(piece.id) : undefined;
	const enchants = data ? applicableEnchants(index, item, data) : [];
	// An enchant id can be shared between slots, so look it up among this slot's enchants first.
	const enchantKnown = piece?.enchant ? enchants.some(e => e.effectId === piece.enchant) : true;
	const suffixes = (item?.randomSuffixOptions ?? []).map(id => data?.suffixById.get(id)).filter(s => s !== undefined);

	let name: string;
	if (!piece) name = 'Empty';
	else if (!data) name = 'Loading…';
	else name = item?.name ?? `Unknown item #${piece.id}`;
	const suffixName = piece?.randomSuffix ? data?.suffixById.get(piece.randomSuffix)?.name : undefined;
	const quality = item?.quality ?? 'none';
	const stats = item && piece && data ? statLine(pieceStats(item, piece, data)) : '';

	return (
		<div className={`slot${piece ? '' : ' slot-empty'}${mirrored ? ' slot-mirrored' : ''}`}>
			<button className="slot-button" onClick={onPick} disabled={!data} title={`Change the ${label.toLowerCase()} item`} aria-label={`Change the ${label.toLowerCase()} item`}>
				<ItemIcon icon={item?.icon} quality={quality} />
			</button>
			<div className="slot-body">
				<span className="slot-label">
					{label}
					{data && (
						<button className="link slot-change" onClick={onPick}>
							Change
						</button>
					)}
				</span>
				{piece ? (
					<a className={`slot-item quality-${quality}`} href={wowheadItemUrl(piece.id)} data-wowhead={wowheadData('item', piece.id)} target="_blank" rel="noreferrer">
						{name}
						{suffixName ? ` ${suffixName}` : ''}
					</a>
				) : (
					<span className="slot-item">{name}</span>
				)}
				{item && (
					<>
						<span className="slot-stats">
							{item.weapon?.dps ? `${item.weapon.dps.toFixed(1)} DPS, ${item.weapon.speed?.toFixed(2)} speed${stats ? ', ' : ''}` : ''}
							{stats}
							{!stats && !item.weapon?.dps && (item.effects ? 'Effect only, no stats' : 'No stats')}
						</span>
						<span className="slot-source">
							<SourceLabel source={item.sources?.[0]} data={data!} />
						</span>
					</>
				)}
			</div>
			{piece && (suffixes.length > 0 || enchants.length > 0) && (
				<div className="slot-foot">
					{suffixes.length > 0 && (
						<select
							className="slot-select"
							aria-label={`${label} random suffix`}
							value={piece.randomSuffix ?? ''}
							onChange={e => {
								const { randomSuffix: _old, ...rest } = piece;
								onChange(e.target.value ? { ...rest, randomSuffix: Number(e.target.value) } : rest);
							}}>
							<option value="">Pick the suffix</option>
							{suffixes.map(s => (
								<option key={s.id} value={s.id}>
									{s.name}
								</option>
							))}
						</select>
					)}
					{enchants.length > 0 && (
						<select
							className="slot-select"
							aria-label={`${label} enchant`}
							value={piece.enchant ?? ''}
							onChange={e => {
								const { enchant: _old, ...rest } = piece;
								onChange(e.target.value ? { ...rest, enchant: Number(e.target.value) } : rest);
							}}>
							<option value="">No enchant</option>
							{!enchantKnown && <option value={piece.enchant}>Unknown enchant #{piece.enchant}</option>}
							{enchants.map((e, i) => (
								<option key={`${key}-${e.effectId}-${i}`} value={e.effectId}>
									{e.name}
								</option>
							))}
						</select>
					)}
				</div>
			)}
		</div>
	);
}
