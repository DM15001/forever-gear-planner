import type { Item } from '../lib/types';

/** " of Shadow Wrath" for an item that is planned with a random suffix, else nothing. */
export const suffixText = (item: Item) => (item.bestSuffix && item.bestSuffixName ? ` ${item.bestSuffixName}` : '');

/** Marks an item whose worth depends on a random roll. */
export function SuffixNote({ item }: { item: Item }) {
	if (!item.bestSuffix) return null;
	const count = item.randomSuffixOptions?.length ?? 0;
	return (
		<span className="badge badge-roll" title={`This item drops with one of ${count} random suffixes. Only "${item.bestSuffixName}", the best one for this build, is counted, so it can take many drops to get.`}>
			random roll, 1 of {count}
		</span>
	);
}
