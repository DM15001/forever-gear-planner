import { AREAS, FAMILIES, MOB_TYPES, spaced } from '../lib/stats';
import type { Character } from '../lib/types';

/** The enemy kind and terrain the character fights in. Some items are only strong against one of them. */
export function FightPicker({ character, onChange }: { character: Character; onChange: (next: Character) => void }) {
	const fight = character.fight ?? {};
	const set = (patch: Partial<NonNullable<Character['fight']>>) => {
		const next = { ...fight, ...patch };
		onChange({ ...character, fight: next.mobType || next.area || next.family ? next : undefined });
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
				<span className="field-label">Creature</span>
				<select value={fight.family ?? ''} onChange={e => set({ family: e.target.value || undefined })}>
					<option value="">Any</option>
					{FAMILIES.map(family => (
						<option key={family} value={family}>
							{spaced(family)}
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
				Some items only give their bonus against one kind of enemy ("+12 spell damage against Undead"), one creature (Orcs, Trolls) or in one kind of terrain. Pick what you fight, for example Undead for Scholomance and
				Stratholme. Stat bonuses then count in the lists, the plan and the simulator; procs and on-use effects of that kind count in the simulator only.
			</p>
		</div>
	);
}
