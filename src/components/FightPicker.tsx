import { AREAS, MOB_TYPES } from '../lib/stats';
import type { Character } from '../lib/types';

/** The enemy kind and terrain the character fights in. Some items are only strong against one of them. */
export function FightPicker({ character, onChange }: { character: Character; onChange: (next: Character) => void }) {
	const fight = character.fight ?? {};
	const set = (patch: Partial<NonNullable<Character['fight']>>) => {
		const next = { ...fight, ...patch };
		onChange({ ...character, fight: next.mobType || next.area ? next : undefined });
	};
	return (
		<div className="fight-picker">
			<label>
				<span className="field-label">Enemy type</span>
				<select value={fight.mobType ?? ''} onChange={e => set({ mobType: e.target.value || undefined })}>
					<option value="">Any (bonuses not counted)</option>
					{MOB_TYPES.map(type => (
						<option key={type} value={type}>
							{type}
						</option>
					))}
				</select>
			</label>
			<label>
				<span className="field-label">Terrain</span>
				<select value={fight.area ?? ''} onChange={e => set({ area: e.target.value || undefined })}>
					<option value="">Any (bonuses not counted)</option>
					{AREAS.map(([key, label]) => (
						<option key={key} value={key}>
							{label}
						</option>
					))}
				</select>
			</label>
			<p className="hint">
				Some items only give their bonus against one kind of enemy ("+12 spell damage against Undead") or in one kind of terrain. Pick what you fight, for example Undead for Scholomance and Stratholme, and the lists, the plan and
				the simulator count those bonuses.
			</p>
		</div>
	);
}
