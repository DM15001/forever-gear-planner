// Runs the WoWSims Forever simulator (WebAssembly, built by the WoWSims project) off the main thread.
// Messages in:  { id, request }  where request is the sim's RaidSimRequest as a JSON string;
//               with stats: true the sim only works out the character (stats, rotation checks), no fight.
// Messages out: { id, result }   the sim's RaidSimResult as a JSON string, or { id, error }.
importScripts('wasm_exec.js');

let ready;
const whenReady = new Promise(resolve => (ready = resolve));
self.wasmready = ready; // the sim calls this once its functions are registered

const started = (async () => {
	const response = await fetch('lib.wasm.gz');
	if (!response.ok) throw new Error(`Simulator download failed (HTTP ${response.status}).`);
	// Some hosts already unpack the file while serving it; the first two bytes tell which case this is.
	const bytes = new Uint8Array(await response.arrayBuffer());
	const gzipped = bytes[0] === 0x1f && bytes[1] === 0x8b;
	const wasm = gzipped ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer() : bytes.buffer;
	const go = new Go();
	const { instance } = await WebAssembly.instantiate(wasm, go.importObject);
	go.run(instance);
	await whenReady;
})();

self.onmessage = async ({ data }) => {
	try {
		await started;
		self.postMessage({ id: data.id, result: data.stats ? self.computeStatsJson(data.request) : self.raidSimJson(data.request) });
	} catch (err) {
		self.postMessage({ id: data.id, error: String(err && err.message ? err.message : err) });
	}
};
