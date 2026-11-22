/**
 * A gain or loss in estimated DPS: "+12.4 DPS", "−3.0 DPS", "+152 DPS". These come from stat
 * weights, not from a simulator run; the pages say so where the numbers appear.
 */
export function formatDps(value: number): string {
	const size = Math.abs(value);
	const text = size >= 20 ? Math.round(size).toLocaleString('en') : size.toFixed(1);
	return `${value >= 0 ? '+' : '−'}${text} DPS`;
}
