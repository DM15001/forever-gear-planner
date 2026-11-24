import { GEAR_SLOTS, PROFESSIONS } from './constants';
import { SPECS } from './specs';
import type { Character, GearPiece, SpecConfig, SimSettings } from './types';

export type ExportFormat = 'addon' | 'sim';

export interface ImportResult {
	character: Character;
	format: ExportFormat;
	/** Things the user should double-check. Shown after a successful import. */
	warnings: string[];
}

export class ImportError extends Error {}

/** "RaceDwarf", "Dwarf", "windshaper skyborne" -> "dwarf", "windshaperskyborne" */
const normalize = (value: unknown, prefix: string) =>
	String(value ?? '')
		.toLowerCase()
		.replace(/[^a-z]/g, '')
		.replace(new RegExp(`^${prefix}`), '');

function parseGear(rawItems: unknown): (GearPiece | null)[] {
	const list = Array.isArray(rawItems) ? rawItems : [];
	return GEAR_SLOTS.map((_, index) => {
		const raw = list[index];
		if (!raw || typeof raw !== 'object' || typeof raw.id !== 'number' || raw.id <= 0) return null;
		const piece: GearPiece = { id: raw.id };
		if (typeof raw.enchant === 'number' && raw.enchant > 0) piece.enchant = raw.enchant;
		if (typeof raw.randomSuffix === 'number' && raw.randomSuffix !== 0) piece.randomSuffix = raw.randomSuffix;
		return piece;
	});
}

function parseProfessions(names: unknown[], warnings: string[]): string[] {
	const result: string[] = [];
	for (const raw of names) {
		const wanted = normalize(raw, 'profession');
		if (!wanted || wanted === 'unknown') continue;
		const match = PROFESSIONS.find(p => p.toLowerCase() === wanted);
		if (match) result.push(match);
		else warnings.push(`Profession "${String(raw)}" is not known and was left out.`);
	}
	return result.slice(0, 2);
}

/** The keys under which sim exports carry spec options: "enhancementShaman", "dpsPriest", "warlock" ... */
const KNOWN_SIM_KEYS = /^([a-zA-Z]+(Shaman|Priest|Druid|Warrior|Paladin)|warlock|mage|hunter|rogue)$/;

/**
 * Reads a character from pasted text. Two formats are accepted:
 * - the WoWSims Exporter addon's JSON (`{ class, race, gear: { items } ... }`)
 * - the sim's own JSON: its settings export (`{ player, raidBuffs, encounter ... }`) or a full
 *   request (`{ raid: { parties: [{ players: [player] }] } }`)
 * The spec is picked from the export's class among the given specs (all known ones by default).
 * Throws ImportError with a message for the user when the text cannot be used.
 */
export function importCharacter(text: string, specOrSpecs: SpecConfig | SpecConfig[] = SPECS): ImportResult {
	const specs = Array.isArray(specOrSpecs) ? specOrSpecs : [specOrSpecs];
	let json: any;
	try {
		json = JSON.parse(text.trim());
	} catch {
		throw new ImportError('This is not valid JSON. Copy the whole export, from the first { to the last }.');
	}
	if (!json || typeof json !== 'object' || Array.isArray(json)) {
		throw new ImportError('This is not a character export. Paste the JSON from the WoWSims Exporter addon or the sim’s JSON export.');
	}

	const warnings: string[] = [];
	// The sim has three JSON shapes: a full request (raid > parties > players), its saved settings
	// (a top-level `player`), and a bare player.
	const isPlayer = (value: any) => value && typeof value === 'object' && ('equipment' in value || 'class' in value);
	const simPlayer = json.raid?.parties?.[0]?.players?.[0] ?? (isPlayer(json.player) ? json.player : null) ?? (json.equipment ? json : null);
	const format: ExportFormat = simPlayer ? 'sim' : 'addon';
	const source = simPlayer ?? json;

	if (format === 'addon' && !('class' in json) && !('gear' in json)) {
		throw new ImportError('This JSON has no character in it. Paste the JSON from the WoWSims Exporter addon or the sim’s JSON export.');
	}
	if (format === 'addon' && json.flavor && json.flavor !== 'forever') {
		throw new ImportError(`This export is from "${json.flavor}", not from WoW: Forever.`);
	}

	const className = normalize(source.class, 'class');
	if (!className) throw new ImportError('The export does not say which class this is.');
	const sameClass = specs.filter(candidate => candidate.className === className);
	if (!sameClass.length) {
		throw new ImportError(`This character is a ${className}. The planner supports ${[...new Set(specs.map(candidate => candidate.className.charAt(0).toUpperCase() + candidate.className.slice(1)))].join(', ')} so far.`);
	}
	// A sim export names its spec by the key of its options ("warlock", "dpsPriest", "healingPriest" ...).
	const simKeys = format === 'sim' ? Object.keys(source).filter(key => KNOWN_SIM_KEYS.test(key)) : [];
	const matching = simKeys.length ? sameClass.filter(candidate => simKeys.includes(candidate.simKey)) : sameClass;
	if (!matching.length) {
		throw new ImportError(`This ${className} export is for a spec the planner does not cover yet (${simKeys.join(', ')}). It covers ${sameClass.map(candidate => candidate.name).join(', ')}.`);
	}
	// Several builds of one class: take the one whose own talents are spread over the trees most like
	// the character's. Without talents, the addon export's tree name ("affliction") decides.
	const treePoints = (talents: string) => talents.split('-').map(tree => [...tree].reduce((sum, digit) => sum + (Number(digit) || 0), 0));
	const distance = (a: number[], b: number[]) => [0, 1, 2].reduce((sum, i) => sum + Math.abs((a[i] ?? 0) - (b[i] ?? 0)), 0);
	const talentSource = String(source.talents ?? source.talentsString ?? '');
	const own = talentSource ? treePoints(talentSource) : null;
	const tree = typeof source.spec === 'string' ? source.spec.toLowerCase() : '';
	// The addon names what the character plays ("holy_disc", "shadow"): a healing spec goes to the healer
	// builds and a damage spec to the others, before the talents pick among those.
	const wantsHealer = format === 'addon' && tree ? /holy|disc|resto|heal/.test(tree) : undefined;
	const ofRole = wantsHealer === undefined ? matching : matching.filter(candidate => (candidate.role === 'healer') === wantsHealer);
	const pool = ofRole.length ? ofRole : matching;
	const byTalents = own ? [...pool].sort((x, y) => distance(own, treePoints(x.talents ?? '')) - distance(own, treePoints(y.talents ?? '')))[0] : undefined;
	const byName = tree ? pool.find(candidate => candidate.id.split('-').some(part => part.length > 2 && (tree.startsWith(part) || part.startsWith(tree)))) : undefined;
	const ofTree = byTalents ?? byName;
	const spec = ofTree ?? matching[0];
	if (matching.length > 1) warnings.push(`Planned as "${spec.name}"${ofTree ? ', the build closest to your talents' : ''}. Pick another build under Character details if you play a different one.`);

	const wantedRace = normalize(source.race, 'race');
	const race = spec.races.find(r => normalize(r.id, 'race') === wantedRace)?.id ?? null;
	if (!race) warnings.push(wantedRace ? `Race "${String(source.race)}" is not a ${spec.name} race. Pick the race below.` : 'The export has no race. Pick the race below.');

	const professionNames = format === 'sim' ? [source.profession1, source.profession2] : Array.isArray(source.professions) ? source.professions.map((p: any) => p?.name) : [];
	const gear = parseGear(format === 'sim' ? source.equipment?.items : source.gear?.items);
	if (gear.every(piece => piece === null)) warnings.push('The export has no gear in it.');

	// A WoWSims export carries the whole setup of the run. Keep it, so the planner simulates what wowsims.com does.
	let simSettings: SimSettings | undefined;
	if (format === 'sim') {
		const record = (value: unknown) => (value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined);
		const { equipment: _gear, race: _race, talentsString: _talents, profession1: _first, profession2: _second, name: _name, database: _database, bonusStats: _bonus, ...rest } = source as Record<string, unknown>;
		const full = record(json.raid);
		const settings = {
			player: rest,
			raidBuffs: record(json.raidBuffs) ?? record(full?.buffs),
			partyBuffs: record(json.partyBuffs) ?? record((full?.parties as { buffs?: unknown }[] | undefined)?.[0]?.buffs),
			debuffs: record(json.debuffs) ?? record(full?.debuffs),
			encounter: record(json.encounter),
		};
		// A bare player has gear only; anything with consumables or a rotation is a setup worth keeping.
		if (rest.consumables || rest.rotation || settings.raidBuffs) {
			const text = JSON.stringify(settings);
			let mark = 5381;
			for (let i = 0; i < text.length; i++) mark = ((mark << 5) + mark + text.charCodeAt(i)) >>> 0;
			simSettings = { specId: spec.id, id: `${mark.toString(36)}${text.length.toString(36)}`, ...settings };
			warnings.push('This is a sim export. Its consumables, buffs, debuffs, rotation and fight are used as they are, so "Simulate" matches wowsims.com for it. Sim setup (top right) can switch back to the build\'s own settings. Check race, professions and enchants below.');
		} else {
			warnings.push('This is a sim export. The sim fills in its own race, professions and enchants, so check all three below.');
		}
	}
	const level = typeof source.level === 'number' ? source.level : null;
	if (level !== null && level < 60) warnings.push(`This character is level ${level}. Scores and upgrades assume level 60.`);

	const name = typeof source.name === 'string' && source.name && source.name !== 'Player' ? source.name : undefined;
	return {
		format,
		warnings,
		character: {
			name,
			specId: spec.id,
			race,
			level,
			talents: String(source.talents ?? source.talentsString ?? ''),
			professions: parseProfessions(professionNames, warnings),
			gear,
			...(simSettings ? { simSettings } : {}),
		},
	};
}
