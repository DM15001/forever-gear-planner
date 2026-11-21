import { GEAR_SLOTS, PROFESSIONS, SHEET_LAYOUT } from '../lib/constants';
import type { GameData } from '../lib/gameData';
import type { Character, GearPiece, SpecConfig } from '../lib/types';

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

	const slot = (index: number) => <GearSlot key={GEAR_SLOTS[index].key} index={index} piece={character.gear[index]} data={data} onChange={piece => setPiece(index, piece)} />;

	return (
		<section className="sheet" aria-label="Character">
			<div className="sheet-column">{SHEET_LAYOUT.left.map(slot)}</div>

			<div className="identity">
				<h2>{character.name ?? 'Your shaman'}</h2>
				<p className="identity-line">
					{race ? `${race.name}, ${race.faction === 'alliance' ? 'Alliance' : 'Horde'}` : 'Race not set'}
					{character.level ? `, level ${character.level}` : ''}
				</p>

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

			<div className="sheet-column">{SHEET_LAYOUT.right.map(slot)}</div>
			<div className="sheet-weapons">{SHEET_LAYOUT.bottom.map(slot)}</div>
		</section>
	);
}

interface SlotProps {
	index: number;
	piece: GearPiece | null;
	data: GameData | null;
	onChange: (piece: GearPiece | null) => void;
}

function GearSlot({ index, piece, data, onChange }: SlotProps) {
	const { label, kind, key } = GEAR_SLOTS[index];
	const item = piece ? data?.itemById.get(piece.id) : undefined;
	const enchants = data?.enchantsBySlot.get(kind) ?? [];
	// An enchant id can be shared between slots, so look it up among this slot's enchants first.
	const known = piece?.enchant ? enchants.some(e => e.effectId === piece.enchant) : true;

	let name: string;
	if (!piece) name = 'Empty';
	else if (!data) name = 'Loading…';
	else name = item?.name ?? `Unknown item #${piece.id}`;

	return (
		<div className={`slot${piece ? '' : ' slot-empty'}`}>
			<span className="slot-label">{label}</span>
			<span className={`slot-item quality-${item?.quality ?? 'none'}`}>{name}</span>
			{piece && item?.randomSuffixOptions && !piece.randomSuffix && <span className="slot-note">Random suffix not in the export, stats incomplete</span>}
			{piece && enchants.length > 0 && (
				<select
					className="slot-enchant"
					aria-label={`${label} enchant`}
					value={piece.enchant ?? ''}
					onChange={e => {
						const { enchant: _old, ...rest } = piece;
						onChange(e.target.value ? { ...rest, enchant: Number(e.target.value) } : rest);
					}}>
					<option value="">No enchant</option>
					{!known && <option value={piece.enchant}>Unknown enchant #{piece.enchant}</option>}
					{enchants.map((e, i) => (
						<option key={`${key}-${e.effectId}-${i}`} value={e.effectId}>
							{e.name}
						</option>
					))}
				</select>
			)}
		</div>
	);
}
