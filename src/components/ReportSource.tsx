import { useEffect, useState } from 'react';

import { Modal } from './Sim';

/** Opens the report window for an item, from anywhere on the page. */
export const reportSource = (item: { id: number; name: string }) => window.dispatchEvent(new CustomEvent('fgp-report-source', { detail: { id: item.id, name: item.name } }));

const REPO = 'https://github.com/DM15001/forever-gear-planner';

/**
 * The window in which somebody who knows where an item comes from says so. Two ways out, because not everybody has
 * a GitHub account: a report as text to paste into a chat, or a filled-in issue on the project's page. Reports are
 * read and checked before anything is added.
 */
export function ReportSource() {
	const [item, setItem] = useState<{ id: number; name: string } | null>(null);
	const [where, setWhere] = useState('');
	const [proof, setProof] = useState('');
	const [copied, setCopied] = useState(false);

	useEffect(() => {
		const open = (event: Event) => {
			setItem((event as CustomEvent<{ id: number; name: string }>).detail);
			setWhere('');
			setProof('');
			setCopied(false);
		};
		window.addEventListener('fgp-report-source', open);
		return () => window.removeEventListener('fgp-report-source', open);
	}, []);

	if (!item) return null;
	const body = `Item: ${item.name} (${item.id})\nhttps://www.wowhead.com/forever/item=${item.id}\n\nWhere it comes from: ${where.trim()}\n\nHow I know: ${proof.trim() || '(not said)'}\n`;
	const issue = `${REPO}/issues/new?labels=source-report&title=${encodeURIComponent(`Source of ${item.name} (${item.id})`)}&body=${encodeURIComponent(body)}`;
	const ready = where.trim().length > 2;
	const copy = async () => {
		try {
			await navigator.clipboard.writeText(`Gear Planner source report\n${body}`);
			setCopied(true);
		} catch {
			setCopied(false);
		}
	};

	return (
		<Modal title={`Where does ${item.name} come from?`} onClose={() => setItem(null)}>
			<div className="report-source">
				<p className="hint">The planner has no source for this item, or only a guess. If you know it, say so here. Every report is checked before it goes in.</p>
				<label className="field-label" htmlFor="report-where">
					Where it comes from
				</label>
				<textarea id="report-where" rows={3} value={where} onChange={event => setWhere(event.target.value)} placeholder="Creature and dungeon or zone, quest, vendor, or what it is crafted with. A link is fine too." autoFocus />
				<label className="field-label" htmlFor="report-proof">
					How you know (optional)
				</label>
				<textarea id="report-proof" rows={2} value={proof} onChange={event => setProof(event.target.value)} placeholder="You looted it, a Wowhead or wiki link, a screenshot link." />
				<div className="report-source-actions">
					<button className="button button-primary" disabled={!ready} onClick={copy}>
						{copied ? 'Copied: paste it in the Discord' : 'Copy the report'}
					</button>
					<a className={`button${ready ? '' : ' button-off'}`} href={ready ? issue : undefined} aria-disabled={!ready} target="_blank" rel="noreferrer">
						Send it on GitHub
					</a>
				</div>
				<p className="hint">"Copy the report" needs no account: paste it where you talk to the people who run this site. "Send it on GitHub" opens a filled-in form and needs a GitHub account.</p>
			</div>
		</Modal>
	);
}
