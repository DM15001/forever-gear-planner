// Runs the prebuilt WoWSims Forever WebAssembly sim in Node.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
globalThis.crypto ??= require('node:crypto').webcrypto;
require(process.env.WASM_EXEC ?? '/usr/local/go/lib/wasm/wasm_exec.js');

const ITEM_FIELDS = ['id','name','type','armorType','weaponType','handType','rangedWeaponType','qualityModifier','weaponSpeed','setName','setId','scalingOptions','itemEffects','limitCategory','unique','pseudoStats','classAllowlist','spellSchool'];
const ENCHANT_FIELDS = ['effectId','name','type','stats','enchantEffects','enchantType','extraTypes','pseudoStats','weaponDamage','procKind'];
const pick = (obj, fields) => Object.fromEntries(fields.filter(f => obj[f] !== undefined).map(f => [f, obj[f]]));

export async function loadSim(wasmPath, dbPath) {
	const db = JSON.parse(readFileSync(dbPath, 'utf8'));
	const go = new globalThis.Go();
	let ready;
	const whenReady = new Promise(r => (ready = r));
	globalThis.wasmready = ready; // the sim calls this once its functions are registered
	const { instance } = await WebAssembly.instantiate(readFileSync(wasmPath), go.importObject);
	go.run(instance);
	await whenReady;
	const itemById = new Map(db.items.map(i => [i.id, i]));
	const rppByIlvl = new Map(db.itemEffectRandPropPoints.map(r => [r.ilvl, r]));

	/** player: a sim player JSON without `database`. Returns { dps, stdev, error? }. */
	// `extraItems`: item records of the caller's own (changed copies under ids of their own), added to the database.
	function run(request, iterations = 3000, extraItems = []) {
		const req = structuredClone(request);
		delete req.requestId;
		req.simOptions = { iterations, randomSeed: '1' };
		const player = req.raid.parties[0].players[0];
		const pieces = [...(player.equipment?.items ?? []), ...(player.itemSwap?.items ?? [])].filter(p => p?.id);
		const items = [...[...new Set(pieces.map(p => p.id))].map(id => itemById.get(id)).filter(Boolean), ...extraItems];
		const missing = pieces.filter(p => !itemById.has(p.id) && !extraItems.some(e => e.id === p.id)).map(p => p.id);
		const enchantIds = new Set(pieces.map(p => p.enchant).filter(Boolean));
		player.database = {
			items: items.map(i => pick(i, ITEM_FIELDS)),
			enchants: db.enchants.filter(e => enchantIds.has(e.effectId)).map(e => pick(e, ENCHANT_FIELDS)),
			randomSuffixes: db.randomSuffixes.filter(s => pieces.some(p => p.randomSuffix === s.id)),
			itemEffectRandPropPoints: [...new Set(items.map(i => i.scalingOptions?.['0']?.ilvl))].map(l => rppByIlvl.get(l)).filter(Boolean),
			consumables: db.consumables,
			spellEffects: db.spellEffects,
		};
		const out = globalThis.raidSimJson(JSON.stringify(req));
		if (!out) return { error: 'sim returned nothing (request rejected)', missing };
		const result = JSON.parse(out);
		if (result.error || result.errorResult) return { error: JSON.stringify(result.error ?? result.errorResult).slice(0, 400), missing };
		const dps = result.raidMetrics?.dps;
		return { dps: dps?.avg, stdev: dps?.stdev, missing, result };
	}
	/** Final character stats for the request's player (no fight simulated). */
	function stats(request) {
		const probe = run(request, 1); // builds and attaches the database as a side effect of the same code path
		const req = structuredClone(request);
		const player = req.raid.parties[0].players[0];
		const pieces = [...(player.equipment?.items ?? []), ...(player.itemSwap?.items ?? [])].filter(p => p?.id);
		const items = [...new Set(pieces.map(p => p.id))].map(id => itemById.get(id)).filter(Boolean);
		const enchantIds = new Set(pieces.map(p => p.enchant).filter(Boolean));
		player.database = { items: items.map(i => pick(i, ITEM_FIELDS)), enchants: db.enchants.filter(e => enchantIds.has(e.effectId)).map(e => pick(e, ENCHANT_FIELDS)), randomSuffixes: db.randomSuffixes.filter(s => pieces.some(p => p.randomSuffix === s.id)), itemEffectRandPropPoints: [...new Set(items.map(i => i.scalingOptions?.['0']?.ilvl))].map(l => rppByIlvl.get(l)).filter(Boolean), consumables: db.consumables, spellEffects: db.spellEffects };
		const out = globalThis.computeStatsJson(JSON.stringify({ raid: req.raid, encounter: req.encounter }));
		return out ? JSON.parse(out) : null;
	}
	return { run, stats, db };
}
