import { useEffect } from 'react';

import news from '../data/news.json';

interface NewsItem {
	title: string;
	text: string;
	url?: string;
	source?: string;
}
interface NewsEntry {
	date: string;
	summary?: string;
	sections: { title: string; items: NewsItem[] }[];
}

const ENTRIES = (news as unknown as { entries: NewsEntry[] }).entries;
const SEEN_KEY = 'forever-gear-planner.news-seen';

/** The newest day in the news, to tell whether there is something the visitor has not seen. */
export const latestNews = (): string | undefined => ENTRIES[0]?.date;
export function newsUnseen(): boolean {
	try {
		return !!latestNews() && localStorage.getItem(SEEN_KEY) !== latestNews();
	} catch {
		return false;
	}
}

const longDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** What changed, day by day: in the game, in the WoWSims simulator and on this site. Written once a day. */
export function NewsTab({ onSeen }: { onSeen: () => void }) {
	useEffect(() => {
		try {
			if (latestNews()) localStorage.setItem(SEEN_KEY, latestNews()!);
		} catch {
			// Storage can be unavailable; the "new" mark then simply stays.
		}
		onSeen();
	}, [onSeen]);

	return (
		<section className="panel news">
			<h2>News</h2>
			<p className="hint">Once a day: what changed in the game (hotfixes, patch notes, fixed quests), in the WoWSims simulator, and on this site. Each item links to where it comes from.</p>
			{ENTRIES.length === 0 && <p>Nothing yet. The first entry comes with the next daily run.</p>}
			{ENTRIES.map(entry => (
				<article key={entry.date} className="card news-day">
					<h3>{longDate(entry.date)}</h3>
					{entry.summary && <p className="news-summary">{entry.summary}</p>}
					{entry.sections
						.filter(section => section.items.length > 0)
						.map(section => (
							<div key={section.title} className="news-section">
								<h4>{section.title}</h4>
								<ul className="plain-list">
									{section.items.map((item, index) => (
										<li key={index} className="news-item">
											<strong>{item.title}</strong>
											<span>{item.text}</span>
											{item.url && (
												<a href={item.url} target="_blank" rel="noreferrer">
													{item.source ?? 'Source'}
												</a>
											)}
										</li>
									))}
								</ul>
							</div>
						))}
				</article>
			))}
		</section>
	);
}
