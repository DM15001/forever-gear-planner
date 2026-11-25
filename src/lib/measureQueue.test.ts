import { describe, expect, it } from 'vitest';
// @ts-expect-error a plain script without types
import { affected, touches } from '../../scripts/measure-queue.mjs';

describe('which builds a WoWSims update touches', () => {
	it('reads a class from its folder, in the simulator and in the presets', () => {
		expect(touches('sim/mage/fireball.go')).toBe('mage');
		expect(touches('ui/specs/hunter/dps/presets.ts')).toBe('hunter');
	});
	it('counts shared code and the item data as everybody', () => {
		for (const path of ['sim/core/spell.go', 'sim/common/items.go', 'sim/siml/build.go', 'assets/database/db.json', 'proto/api.proto', 'sim/register_all.go']) expect(touches(path)).toBe('all');
	});
	it('ignores tests, documents and the interface', () => {
		for (const path of ['sim/mage/fire_test.go', 'sim/mage/TestFire.results', 'docs/rulings/x.md', 'ui/features/gear/picker.tsx', 'ui/sim/thing.ts', '.github/workflows/ci.yml', 'tools/database/main.go', 'package.json', 'vite.config.mts']) expect(touches(path)).toBe('none');
	});
	it('takes anything it does not know as everybody', () => {
		expect(touches('brand-new-folder/file.go')).toBe('all');
	});
	it('names the builds of the classes that were touched, and all of them for shared code', () => {
		const mage = affected(['sim/mage/fireball.go', 'ui/features/x.tsx']);
		expect(mage.length).toBeGreaterThan(0);
		expect(mage.every((id: string) => id.startsWith('mage'))).toBe(true);
		expect(affected(['docs/a.md'])).toEqual([]);
		expect(affected(['sim/core/spell.go']).length).toBeGreaterThan(30);
	});
});
