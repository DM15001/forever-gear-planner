import { SPECS } from './specs';
import type { Character, SpecConfig } from './types';

/**
 * What the quick estimate does not know about this character. The stat weights behind it were measured with the
 * build's own talents, buffs, consumables and rotation; a character that differs gets less exact estimates, and
 * the simulator, which uses the character as it is, then says something else. Each entry is a reason in words,
 * with what to do about it. Empty when the weights were measured for this very character.
 */
export function estimateCaveats(character: Character, spec: SpecConfig): string[] {
	if (/^Measured for this character/.test(spec.weights.source ?? '')) return [];
	const reasons: string[] = [];
	const standard = SPECS.find(candidate => candidate.id === spec.id)?.talents;
	if (character.talents && standard && character.talents !== standard) reasons.push("your talents are not the build's standard ones");
	if (character.simFight) reasons.push('you changed the fight in Sim setup');
	if (character.simSettings && character.simSettings.specId === spec.id) reasons.push('the simulation uses the buffs, consumables and rotation of your WoWSims import');
	else {
		if (character.consumables && Object.keys(character.consumables).length > 0) reasons.push('you changed consumables in Sim setup');
		if (character.buffs && Object.values(character.buffs).some(scope => scope && Object.keys(scope).length > 0)) reasons.push('you changed buffs or debuffs in Sim setup');
	}
	if (reasons.length > 0) reasons.push('the estimate assumes the build\'s own; "Measure for my character" under Stat weights below makes it fit yours');
	return reasons;
}
