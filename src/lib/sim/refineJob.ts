import { useSyncExternalStore } from 'react';

import { unit } from '../format';
import type { CandidateOptions } from '../scoring';
import { simClient } from './client';
import { refinePlan } from './live';

/**
 * The simulator check of a plan as a job that outlives the page it was started on: it keeps running while the
 * visitor looks at another tab, and the app, not the tab, takes its result. One job at a time.
 */
export interface RefineJobState {
	running: boolean;
	/** Where the check is, in words. */
	label: string | null;
	done: number;
	total: number;
	/** What the last check found, or why it failed. */
	note: string | null;
	/** A finished plan the app has not taken yet. */
	result: { plan: Record<number, number>; planEnchants: Record<number, number> } | null;
	/** The worn gear and plan the last check left: until either changes, the plan counts as checked. */
	checkedKey: string | null;
}

let state: RefineJobState = { running: false, label: null, done: 0, total: 1, note: null, result: null, checkedKey: null };
const listeners = new Set<() => void>();
let stopAsked = false;
const set = (patch: Partial<RefineJobState>) => {
	state = { ...state, ...patch };
	for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
	listeners.add(listener);
	return () => listeners.delete(listener);
};

export const planKeyOf = (character: CandidateOptions['character'], plan = character.plan ?? {}, planEnchants = character.planEnchants ?? {}) =>
	JSON.stringify([character.gear.map(piece => piece?.id ?? 0), plan, planEnchants]);

export const refineJob = {
	get: () => state,
	stop: () => {
		stopAsked = true;
	},
	/** The app took the result and wrote it into the character. */
	taken: () => set({ result: null }),
	async start(options: CandidateOptions, depth: number) {
		if (state.running) return;
		stopAsked = false;
		set({ running: true, note: null, result: null, label: 'Starting the simulator…', done: 0, total: 1 });
		try {
			const result = await refinePlan(
				options,
				simClient,
				p => set({ done: p.done, total: p.total, label: `${p.slot}, step ${p.done + 1} of ${p.total} (${p.dps.toFixed(0)} ${unit()} so far)` }),
				() => stopAsked,
				depth,
			);
			const kept = Object.keys(result.plan).length + Object.keys(result.planEnchants).length === 0;
			const second = result.runnerUp
				? result.runnerUp.equal
					? ` Next best: ${result.runnerUp.label} at ${result.runnerUp.dps.toFixed(0)} ${unit()}. The two are equal within the margin: take whichever is easier to get.`
					: ` Next best: ${result.runnerUp.label} at ${result.runnerUp.dps.toFixed(0)} ${unit()}.`
				: '';
			set({
				result: { plan: result.plan, planEnchants: result.planEnchants },
				// The plan as the check left it counts as checked; any later change asks for it again.
				checkedKey: planKeyOf(options.character, result.plan, result.planEnchants),
				note:
					(kept && result.changes > 0
						? `The simulator found nothing better than what you wear (${result.after.toFixed(0)} ${unit()}; the plan came to ${result.before.toFixed(0)}). The plan is empty now.`
						: result.changes === 0
							? `The simulator agrees with the plan (${result.after.toFixed(0)} ${unit()}): no other start, item, enchant or pair it tried does better.`
							: `The simulator changed the plan in ${result.changes} ${result.changes === 1 ? 'place' : 'places'}: ${result.before.toFixed(0)} to ${result.after.toFixed(0)} ${unit()}${result.startedFrom === 'the plan' ? '' : `, starting from ${result.startedFrom}`}.`) + second,
			});
		} catch (err) {
			set({ note: `The check failed: ${err instanceof Error ? err.message : 'the simulator did not answer'}` });
		} finally {
			set({ running: false, label: null });
		}
	},
};

export const useRefineJob = () => useSyncExternalStore(subscribe, refineJob.get);
