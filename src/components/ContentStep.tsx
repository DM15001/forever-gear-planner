import { useEffect, useRef } from 'react';
import { buildPlan } from '../lib/plan';
import type { GameData } from '../lib/gameData';
import type { SourceFilter } from '../lib/scoring';
import type { Character, SpecConfig } from '../lib/types';
import { ContentPicker } from './ContentPicker';

interface Props {
	spec: SpecConfig;
	character: Character;
	data: GameData;
	filter: SourceFilter;
	onFilterChange: (next: SourceFilter) => void;
	onChange: (next: Character) => void;
	/** While the simulator checks the plan the choice stays as it is. */
	locked: boolean;
}

/** The step before the plan: which content counts. A panel per kind, grey until it counts. */
export function ContentStep({ spec, character, data, filter, onFilterChange, onChange, locked }: Props) {
	// The plan is rebuilt once the new choice has arrived: rebuilding in the click would save the character as it
	// was before the change and undo it.
	const rebuildAfterChange = useRef(false);
	useEffect(() => {
		if (!rebuildAfterChange.current) return;
		rebuildAfterChange.current = false;
		onChange({ ...character, ...buildPlan({ character, data, spec, filter }) });
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [filter, data]);

	return (
		<div className="content-step" inert={locked}>
			<header className="content-step-head">
				<h2>What content do you do?</h2>
				<p className="hint">Pick every kind you play. Only items from lit panels go into your plan. Click a panel for the finer choice.</p>
			</header>
			<ContentPicker
				panels
				spec={spec}
				character={character}
				data={data}
				filter={filter}
				onChange={next => {
					rebuildAfterChange.current = true;
					onFilterChange(next);
				}}
			/>
		</div>
	);
}
