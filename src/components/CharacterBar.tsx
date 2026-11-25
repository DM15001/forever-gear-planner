import { type ReactNode, useState } from 'react';

import { type Roster, tileIndexes } from '../lib/roster';
import { specOf } from '../lib/specs';
import { ClassIcon } from './ClassIcon';
import { RaceIcon } from './IconTile';
import { ICON_SOURCES } from './ItemIcon';

/** The game's battleground banners stand for the two factions. */
const FACTION_ICON = { alliance: 'inv_bannerpvp_02', horde: 'inv_bannerpvp_01' };

export function FactionMark({ faction }: { faction: 'alliance' | 'horde' }) {
	const [attempt, setAttempt] = useState(0);
	return (
		<span className={`faction faction-${faction}`}>
			{attempt < ICON_SOURCES.length && <img src={ICON_SOURCES[attempt](FACTION_ICON[faction])} alt="" loading="lazy" onError={() => setAttempt(attempt + 1)} />}
			{faction === 'alliance' ? 'Alliance' : 'Horde'}
		</span>
	);
}

/** Every saved character as a tile: class icon, name, build, race and faction. A click switches to it. */
export function CharacterBar({ roster, onSelect, onAdd, onRemove, aside }: { roster: Roster; onSelect: (index: number) => void; /** Left out on the start page, where the import form is right below. */ onAdd?: () => void; /** Removes the active character. */ onRemove: () => void; /** Shown at the right end of the row. */ aside?: ReactNode }) {
	// Removing asks once more, on the tile itself.
	const [asking, setAsking] = useState(false);
	return (
		<div className="character-row">
		<nav className="character-bar" aria-label="Your characters">
			{tileIndexes(roster).map(index => {
				const character = roster.characters[index];
				const spec = specOf(character);
				const sets = character.group ? roster.characters.filter(c => c.group === character.group).length : 1;
				const race = spec.races.find(r => r.id === character.race);
				const active = index === roster.active;
				return (
					<div key={index} className={`character-tile${active ? ' character-tile-on' : ''}${race ? ` character-tile-${race.faction}` : ''}`}>
						<button className="character-tile-pick" aria-current={active ? 'true' : undefined} onClick={() => { setAsking(false); onSelect(index); }}>
						<ClassIcon className={spec.className} />
						<span className="character-tile-text">
							<strong>
								{character.name ?? `${race?.name ?? 'Unnamed'} ${spec.className}`}
								{sets > 1 && <span className="set-chip" title={`${sets} gear sets; switch under "Check gear"`}>{character.set ?? 'Main'}</span>}
							</strong>
							<span className="character-tile-spec">{spec.name}</span>
							<span className="character-tile-meta">
								{race && <RaceIcon name={race.name} />}
								{race ? race.name : 'Race not set'}
								{character.level ? `, level ${character.level}` : ''}
								{race && <FactionMark faction={race.faction} />}
							</span>
						</span>
						</button>
						{active &&
							(asking ? (
								<span className="character-tile-ask">
									Remove?
									<button className="link link-danger" onClick={() => { setAsking(false); onRemove(); }}>
										Yes
									</button>
									<button className="link" onClick={() => setAsking(false)}>
										No
									</button>
								</span>
							) : (
								<button className="character-tile-remove" onClick={() => setAsking(true)} title="Remove this character from this browser" aria-label={`Remove ${character.name ?? 'this character'}`}>
									×
								</button>
							))}
					</div>
				);
			})}
{onAdd && (
				<button className="character-add" onClick={onAdd} title="Add a character: paste an export or load a preset" aria-label="Add a character">
					<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
						<path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" fill="none" />
					</svg>
				</button>
			)}
		</nav>
		{aside && <div className="character-row-aside">{aside}</div>}
		</div>
	);
}
