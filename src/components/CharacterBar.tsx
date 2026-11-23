import { type ReactNode, useState } from 'react';

import type { Roster } from '../lib/roster';
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
export function CharacterBar({ roster, onSelect, onAdd, onRemove, aside }: { roster: Roster; onSelect: (index: number) => void; onAdd: () => void; /** Removes the active character. */ onRemove: () => void; /** Shown at the right end of the row. */ aside?: ReactNode }) {
	// Removing asks once more, on the tile itself.
	const [asking, setAsking] = useState(false);
	return (
		<div className="character-row">
		<nav className="character-bar" aria-label="Your characters">
			{roster.characters.map((character, index) => {
				const spec = specOf(character);
				const race = spec.races.find(r => r.id === character.race);
				const active = index === roster.active;
				return (
					<div key={index} className={`character-tile${active ? ' character-tile-on' : ''}${race ? ` character-tile-${race.faction}` : ''}`}>
						<button className="character-tile-pick" aria-current={active ? 'true' : undefined} onClick={() => { setAsking(false); onSelect(index); }}>
						<ClassIcon className={spec.className} />
						<span className="character-tile-text">
							<strong>{character.name ?? `${race?.name ?? 'Unnamed'} ${spec.className}`}</strong>
							<span>{spec.name}</span>
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
			<button className="character-tile character-add" onClick={onAdd}>
				<span className="character-add-plus" aria-hidden="true">
					+
				</span>
				<span className="character-tile-text">
					<strong>Add a character</strong>
					<span>Paste an export or load a preset</span>
				</span>
			</button>
		</nav>
		{aside && <div className="character-row-aside">{aside}</div>}
		</div>
	);
}
