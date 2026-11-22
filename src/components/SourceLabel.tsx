import { sourceKind } from '../lib/farm';
import type { GameData } from '../lib/gameData';
import { sourceLine } from '../lib/stats';
import type { ItemSource } from '../lib/types';
import { SourceSymbol } from './Ornaments';

/** Where an item comes from, with the icon of that kind of source in front. */
export function SourceLabel({ source, data }: { source: ItemSource | undefined; data: GameData }) {
	return (
		<span className="source-label">
			<SourceSymbol kind={sourceKind(source)} /> {sourceLine(source, data)}
		</span>
	);
}

/** Up to two sources, joined by "or". */
export function SourceList({ sources, data }: { sources: ItemSource[]; data: GameData }) {
	if (sources.length === 0) return <SourceLabel source={undefined} data={data} />;
	return (
		<>
			{sources.slice(0, 2).map((source, index) => (
				<span key={index}>
					{index > 0 && ' or '}
					<SourceLabel source={source} data={data} />
				</span>
			))}
		</>
	);
}
