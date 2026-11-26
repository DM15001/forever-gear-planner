import { sourceKind } from '../lib/farm';
import type { GameData } from '../lib/gameData';
import { sourceLine, wowheadSourceLink } from '../lib/stats';
import type { ItemSource } from '../lib/types';
import { SourceSymbol } from './Ornaments';
import { reportSource } from './ReportSource';

/**
 * Where an item comes from, with the icon of that kind of source in front. With `item`, a source that is missing
 * or only guessed gets a link to report the real one.
 */
export function SourceLabel({ source, data, item }: { source: ItemSource | undefined; data: GameData; item?: { id: number; name: string } }) {
	const link = wowheadSourceLink(source);
	const text = sourceLine(source, data);
	return (
		<span className="source-label">
			<SourceSymbol kind={sourceKind(source)} />{' '}
			{link ? (
				<a className="source-link" href={link.url} data-wowhead={link.tooltip} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()}>
					{text}
				</a>
			) : (
				text
			)}
			{item && (!source || source.assumed || source.kind === 'unknown') && (
				<>
					{' '}
					<button
						type="button"
						className="link source-report"
						onClick={event => {
							event.stopPropagation();
							reportSource(item);
						}}
						title="Tell us where this item really comes from. No account needed.">
						know where it drops?
					</button>
				</>
			)}
			{source?.assumed && (
				<span className="source-assumed" title="The data names no source for this item. It is an item of the original game that is not from a boss, quest, vendor or craft, so it is taken as a random bind-on-equip drop: look for it in the auction house.">
					{' '}
					(assumed)
				</span>
			)}
		</span>
	);
}

/** Up to two sources, joined by "or". */
export function SourceList({ sources, data, item }: { sources: ItemSource[]; data: GameData; item?: { id: number; name: string } }) {
	if (sources.length === 0) return <SourceLabel source={undefined} data={data} item={item} />;
	return (
		<>
			{sources.slice(0, 2).map((source, index) => (
				<span key={index}>
					{index > 0 && ' or '}
					<SourceLabel source={source} data={data} item={index === 0 ? item : undefined} />
				</span>
			))}
		</>
	);
}
