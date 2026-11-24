import { sourceKind } from '../lib/farm';
import type { GameData } from '../lib/gameData';
import { sourceLine, wowheadSourceLink } from '../lib/stats';
import type { ItemSource } from '../lib/types';
import { SourceSymbol } from './Ornaments';

/** Where an item comes from, with the icon of that kind of source in front. */
/** A pre-filled issue on the project's page, for someone who knows where an item really comes from. */
const reportUrl = (item: { id: number; name: string }) =>
	`https://github.com/DM15001/forever-gear-planner/issues/new?title=${encodeURIComponent(`Source of ${item.name} (${item.id})`)}&body=${encodeURIComponent(
		`Item: ${item.name} (${item.id})\nhttps://www.wowhead.com/forever/item=${item.id}\n\nWhere it comes from (creature and zone, quest, vendor, craft):\n\nHow you know (you looted it, a link, a screenshot):\n`,
	)}`;

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
					<a className="source-report" href={reportUrl(item)} target="_blank" rel="noreferrer" onClick={event => event.stopPropagation()} title="Opens a short form on the project's GitHub page. It needs a GitHub account.">
						know where it drops?
					</a>
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
