import { GEAR_SLOTS, PROFESSIONS, SHEET_LAYOUT } from '../lib/constants';
import type { GameData } from '../lib/gameData';
import { gearStats, hitSummary, iconUrl, pieceStats, sourceLine, STAT_LABELS, statLine, wowheadItemUrl } from '../lib/stats';
import type { Character, GearPiece, SpecConfig, Stats } from '../lib/types';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData | null;
	onChange: (next: Character) => void;
	onImportAnother: () => void;
	onRemove: () => void;
}

export function CharacterSheet({ spec, character, data, onChange, onImportAnother, onRemove }: Props) {
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
		<GearSlot key={GEAR_SLOTS[index].key} index={index} mirrored={mirrored} piece={character.gear[index]} data={data} onChange={piece => setPiece(index, piece)} />
	);

	return (
		<section className="sheet" aria-label="Character">
			<div className="sheet-column">{SHEET_LAYOUT.left.map(i => slot(i))}</div>

			<div className="sheet-center">
				<div className="panel identity">
					<h2>{character.name ?? 'Your shaman'}</h2>
					<p className="identity-line">
						{race ? `${race.name}, ${race.faction === 'alliance' ? 'Alliance' : 'Horde'}` : 'Race not set'}
						{character.level ? `, level ${character.level}` : ''}
					</p>
					{stats && <StatsPanel stats={stats} character={character} spec={spec} />}
				</div>

				<div className="panel">
					<h3>Character details</h3>
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
							Import another character
						</button>
						<button className="link link-danger" onClick={onRemove}>
							Remove this character
						</button>
					</div>
				</div>
			</div>

			<div className="sheet-column">{SHEET_LAYOUT.right.map(i => slot(i, true))}</div>
			<div className="sheet-weapons">{SHEET_LAYOUT.bottom.map(i => slot(i))}</div>
		</section>
	);
}

const STAT_GROUPS: { title: string; keys: string[] }[] = [
	{ title: 'Attributes', keys: ['strength', 'agility', 'stamina', 'intellect', 'spirit'] },
	{ title: 'Melee', keys: ['attackPower', 'critRating', 'hasteRating', 'expertiseRating'] },
	{ title: 'Spell', keys: ['spellDamage', 'natureDamage', 'healingPower'] },
];
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
					{hitNote}. {percent(hit.fromGear)} from gear{hit.fromRace ? `, ${percent(hit.fromRace)} racial` : ''}.
				</p>
			</div>

			{STAT_GROUPS.map(group => (
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
}

function GearSlot({ index, mirrored, piece, data, onChange }: SlotProps) {
	const { label, kind, key } = GEAR_SLOTS[index];
	const item = piece ? data?.itemById.get(piece.id) : undefined;
	const enchants = data?.enchantsBySlot.get(kind) ?? [];
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
			<div className={`slot-icon quality-border-${quality}`} aria-hidden="true">
				{item?.icon && <img src={iconUrl(item.icon)} alt="" loading="lazy" onError={e => (e.currentTarget.style.display = 'none')} />}
			</div>
			<div className="slot-body">
				<span className="slot-label">{label}</span>
				{piece ? (
					<a className={`slot-item quality-${quality}`} href={wowheadItemUrl(piece.id)} target="_blank" rel="noreferrer">
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
						<span className="slot-source">{sourceLine(item.sources?.[0], data!)}</span>
					</>
				)}
				{piece && suffixes.length > 0 && (
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
				{piece && enchants.length > 0 && (
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
		</div>
	);
}
