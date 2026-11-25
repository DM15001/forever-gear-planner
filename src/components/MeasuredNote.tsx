import status from '../data/measurementStatus.json';

interface Part {
	at: string | null;
	current: boolean;
}
interface Status {
	simVersion: string | null;
	simDate: string | null;
	builds: Record<string, { effects: Part | null; weapons: Part | null; weights: Part | null } | undefined>;
}
const STATUS = status as unknown as Status;

const shortDate = (iso: string | null) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'never');

/** What the list numbers of a build rest on: when they were measured and whether that still fits today's simulator. */
export function measurementOf(specId: string) {
	const build = STATUS.builds[specId];
	const parts = (
		[
			['item effects and set bonuses', build?.effects],
			['weapons', build?.weapons],
			['stat weights', build?.weights],
		] as const
	).flatMap(([label, part]) => (part ? [{ label, ...part }] : []));
	return { parts, stale: parts.filter(part => !part.current), simVersion: STATUS.simVersion, simDate: STATUS.simDate };
}

/**
 * Says what the numbers in the lists are: estimates from the nightly measurement, with its date, and a warning
 * when that measurement was made on an older simulator, item data or preset than the site runs now.
 */
export function MeasuredNote({ specId }: { specId: string }) {
	const { parts, stale, simVersion, simDate } = measurementOf(specId);
	if (!parts.length) return null;
	const engine = simVersion ? `WoWSims ${simVersion}${simDate ? ` of ${shortDate(simDate)}` : ''}` : "today's WoWSims";
	if (!stale.length) {
		return (
			<p className="measured-note" role="note">
				<strong>List numbers are estimates</strong> from the nightly measurement ({shortDate(parts[0].at)}), made on the simulator this site runs now ({engine}). "Simulate" and "Sim this" run that simulator live.
			</p>
		);
	}
	return (
		<p className="measured-note measured-stale" role="note">
			<strong>List numbers are estimates and behind the simulator.</strong> {stale.map(part => `${part.label} (${shortDate(part.at)})`).join(', ')} {stale.length === 1 ? 'was' : 'were'} measured before a simulator or preset update that touches this build. The
			new measurement starts by itself and takes from a few minutes to a few hours. "Simulate" and "Sim this" always run today's simulator ({engine}): use them, or "Check the top with the simulator" on a slot, before you decide.
		</p>
	);
}
