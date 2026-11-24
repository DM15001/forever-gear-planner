// Runs a spec chunk of the built WoWSims site with every import stubbed out and records what its
// own top-level code hands to those imports: the presets, already compiled from .siml to JSON.
import { readFileSync, writeFileSync } from 'node:fs';
const [, , file, out] = process.argv;
let src = readFileSync(file, 'utf8');
const names = [];
src = src.replace(/import\s*\{([^}]*)\}\s*from\s*["`'][^"`']+["`'];?/g, (_, list) => {
	for (const part of list.split(',')) { const m = part.trim().match(/(?:\S+\s+as\s+)?(\S+)$/); if (m) names.push(m[1]); }
	return '';
}).replace(/import\s*["`'][^"`']+["`'];?/g, '').replace(/export\s*\{[^}]*\};?/g, '').replace(/\bimport\(/g, '__dyn(').replace(/import\.meta/g, '({url:""})');
const calls = [];
let n = 0;
const stub = label => { const f = function () {}; return new Proxy(f, {
	get: (_, key) => key === Symbol.toPrimitive ? () => `<${label}>` : key === 'then' ? undefined : key === Symbol.iterator ? function* () {} : typeof key === 'symbol' ? undefined : stub(`${label}.${String(key)}`),
	apply: (_, __, args) => { calls.push({ fn: label, args }); return stub(`${label}()#${n++}`); },
	construct: (_, args) => { calls.push({ fn: `new ${label}`, args }); return stub(`new ${label}#${n++}`); },
}); };
const body = `${names.map(x => `const ${x}=__stub(${JSON.stringify(x)});`).join('')}\n${src}`;
try { new Function('__stub', '__dyn', body)(stub, () => Promise.resolve(stub('dyn'))); } catch (e) { console.error('RUN ERROR', e.message); }
const plain = v => { try { return JSON.parse(JSON.stringify(v, (k, x) => (typeof x === 'function' ? `<fn>` : x))); } catch { return undefined; } };
const data = calls.map(c => ({ fn: c.fn, args: c.args.map(plain) }));
writeFileSync(out, JSON.stringify(data));
console.log('calls', data.length, [...new Set(data.map(d => d.fn))].slice(0, 40).join(' | '));
