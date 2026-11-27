/**
 * An item's tooltip belongs to its name, which is a Wowhead link. Hovering the item's picture should show the same
 * tooltip, anywhere on the site: the pointer is passed on to the link the picture stands for, which is the first
 * item or spell link after it in the same row.
 */
const LINKS = 'a[data-wowhead], a[href*="wowhead.com"]';

function linkFor(icon: Element): HTMLAnchorElement | null {
	// A picture inside a link is that link's own business.
	if (icon.closest('a')) return null;
	let box: Element | null = icon.parentElement;
	for (let up = 0; box && up < 5; up++, box = box.parentElement) {
		for (const link of box.querySelectorAll<HTMLAnchorElement>(LINKS)) {
			if (icon.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING) return link;
		}
		// Not past the row the picture is in: beyond it the next link is another item's.
		if (box.matches('li, section, header, .planned-pick, .slot, .plan-row')) break;
	}
	return null;
}

export function relayIconHover(): void {
	let shown: HTMLAnchorElement | null = null;
	const pass = (type: 'mouseover' | 'mouseout', link: HTMLAnchorElement, from: MouseEvent) => link.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: from.clientX, clientY: from.clientY }));
	document.addEventListener('mouseover', event => {
		if (!event.isTrusted) return;
		const icon = (event.target as Element | null)?.closest?.('.slot-icon');
		const link = icon ? linkFor(icon) : null;
		if (link === shown) return;
		if (shown) pass('mouseout', shown, event);
		shown = link;
		if (link) pass('mouseover', link, event);
	});
}
