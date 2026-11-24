import { useState } from 'react';

import { ICON_SOURCES } from './ItemIcon';

/** The game's own class icon, loaded like the item icons. Nothing is shown if it cannot be loaded. */
export function ClassIcon({ className, small = false }: { className: string; small?: boolean }) {
	const [attempt, setAttempt] = useState(0);
	if (attempt >= ICON_SOURCES.length) return null;
	return <img className={small ? 'class-icon class-icon-small' : 'class-icon'} src={ICON_SOURCES[attempt](`classicon_${className.toLowerCase()}`)} alt={`${className} class icon`} loading="lazy" onError={() => setAttempt(attempt + 1)} />;
}
