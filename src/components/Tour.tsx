import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// "2": the first version also stayed away after "Done"; this one only after the tick, so everybody sees it once more.
const keyOf = (id: TourId) => (id === 'main' ? 'fgp.tour2' : `fgp.tour2.${id}`);
export type TourId = 'main' | 'group';

interface TourStep {
	/** What the step points at; without one the bubble sits in the middle of the page. */
	target?: string;
	title: string;
	text: string;
	/** Shown only once a character is open (the sections do not exist before). */
	needsCharacter?: boolean;
}

const MAIN_STEPS: TourStep[] = [
	{ title: 'Welcome to the Forever Gear Planner', text: 'It tells you which gear to get before raids, where it drops and what it is worth, with the real WoWSims simulator. This tour takes a minute.' },
	{ target: '.import', title: 'Bring your character', text: 'Install the WoWSims Exporter addon, type /wse in the game and paste the text here. A JSON export from wowsims.com works too.' },
	{ target: '.start-example', title: 'Or just try it', text: 'No export at hand? Pick a build and load its preset to look around. The tour goes on once a character is open.' },
	{ target: '.tabs', title: 'The pages', text: 'From left to right: check your gear, build a plan, change single slots if you like, farm it. Group up is for playing with friends.', needsCharacter: true },
	{ target: '.character-bar', title: 'Your characters', text: 'Every character you add is saved in this browser. Click one to switch, the plus adds another.', needsCharacter: true },
	{ target: '.tab[data-tab="simulate"]', title: 'Build plan', text: 'Say what content you do (dungeons, reputations, crafting, PvP) and the planner picks the best set for it, with a to-do list.', needsCharacter: true },
	{ target: '.tab[data-tab="upgrades"]', title: 'Customize', text: 'Every slot with its better items, to pick single ones yourself. What you pick here overrides the plan.', needsCharacter: true },
	{ target: '.tab[data-tab="farm"]', title: 'Farm it', text: 'Your plan sorted by dungeon, with drop chances and how many runs to expect. "Group up" does the same for several characters.', needsCharacter: true },
	{ target: '.masthead-tools', title: 'News, help and look', text: 'News has game and site changes. The FAQ explains every number. "Take the tour" at the very bottom of the page starts this again.', needsCharacter: true },
];

const GROUP_STEPS: TourStep[] = [
	{ title: 'Farm as a group', text: 'This page adds up what several characters need and shows which dungeons help the group most. Four things to know.' },
	{ target: '.group-add', title: 'Bring your friends in', text: 'Each friend presses "Copy character" on their side and sends you the text; paste it here. A group link adds everybody at once, and "Share the whole group" makes one.' },
	{ target: '.group-members', title: 'Who is in', text: 'Every character saved in this browser can take part. Untick the ones who are not coming along.' },
	{ target: '.group-switches', title: 'What counts and how it looks', text: '"Planned items only" counts what each one has in their plan, "Every upgrade" anything better than what they wear. Sort by gain or by people, as cards or as a list.' },
	{ target: '.group-dungeon', title: 'The dungeons', text: 'Best for the group first. Each one shows the drops, who needs them and the gain. Click it for the bosses, and "Got it" when someone has their item.' },
];
/** On trial on Dev: the pages in their new order (content first, Customize before the simulator check), and the tour with them. */
const IS_DEV = import.meta.env.VITE_CHANNEL === 'dev';
const DEV_MAIN_STEPS: TourStep[] = [
	...MAIN_STEPS.slice(0, 3),
	{ target: '.tabs', title: 'The pages', text: 'From left to right: check your gear, say what content you do, change single slots if you like, check the plan with the simulator, farm it. Group up is for playing with friends.', needsCharacter: true },
	MAIN_STEPS[4],
	{ target: '.tab[data-tab="character"]', title: 'Check gear', text: 'What you wear now, slot by slot. Click an icon to change an item, hover it for its stats. Set race, professions and talents here.', needsCharacter: true },
	{ target: '.tab[data-tab="content"]', title: 'Content Selection', text: 'One list to go through: dungeons, reputations, sets, PvP, quests, crafting. Switch on what you play. The plan is built from that and rebuilt on every change.', needsCharacter: true },
	{ target: '.tab[data-tab="upgrades"]', title: 'Customize', text: 'Optional. Every slot with its better items, to pick single ones yourself. What you pick is locked, so the simulator check works around it.', needsCharacter: true },
	{ target: '.tab[data-tab="simulate"]', title: 'Build plan', text: 'Your planned gear with enchants in one place. "Check the plan with the simulator" tests it with real simulations and swaps in whatever is really better.', needsCharacter: true },
	{ target: '.tab[data-tab="farm"]', title: 'Farm it', text: 'How to get your plan: sorted by dungeon, with drop chances and how many runs to expect. Press "Got it" when an item drops. "Group up" does the same for several characters.', needsCharacter: true },
	MAIN_STEPS[8],
];
const DEV_GROUP_STEPS: TourStep[] = [
	GROUP_STEPS[0],
	{ target: '.group-add', title: 'Bring your friends in', text: 'Each friend presses "Copy character link" under "Check gear" and sends you the text; paste it here. A group link adds everybody at once, and "Share the whole group" makes one.' },
	{ target: '.group-members', title: 'Who is in', text: 'Your own characters and your friends, in two lists. Friends stay on this page only and get no tile among your characters. Untick the ones who are not coming along.' },
	{ target: '.group-switches', title: 'What counts and how it looks', text: '"Planned items only" counts what each one has in their plan, "Every upgrade" anything better than what they wear. Sort by gain or by people, as cards or as a list.' },
	{ target: '.group-dungeon', title: 'The dungeons', text: 'Best for the group first. "Who wants what" opens a table below the card: every drop, who needs it and the gain. Press "Got it" when someone has their item.' },
];
const TOURS: Record<TourId, TourStep[]> = IS_DEV ? { main: DEV_MAIN_STEPS, group: DEV_GROUP_STEPS } : { main: MAIN_STEPS, group: GROUP_STEPS };

const stored = (id: TourId) => {
	try {
		return localStorage.getItem(keyOf(id));
	} catch {
		return null;
	}
};

/** Starts a tour again, from anywhere on the page. */
export function restartTour(id: TourId = 'main') {
	try {
		localStorage.removeItem(keyOf(id));
	} catch {
		/* private mode */
	}
	window.dispatchEvent(new CustomEvent('fgp-tour', { detail: id }));
}

/**
 * A short tour on the first visit: one bubble after the other, each pointing at the real thing on the page.
 * The first part runs on the start page; the second begins when the first character is open.
 */
export function Tour({ id = 'main', hasCharacter, onPage }: { id?: TourId; hasCharacter: boolean; onPage: boolean }) {
	const STEPS = TOURS[id];
	const [index, setIndex] = useState<number | null>(() => (stored(id) ? null : 0));
	const [never, setNever] = useState(false);
	const [box, setBox] = useState<DOMRect | null>(null);
	// The bubble's own height, measured, so it can be placed where it fits.
	const [size, setSize] = useState<number | null>(null);
	const bubble = useRef<HTMLDivElement>(null);
	useLayoutEffect(() => {
		const height = bubble.current?.offsetHeight;
		if (height && height !== size) setSize(height);
	});

	useEffect(() => {
		const again = (event: Event) => {
			if ((event as CustomEvent<TourId>).detail !== id) return;
			setNever(false);
			setIndex(0);
		};
		window.addEventListener('fgp-tour', again);
		return () => window.removeEventListener('fgp-tour', again);
	}, [id]);

	// The steps that can be shown right now: those whose thing is on the page.
	const usable = useCallback((step: TourStep) => (!step.needsCharacter || hasCharacter) && (!step.target || document.querySelector(step.target) !== null), [hasCharacter]);
	// Skips ahead over what is not there; waits (shows nothing) when the rest needs a character that is not open yet.
	const current = index === null || !onPage ? null : (STEPS.slice(index).find(usable) ?? null);
	const at = current ? STEPS.indexOf(current) : -1;

	useLayoutEffect(() => {
		if (!current?.target) {
			setBox(null);
			return;
		}
		const element = document.querySelector(current.target);
		if (!element) return;
		element.scrollIntoView({ block: 'center', behavior: 'auto' });
		const measure = () => setBox(element.getBoundingClientRect());
		measure();
		window.addEventListener('resize', measure);
		window.addEventListener('scroll', measure, true);
		return () => {
			window.removeEventListener('resize', measure);
			window.removeEventListener('scroll', measure, true);
		};
	}, [current]);

	if (!current) return null;

	const close = () => {
		// Only the tick keeps it away: without it the tour opens again on the next visit, also after "Done".
		if (never) {
			try {
				localStorage.setItem(keyOf(id), 'off');
			} catch {
				/* private mode: gone for this visit */
			}
		}
		setIndex(null);
	};
	const later = STEPS.slice(at + 1);
	const next = later.find(usable);
	// The first part ends on the start page; the rest waits for a character.
	const waits = !next && later.some(step => step.needsCharacter) && !hasCharacter;
	const shown = STEPS.filter(usable);
	const pad = 6;
	const gap = pad + 12;
	// Where the bubble goes: under the thing, over it, beside it, whichever has the room; else the corner of the window.
	const [width, height] = [Math.min(360, window.innerWidth - 24), size ?? 240];
	const across = box ? Math.max(12, Math.min(box.left, window.innerWidth - width - 12)) : 0;
	const along = box ? Math.max(12, Math.min(box.top, window.innerHeight - height - 12)) : 0;
	const style = !box
		? undefined
		: box.bottom + gap + height <= window.innerHeight
			? { left: across, top: box.bottom + gap }
			: box.top - gap - height >= 0
				? { left: across, top: box.top - gap - height }
				: box.right + gap + width <= window.innerWidth
					? { left: box.right + gap, top: along }
					: box.left - gap - width >= 0
						? { left: box.left - gap - width, top: along }
						: { right: 16, bottom: 16 };

	return (
		<div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
			{box ? <div className="tour-spot" style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} /> : <div className="tour-veil" />}
			<div ref={bubble} className={box ? 'tour-bubble' : 'tour-bubble tour-bubble-middle'} style={style}>
				<p className="tour-count">
					{shown.indexOf(current) + 1} of {shown.length}
					{waits ? ', more once a character is open' : ''}
				</p>
				<h2 id="tour-title">{current.title}</h2>
				<p>{current.text}</p>
				<div className="tour-actions">
					<label className="tour-never">
						<input type="checkbox" checked={never} onChange={event => setNever(event.target.checked)} /> Don't show this again
					</label>
					<span className="tour-buttons">
						<button className="button button-small" onClick={close}>
							Close
						</button>
						{next ? (
							<button className="button button-small button-primary" onClick={() => setIndex(STEPS.indexOf(next))}>
								Next
							</button>
						) : waits ? (
							<button className="button button-small button-primary" onClick={() => setIndex(STEPS.findIndex(step => step.needsCharacter))}>
								Got it
							</button>
						) : (
							<button className="button button-small button-primary" onClick={close}>
								Done
							</button>
						)}
					</span>
				</div>
			</div>
		</div>
	);
}
