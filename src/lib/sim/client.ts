import type { Gear } from '../scoring';
import type { Character } from '../types';
import { specOf } from '../specs';
import { type BonusStats, buildSimRequest, indexSimDb, isHealer, readRotationChecks, readSimResult, readTimeline, type RotationChecks, type SimDb, type SimIndex, simKey, type SimOutcome, type SimTemplate, type SimTimeline } from './request';
import { castingShare, countsMending, readMending, withMending } from './mending';
import type { SimSetupData } from './setup';

const SIM_URL = `${import.meta.env.BASE_URL}sim/`;
/** Added to the engine's address: a new simulator is a new address, so no browser cache can serve the old one. */
const VERSION = __SIM_COMMIT__ ? `?v=${__SIM_COMMIT__.slice(0, 12)}` : '';

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
			this.worker = new Worker(`${SIM_URL}worker.js${VERSION}`);
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

	/**
	 * True when the published site carries a newer simulator than this open page was loaded with: a tab left open
	 * over an update keeps running the engine it started with, and its numbers then differ from wowsims.com.
	 */
	async outdated(): Promise<boolean> {
		if (!__SIM_COMMIT__) return false;
		try {
			const published = await this.small<SimSetupData>('setup.json');
			const commit = published.simVersion?.commit;
			return Boolean(commit) && commit !== __SIM_COMMIT__;
		} catch {
			return false; // offline: nothing to compare with
		}
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

	private timelines = new Map<string, Promise<SimTimeline | undefined>>();

	/** One logged fight of `gear`, second by second, for the graph over the breakdown. */
	timeline(character: Character, gear: Gear): Promise<SimTimeline | undefined> {
		const key = simKey(character, gear, -1);
		let outcome = this.timelines.get(key);
		if (!outcome) {
			outcome = this.load(specOf(character).id).then(index => {
				const { request } = buildSimRequest(character, gear, index, 1);
				request.simOptions = { ...((request.simOptions as object | undefined) ?? {}), iterations: 1, debug: true };
				return new Promise<string>((resolve, reject) => {
					const id = this.nextId++;
					this.waiting.set(id, { resolve, reject });
					this.worker!.postMessage({ id, request: JSON.stringify(request) });
				}).then(json => readTimeline(json, isHealer(index.template)));
			});
			this.timelines.set(key, outcome);
			outcome.catch(() => this.timelines.delete(key));
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
				if (!healer || !countsMending(character, index.template.raid.parties[0].players[0].talentsString)) return simulated;
				// The engine cannot cast Prayer of Mending yet: its healing is worked out from the character's stats and added.
				const stats = ask({ stats: true, request: JSON.stringify({ raid: request.raid, encounter: request.encounter }) }).catch(() => null);
				return Promise.all([simulated, stats]).then(([outcome, statsJson]) => {
					const casting = castingShare(character);
					return withMending(outcome, readMending(statsJson, outcome.dps, casting), casting);
				});
			});
			this.cache.set(key, outcome);
			outcome.catch(() => this.cache.delete(key));
		}
		return outcome;
	}
}

export const simClient = new SimClient();
