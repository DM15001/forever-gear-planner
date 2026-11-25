// Spell ranks only a class book teaches (Tablet of Flame Shock VI and the like), and what each build's rotation
// does about them. WoWSims keeps the list by hand in sim/core/spelldata/book_ranks.go; the names and ranks of the
// spells come from its generated spell data. Used by scripts/build-data.mjs, which writes src/data/bookRanks.json.

/**
 * @param {string} bookText   sim/core/spelldata/book_ranks.go
 * @param {string} spellText  sim/core/spelldata/spells_auto_gen.go
 * @param {Map<string, object>} templates  build id -> the sim request the build ships
 * @returns {{ books: Record<string, { item: string, spell: string, rank: number, below?: number }>, bySpec: Record<string, { book: number, casts: 'book' | 'below' }[]> }}
 *   `below` is the rank before the book's, the highest a trainer teaches. `bySpec` lists, per build, the books whose
 *   spell its rotation casts, and whether it casts the book's rank or the one below.
 */
export function bookRanks(bookText, spellText, templates) {
	const spells = new Map();
	const byName = new Map();
	for (const [, id, name, rank] of spellText.matchAll(/^\t\{ID: (\d+), Name: "([^"]+)"(?:, Rank: "Rank (\d+)")?/gm)) {
		const spell = { id: Number(id), name, rank: Number(rank ?? 0) };
		spells.set(spell.id, spell);
		byName.set(name, [...(byName.get(name) ?? []), spell]);
	}
	const books = {};
	for (const [, id, note] of bookText.matchAll(/^\s*(\d+):\s*true,\s*\/\/\s*(.+)$/gm)) {
		// Only the ranks an item teaches: the comment names the book. The buffs of totem ranks and the like are left out.
		const item = note.split(',')[0].trim();
		const spell = spells.get(Number(id));
		if (!/^(Manual|Grimoire|Guide|Tablet|Tome|Book|Codex|Libram|Handbook)\b/.test(item) || !spell?.rank) continue;
		const below = (byName.get(spell.name) ?? []).find(other => other.rank === spell.rank - 1 && !bookText.includes(`\t${other.id}:`));
		books[id] = { item, spell: spell.name, rank: spell.rank, ...(below ? { below: below.id } : {}) };
	}
	const spellIds = value => (value && typeof value === 'object' ? Object.entries(value).flatMap(([key, inner]) => (key === 'spellId' && typeof inner === 'number' ? [inner] : spellIds(inner))) : []);
	const bySpec = {};
	for (const [specId, template] of templates) {
		const cast = new Set(spellIds(template.raid?.parties?.[0]?.players?.[0]?.rotation));
		const list = Object.entries(books).flatMap(([id, book]) => (cast.has(Number(id)) ? [{ book: Number(id), casts: 'book' }] : book.below && cast.has(book.below) ? [{ book: Number(id), casts: 'below' }] : []));
		if (list.length) bySpec[specId] = list;
	}
	return { books, bySpec };
}
