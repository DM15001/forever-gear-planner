// Consumable ids by the names WoWSims' TypeScript uses.
import { readFileSync } from 'node:fs';
const src = readFileSync('/home/claude/ref/forever/ui/features/settings/model/consumables_auto_gen.ts', 'utf8');
export const C = new Proxy({}, { get: (_, name) => { const m = src.match(new RegExp(`export const ${String(name)}\\b[^;]*?\\bid: (\\d+)`, 's')); if (!m) throw new Error('no consumable ' + String(name)); return Number(m[1]); } });
