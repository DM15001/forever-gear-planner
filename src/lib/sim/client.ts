import type { Gear } from '../scoring';
import type { Character } from '../types';
import { buildSimRequest, indexSimDb, readSimResult, type SimIndex, simKey, type SimOutcome } from './request';

const SIM_URL = `${import.meta.env.BASE_URL}sim/`;

/**
 * Talks to the simulator worker. The worker, the sim itself (about 6 MB) and its item data are
 * only loaded on the first run. Runs are queued one after another and cached by gear.
 */
export class SimClient {
	private worker: Worker | null = null;
	private index: Promise<SimIndex> | null = null;
	private nextId = 1;
	private waiting = new Map<number, { resolve: (json: string) => void; reject: (err: Error) => void }>();
	private cache = new Map<string, Promise<SimOutcome>>();

	private load(): Promise<SimIndex> {
		if (!this.index) {
			this.worker = new Worker(`${SIM_URL}worker.js`);
			this.worker.onmessage = ({ data }) => {
				const entry = this.waiting.get(data.id);
				if (!entry) return;
				this.waiting.delete(data.id);
				if (data.error) entry.reject(new Error(data.error));
				else entry.resolve(data.result);
			};
			this.worker.onerror = event => {
				for (const entry of this.waiting.values()) entry.reject(new Error(event.message || 'The simulator could not be started.'));
				this.waiting.clear();
			};
			const json = async (name: string) => {
				const response = await fetch(`${SIM_URL}${name}`);
				if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status}).`);
				return response.json();
			};
			this.index = Promise.all([json('db.json'), json('template.json')]).then(([db, template]) => indexSimDb(db, template));
			this.index.catch(() => (this.index = null)); // allow a retry after a failed download
		}
		return this.index;
	}

	/** Simulated DPS of `gear` on this character. */
	run(character: Character, gear: Gear, iterations: number): Promise<SimOutcome> {
		const key = simKey(character, gear, iterations);
		let outcome = this.cache.get(key);
		if (!outcome) {
			outcome = this.load().then(index => {
				const { request } = buildSimRequest(character, gear, index, iterations);
				return new Promise<string>((resolve, reject) => {
					const id = this.nextId++;
					this.waiting.set(id, { resolve, reject });
					this.worker!.postMessage({ id, request: JSON.stringify(request) });
				}).then(json => readSimResult(json, iterations));
			});
			this.cache.set(key, outcome);
			outcome.catch(() => this.cache.delete(key));
		}
		return outcome;
	}
}

export const simClient = new SimClient();
