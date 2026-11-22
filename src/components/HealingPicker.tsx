import { HEALING_PRESSURES, HEALING_STYLES, healingChoice } from '../lib/sim/healing';
import type { Character, SpecConfig } from '../lib/types';

/** A healer's scenario: which heals are cast and how much mana matters. It decides what every item is worth. */
export function HealingPicker({ character, spec, onChange }: { character: Character; spec: SpecConfig; onChange: (next: Character) => void }) {
	const choice = healingChoice(character);
	const set = (patch: Partial<typeof choice>) => onChange({ ...character, healing: { ...choice, ...patch } });
	const style = HEALING_STYLES.find(s => s.id === choice.style)!;
	const pressure = HEALING_PRESSURES.find(p => p.id === choice.pressure)!;
	const measured = spec.healing?.scenarios[`${choice.style}.${choice.pressure}`];
	return (
		<section className="panel healing-picker" aria-label="Healing scenario">
			<h3>What kind of healing?</h3>
			<div className="healing-choices">
				<label>
					<span className="field-label">Spells</span>
					<select value={choice.style} onChange={e => set({ style: e.target.value })}>
						{HEALING_STYLES.map(option => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
					<span className="slot-source">{style.hint}</span>
				</label>
				<label>
					<span className="field-label">Fight</span>
					<select value={choice.pressure} onChange={e => set({ pressure: e.target.value })}>
						{HEALING_PRESSURES.map(option => (
							<option key={option.id} value={option.id}>
								{option.label}
							</option>
						))}
					</select>
					<span className="slot-source">{pressure.hint}</span>
				</label>
			</div>
			<p className="hint">
				A healer has no DPS, and healing power alone says little: in a long fight a point of mana regeneration can be worth more. So every number here is healing per second over the whole fight you pick, played out by the WoWSims
				simulator: when the mana is gone, the healing stops until some comes back. Items are ranked by that.
				{measured && (
					<>
						{' '}
						With the WoWSims pre-raid set this scenario gives about {measured.hps.toLocaleString('en')} HPS
						{measured.oomSeconds > 0 ? `, out of mana for ${measured.oomSeconds} of ${pressure.duration} seconds` : ', never out of mana'}.
					</>
				)}
			</p>
		</section>
	);
}
