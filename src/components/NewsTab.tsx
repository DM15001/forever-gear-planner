import { useEffect, useMemo, useState } from 'react';

interface NewsItem {
	title: string;
	text: string;
	url?: string;
	source?: string;
	tags?: string[];
}
interface NewsEntry {
	date: string;
	summary?: string;
	sections: { title: string; items: NewsItem[] }[];
}

/** One file per month, loaded when it is needed: the newest for the feed, the rest when someone opens or searches them. */
const FILES = import.meta.glob<{ default: { entries: NewsEntry[] } }>('../data/news/*.json');
const MONTHS = Object.keys(FILES)
	.map(path => path.match(/(\d{4}-\d{2})\.json$/)?.[1])
	.filter((month): month is string => !!month)
	.sort()
	.reverse();
const loadMonth = (month: string) => FILES[`../data/news/${month}.json`]().then(file => file.default.entries);

const SEEN_KEY = 'forever-gear-planner.news-seen';
/** How many of the newest days are shown open; older ones fold by month. */
const OPEN_DAYS = 7;
/** The tags an item can carry, in the order the filter shows them. */
const CLASS_TAGS = ['Druid', 'Hunter', 'Mage', 'Paladin', 'Priest', 'Rogue', 'Shaman', 'Warlock', 'Warrior'];
const TOPIC_TAGS = ['Items', 'Dungeons', 'Quests', 'Professions', 'PvP', 'World', 'Races', 'Upcoming', 'WoWSims'];

/** True when the newest day in the news has not been opened in this browser yet. */
export async function newsUnseen(): Promise<boolean> {
	try {
		if (!MONTHS.length) return false;
		const latest = (await loadMonth(MONTHS[0]))[0]?.date;
		return !!latest && localStorage.getItem(SEEN_KEY) !== latest;
	} catch {
		return false;
	}
}

const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const monthName = (month: string) => new Date(`${month}-15T12:00:00Z`).toLocaleDateString('en', { month: 'long', year: 'numeric', timeZone: 'UTC' });

function Day({ entry, keep }: { entry: NewsEntry; keep: (item: NewsItem) => boolean }) {
	const sections = entry.sections.map(section => ({ ...section, items: section.items.filter(keep) })).filter(section => section.items.length > 0);
	return (
		<article className="card news-day">
			<h3>{longDate(entry.date)}</h3>
			{entry.summary && <p className="news-summary">{entry.summary}</p>}
			{sections.map(section => (
				<div key={section.title} className="news-section">
					<h4>{section.title}</h4>
					<ul className="plain-list">
						{section.items.map((item, index) => (
							<li key={index} className="news-item">
								<strong>{item.title}</strong>
								<span>{item.text}</span>
								<span className="news-foot">
									{item.url && (
										<a href={item.url} target="_blank" rel="noreferrer">
											{item.source ?? 'Source'}
										</a>
									)}
									{item.tags?.map(tag => (
										<span key={tag} className="news-tag">
											{tag}
										</span>
									))}
								</span>
							</li>
						))}
					</ul>
				</div>
			))}
		</article>
	);
}

/**
 * What changed in the game and in the WoWSims simulator, day by day, and kept for good: the
 * newest days open, older ones by month, all of it filterable by class or topic and searchable.
 */
export function NewsTab({ myClass, onSeen }: { myClass?: string; onSeen: () => void }) {
	const [loaded, setLoaded] = useState<Record<string, NewsEntry[]>>({});
	const [tag, setTag] = useState<string | null>(null);
	const [query, setQuery] = useState('');
	const [opened, setOpened] = useState<Set<string>>(new Set());
	const mine = myClass ? CLASS_TAGS.find(name => name.toLowerCase() === myClass.toLowerCase()) : undefined;
	const narrowed = tag !== null || query.trim() !== '';

	const need = (months: string[]) => {
		for (const month of months) {
			if (loaded[month]) continue;
			void loadMonth(month).then(entries => setLoaded(old => ({ ...old, [month]: entries })));
		}
	};
	// The newest month first (and the one before, so the open days are there early in a month); everything for a filter or search.
	useEffect(() => need(narrowed ? MONTHS : MONTHS.slice(0, 2)), [narrowed]); // eslint-disable-line react-hooks/exhaustive-deps

	const latest = MONTHS[0] ? loaded[MONTHS[0]]?.[0]?.date : undefined;
	useEffect(() => {
		if (!latest) return;
		try {
			localStorage.setItem(SEEN_KEY, latest);
		} catch {
			// Storage can be unavailable; the "new" mark then simply stays.
		}
		onSeen();
	}, [latest, onSeen]);

	const words = query.trim().toLowerCase();
	const keep = useMemo(
		() => (item: NewsItem) => (tag === null || item.tags?.includes(tag) === true) && (words === '' || `${item.title} ${item.text} ${item.tags?.join(' ') ?? ''}`.toLowerCase().includes(words)),
		[tag, words],
	);
	const hasItems = (entry: NewsEntry) => entry.sections.some(section => section.items.some(keep));
	const all = MONTHS.flatMap(month => loaded[month] ?? []);
	const recent = all.slice(0, OPEN_DAYS);
	const recentDates = new Set(recent.map(entry => entry.date));
	const matches = narrowed ? all.filter(hasItems) : [];
	const waiting = MONTHS.some(month => !loaded[month]);

	const chip = (value: string | null, label: string) => (
		<button key={label} className="chip" aria-pressed={tag === value} onClick={() => setTag(tag === value ? null : value)}>
			{label}
		</button>
	);

	return (
		<section className="panel news">
			<h2>News and changelog</h2>
			<p className="hint">Once a day: what changed in WoW Forever (hotfixes, patch notes, fixed quests, announcements) and in the WoWSims simulator. Nothing is removed, so this is also the record of when something changed. Each item links to where it comes from.</p>

			<div className="news-filter">
				<input type="search" placeholder="Search: a spell, an item, a quest ..." aria-label="Search the news" value={query} onChange={event => setQuery(event.target.value)} />
				<div className="filter-chips" role="group" aria-label="Show only">
					{chip(null, 'Everything')}
					{mine && chip(mine, `My class: ${mine}`)}
					{CLASS_TAGS.filter(name => name !== mine).map(name => chip(name, name))}
				</div>
				<div className="filter-chips" role="group" aria-label="Show only a topic">
					{TOPIC_TAGS.map(name => chip(name, name))}
				</div>
			</div>

			{MONTHS.length === 0 && <p>Nothing yet. The first entry comes with the next daily run.</p>}

			{narrowed ? (
				<>
					<p className="hint">
						{waiting ? 'Loading older months ... ' : ''}
						{matches.reduce((count, entry) => count + entry.sections.reduce((n, section) => n + section.items.filter(keep).length, 0), 0)} items on {matches.length} days
						{tag ? `, tagged ${tag}` : ''}
						{words ? `, with "${query.trim()}"` : ''}.
					</p>
					{matches.map(entry => (
						<Day key={entry.date} entry={entry} keep={keep} />
					))}
					{!waiting && matches.length === 0 && <p>Nothing found. Try another word or take the filter off.</p>}
				</>
			) : (
				<>
					{recent.map(entry => (
						<Day key={entry.date} entry={entry} keep={keep} />
					))}
					{MONTHS.map(month => {
						const entries = loaded[month];
						const older = entries?.filter(entry => !recentDates.has(entry.date));
						if (entries && older!.length === 0) return null;
						const open = opened.has(month);
						return (
							<details
								key={month}
								className="fold news-month"
								open={open}
								onToggle={event => {
									const isOpen = (event.target as HTMLDetailsElement).open;
									if (isOpen) need([month]);
									setOpened(old => {
										const next = new Set(old);
										if (isOpen) next.add(month);
										else next.delete(month);
										return next;
									});
								}}>
								<summary>
									{monthName(month)}
									<span className="slot-source">{older ? `${older.length} earlier ${older.length === 1 ? 'day' : 'days'}` : 'Earlier days'}</span>
								</summary>
								{open && (older ? older.map(entry => <Day key={entry.date} entry={entry} keep={keep} />) : <p className="hint">Loading ...</p>)}
							</details>
						);
					})}
				</>
			)}
		</section>
	);
}
