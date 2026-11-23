import type { Gear } from '../scoring';
import type { Character } from '../types';
import { specOf } from '../specs';
import { type BonusStats, buildSimRequest, indexSimDb, isHealer, readRotationChecks, readSimResult, type RotationChecks, type SimDb, type SimIndex, simKey, type SimOutcome, type SimTemplate } from './request';
import { castingShare, countsMending, readMending } from './mending';
import type { SimSetupData } from './setup';

const SIM_URL = `${import.meta.env.BASE_URL}sim/`;

/**
 * Talks to the simulator worker. The worker, the sim itself (about 6 MB) and its item data are
 * only loaded on the first run. Runs are queued one after another and cached by gear.
 */
export class SimClient {
	private worker: Worker | null = null;
	private db: Promise<SimDb> | null = null;
	/** One request template per spec, loaded when a character of that spec is first simulated. */
	private indexes = new Map<string, Promise<SimIndex>>();
	private nextId = 1;
	private waiting = new Map<number, { resolve: (json: string) => void; reject: (err: Error) => void }>();
	private cache = new Map<string, Promise<SimOutcome>>();

	private load(specId: string): Promise<SimIndex> {
		const json = async (name: string) => {
			const response = await fetch(`${SIM_URL}${name}`, { cache: 'no-cache' });
			if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status}).`);
			return response.json();
		};
		if (!this.worker) {
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
		}
		if (!this.db) {
			this.db = json('db.json');
			this.db.catch(() => (this.db = null)); // allow a retry after a failed download
		}
		let index = this.indexes.get(specId);
		if (!index) {
			index = Promise.all([this.db, json(`template.${specId}.json`)]).then(([db, template]) => indexSimDb(db, template));
			this.indexes.set(specId, index);
			index.catch(() => this.indexes.delete(specId));
		}
		return index;
	}

	private setupData: Promise<SimSetupData> | null = null;
	private templates = new Map<string, Promise<SimTemplate>>();

	/** Small files only, without starting the simulator: what the Sim setup tab shows. */
	private async small<T>(name: string): Promise<T> {
		const response = await fetch(`${SIM_URL}${name}`, { cache: 'no-cache' });
		if (!response.ok) throw new Error(`Could not load ${name} (HTTP ${response.status}).`);
		return response.json();
	}

	/** Talent trees, names and consumables. */
	setup(): Promise<SimSetupData> {
		if (!this.setupData) {
			this.setupData = this.small<SimSetupData>('setup.json');
			this.setupData.catch(() => (this.setupData = null));
		}
		return this.setupData;
	}

	/** The WoWSims build of a spec: the settings every run starts from. */
	template(specId: string): Promise<SimTemplate> {
		let template = this.templates.get(specId);
		if (!template) {
			template = this.small<SimTemplate>(`template.${specId}.json`);
			this.templates.set(specId, template);
			template.catch(() => this.templates.delete(specId));
		}
		return template;
	}

	private checks = new Map<string, Promise<RotationChecks>>();

	/** What the simulator says about each step of the rotation for this character: spells it does not know, missing effects. */
	rotationChecks(character: Character): Promise<RotationChecks> {
		const key = simKey(character, character.gear, 0);
		let outcome = this.checks.get(key);
		if (!outcome) {
			outcome = this.load(specOf(character).id).then(index => {
				const { request } = buildSimRequest(character, character.gear, index, 1);
				return new Promise<string>((resolve, reject) => {
					const id = this.nextId++;
					this.waiting.set(id, { resolve, reject });
					this.worker!.postMessage({ id, stats: true, request: JSON.stringify({ raid: request.raid, encounter: request.encounter }) });
				}).then(readRotationChecks);
			});
			this.checks.set(key, outcome);
			outcome.catch(() => this.checks.delete(key));
		}
		return outcome;
	}

	/** Simulated DPS of `gear` on this character. */
	run(character: Character, gear: Gear, iterations: number, bonus?: BonusStats): Promise<SimOutcome> {
		const key = simKey(character, gear, iterations, bonus);
		let outcome = this.cache.get(key);
		if (!outcome) {
			outcome = this.load(specOf(character).id).then(index => {
				const { request } = buildSimRequest(character, gear, index, iterations, bonus);
				const ask = (message: Record<string, unknown>) =>
					new Promise<string>((resolve, reject) => {
						const id = this.nextId++;
						this.waiting.set(id, { resolve, reject });
						this.worker!.postMessage({ id, ...message });
					});
				const healer = isHealer(index.template);
				const simulated = ask({ request: JSON.stringify(request) }).then(json => readSimResult(json, iterations, healer));
				if (!healer || !countsMending(character)) return simulated;
				// The engine cannot cast Prayer of Mending yet: its healing is worked out from the character's stats and added.
				const stats = ask({ stats: true, request: JSON.stringify({ raid: request.raid, encounter: request.encounter }) }).catch(() => null);
				return Promise.all([simulated, stats]).then(([outcome, statsJson]) => {
					const mending = readMending(statsJson, outcome.dps, castingShare(character));
					return mending ? { ...outcome, dps: outcome.dps + mending.hps, mending } : outcome;
				});
			});
			this.cache.set(key, outcome);
			outcome.catch(() => this.cache.delete(key));
		}
		return outcome;
	}
}

export const simClient = new SimClient();
