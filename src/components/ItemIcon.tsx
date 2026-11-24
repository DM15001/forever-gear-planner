import { useState } from 'react';

/**
 * Where an icon can be loaded from, in order of preference. Blizzard's own image server comes
 * first; Wowhead's has a few icons Blizzard's lacks. Checked on 2026-11-22 against all 1,112
 * icon names in the item data: 19 missing at Blizzard, 11 at Wowhead.
 */
export const ICON_SOURCES = [(name: string) => `https://render.worldofwarcraft.com/eu/icons/56/${name}.jpg`, (name: string) => `https://wow.zamimg.com/images/wow/icons/large/${name}.jpg`];

interface Props {
	icon: string | undefined;
	quality: string | undefined;
	small?: boolean;
	/** A tiny icon that sits in a line of text. */
	inline?: boolean;
}

/** An item icon in a frame of the item's quality colour. The frame stays when no image loads. */
export function ItemIcon({ icon, quality, small = false, inline = false }: Props) {
	// Which source is being tried for which icon; a new icon starts again at the first source.
	const [attempt, setAttempt] = useState({ icon, index: 0 });
	const index = attempt.icon === icon ? attempt.index : 0;
	return (
		<span className={`slot-icon${small ? ' slot-icon-small' : ''}${inline ? ' slot-icon-inline' : ''} quality-border-${quality ?? 'none'}`} aria-hidden="true">
			{icon && index < ICON_SOURCES.length && <img src={ICON_SOURCES[index](icon)} alt="" loading="lazy" onError={() => setAttempt({ icon, index: index + 1 })} />}
		</span>
	);
}
