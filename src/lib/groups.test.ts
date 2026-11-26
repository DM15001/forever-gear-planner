import { describe, expect, it } from 'vitest';
import { cleanGroups, withoutMember } from './groups';

describe('named groups', () => {
	it('moves everybody after a removed character up one place, in every group', () => {
		const saved = { at: 1, groups: [{ name: 'A', members: [0, 2, 3] }, { name: 'B', members: [1, 3] }] };
		expect(withoutMember(saved, 1)).toEqual({ at: 1, groups: [{ name: 'A', members: [0, 1, 2] }, { name: 'B', members: [2] }] });
	});
	it('throws away what is not a list of groups', () => {
		expect(cleanGroups(null)).toBeNull();
		expect(cleanGroups({ groups: [] })).toBeNull();
		expect(cleanGroups({ groups: [{ name: 'A', members: [1, 'x', 2.5, 3] }], at: 7 })).toEqual({ groups: [{ name: 'A', members: [1, 3] }], at: 0 });
	});
});
