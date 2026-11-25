let current = 'DPS';

/** What the numbers on the page are: damage per second, or healing per second for a healer. */
export const unit = () => current;
/** Set by the app whenever the planned spec changes. */
export const setUnit = (next: 'DPS' | 'HPS') => {
	current = next;
};

/**
 * A gain or loss in estimated DPS (or HPS): "+12.4 DPS", "−3.0 DPS", "+152 DPS". These come from
 * stat weights, not from a simulator run; the pages say so where the numbers appear.
 */
export function formatDps(value: number): string {
	const size = Math.abs(value);
	const text = size >= 20 ? Math.round(size).toLocaleString('en') : size.toFixed(1);
	return `${value >= 0 ? '+' : '−'}${text} ${current}`;
}

/** "2nd", "3rd", "11th": a place in a ranking. */
export function ordinal(n: number): string {
	const tens = n % 100;
	const suffix = tens >= 11 && tens <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
	return `${n}${suffix}`;
}
