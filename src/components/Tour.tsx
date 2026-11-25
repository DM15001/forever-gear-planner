import { useCallback, useEffect, useLayoutEffect, useState } from 'react';

const TOUR_KEY = 'fgp.tour';

interface TourStep {
	/** What the step points at; without one the bubble sits in the middle of the page. */
	target?: string;
	title: string;
	text: string;
	/** Shown only once a character is open (the sections do not exist before). */
	needsCharacter?: boolean;
}

const STEPS: TourStep[] = [
	{ title: 'Welcome to the Forever Gear Planner', text: 'It tells you which gear to get before raids, where it drops and what it is worth, with the real WoWSims simulator. This tour takes a minute.' },
	{ target: '.guide-steps', title: 'Three steps', text: 'Your character, your plan, where to farm. That order is all most people need.' },
	{ target: '.import', title: 'Bring your character', text: 'Install the WoWSims Exporter addon, type /wse in the game and paste the text here. A JSON export from wowsims.com works too.' },
	{ target: '.start-example', title: 'Or just try it', text: 'No export at hand? Pick a build and load its preset to look around. The tour goes on once a character is open.' },
	{ target: '.tabs', title: 'The pages', text: 'Numbered in the order you use them. The ones without a number are for when you want more: single slots, enchants, a group.', needsCharacter: true },
	{ target: '.character-bar', title: 'Your characters', text: 'Every character you add is saved in this browser. Click one to switch, the plus adds another.', needsCharacter: true },
	{ target: '.guide-step:nth-child(2)', title: 'Next: your plan', text: 'Say what content you do (dungeons, reputations, crafting, PvP) and the planner picks the best set for it, with a to-do list.', needsCharacter: true },
	{ target: '.guide-step:nth-child(3)', title: 'Then: where to farm', text: 'Your plan sorted by dungeon, with drop chances and how many runs to expect.', needsCharacter: true },
	{ target: '.masthead-tools', title: 'Settings and help', text: 'Sim setup changes buffs, consumables and rotation. News has game and site changes. The FAQ explains every number. Themes changes the look.', needsCharacter: true },
];

const stored = () => {
	try {
		return localStorage.getItem(TOUR_KEY);
	} catch {
		return null;
	}
};

/** Starts the tour again, from anywhere on the page. */
export function restartTour() {
	try {
		localStorage.removeItem(TOUR_KEY);
	} catch {
		/* private mode */
	}
	window.dispatchEvent(new Event('fgp-tour'));
}

/**
 * A short tour on the first visit: one bubble after the other, each pointing at the real thing on the page.
 * The first part runs on the start page; the second begins when the first character is open.
 */
export function Tour({ hasCharacter, onPage }: { hasCharacter: boolean; onPage: boolean }) {
	const [index, setIndex] = useState<number | null>(() => (stored() ? null : 0));
	const [never, setNever] = useState(false);
	const [box, setBox] = useState<DOMRect | null>(null);

	useEffect(() => {
		const again = () => {
			setNever(false);
			setIndex(0);
		};
		window.addEventListener('fgp-tour', again);
		return () => window.removeEventListener('fgp-tour', again);
	}, []);

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

	const close = (finished: boolean) => {
		// Ticked, or seen to the end: it stays away. Closed early without the tick: it comes back on the next visit.
		if (never || finished) {
			try {
				localStorage.setItem(TOUR_KEY, 'off');
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
	const below = box ? box.bottom + 190 < window.innerHeight || box.top < 200 : false;
	const style = box
		? { left: Math.max(12, Math.min(box.left, window.innerWidth - 372)), ...(below ? { top: Math.min(box.bottom + pad + 10, window.innerHeight - 200) } : { bottom: window.innerHeight - box.top + pad + 10 }) }
		: undefined;

	return (
		<div className="tour" role="dialog" aria-modal="false" aria-labelledby="tour-title">
			{box ? <div className="tour-spot" style={{ left: box.left - pad, top: box.top - pad, width: box.width + pad * 2, height: box.height + pad * 2 }} /> : <div className="tour-veil" />}
			<div className={box ? 'tour-bubble' : 'tour-bubble tour-bubble-middle'} style={style}>
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
						<button className="button button-small" onClick={() => close(false)}>
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
							<button className="button button-small button-primary" onClick={() => close(true)}>
								Done
							</button>
						)}
					</span>
				</div>
			</div>
		</div>
	);
}
