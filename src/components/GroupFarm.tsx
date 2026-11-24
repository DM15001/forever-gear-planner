import { useEffect, useMemo, useState } from 'react';

import { type GameData, dataFor, loadGameData } from '../lib/gameData';
import { type GroupMember, type GroupScope, groupFarm, sortGroup, withDrop } from '../lib/group';
import { characterLabel, type Roster } from '../lib/roster';
import { DEFAULT_FILTER } from '../lib/scoring';
import { specOf } from '../lib/specs';
import { wowheadData, wowheadItemUrl } from '../lib/stats';
import { normalFilter } from '../lib/storage';
import type { Character, Item } from '../lib/types';
import { ItemIcon } from './ItemIcon';

const GROUP_KEY = 'fgp.group';
const MOST = 10;

interface Saved {
	out: number[];
	scope: GroupScope;
	sort: 'total' | 'people';
}
function loadSaved(): Saved {
	try {
		const saved = JSON.parse(localStorage.getItem(GROUP_KEY) ?? '{}') as Partial<Saved>;
		return { out: Array.isArray(saved.out) ? saved.out.filter(Number.isInteger) : [], scope: saved.scope === 'any' ? 'any' : 'plan', sort: saved.sort === 'people' ? 'people' : 'total' };
	} catch {
		return { out: [], scope: 'plan', sort: 'total' };
	}
}

const gain = (value: number) => `+${value >= 10 ? value.toFixed(0) : value.toFixed(1)}`;

/** The farm plan of several saved characters at once: per dungeon and boss, who wants which drop. */
export function GroupFarm({ roster, onRosterChange }: { roster: Roster; onRosterChange: (next: Roster) => void }) {
	const [saved, setSaved] = useState<Saved>(loadSaved);
	const change = (next: Partial<Saved>) => {
		const merged = { ...saved, ...next };
		setSaved(merged);
		try {
			localStorage.setItem(GROUP_KEY, JSON.stringify(merged));
		} catch {
			// Without storage the choice lasts until the page is closed.
		}
	};
	const [undo, setUndo] = useState<{ text: string; index: number; before: Character } | null>(null);
	const [open, setOpen] = useState<Set<string>>(new Set());

	const picked = roster.characters.map((character, index) => ({ character, index })).filter(({ index }) => !saved.out.includes(index));
	const chosen = picked.slice(0, MOST);
	// The item data is narrowed to a build, so each build in the group loads its own once.
	const specIds = [...new Set(chosen.map(({ character }) => specOf(character).id))].sort().join(' ');
	const [loaded, setLoaded] = useState<Record<string, GameData>>({});
	useEffect(() => {
		let current = true;
		for (const { character } of chosen) {
			const spec = specOf(character);
			if (loaded[spec.id]) continue;
			loadGameData(spec).then(
				data => current && setLoaded(old => ({ ...old, [spec.id]: data })),
				() => undefined,
			);
		}
		return () => {
			current = false;
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [specIds]);

	const members = useMemo<GroupMember[]>(
		() =>
			chosen.flatMap(({ character, index }) => {
				const spec = specOf(character);
				const base = loaded[spec.id];
				if (!base) return [];
				const filter = (character.content ? normalFilter(character.content) : null) ?? DEFAULT_FILTER;
				return [{ index, label: characterLabel(character, index, spec), options: { character, spec, filter, data: dataFor(base, character.fight, filter.ignoredSets) } }];
			}),
		// eslint-disable-next-line react-hooks/exhaustive-deps
		[roster, saved.out.join(','), loaded],
	);
	const dungeons = useMemo(() => sortGroup(groupFarm(members, saved.scope), saved.sort), [members, saved.scope, saved.sort]);
	const waiting = members.length < chosen.length;
	const mixed = new Set(members.map(member => member.options.spec.role === 'healer')).size > 1;

	const got = (member: GroupMember, slotIndex: number, item: Item) => {
		const before = roster.characters[member.index];
		setUndo({ text: `${item.name} is now equipped on ${member.label}.`, index: member.index, before });
		onRosterChange({ ...roster, characters: roster.characters.map((character, index) => (index === member.index ? withDrop(character, slotIndex, item) : character)) });
	};
	const toggle = (key: string) =>
		setOpen(old => {
			const next = new Set(old);
			if (!next.delete(key)) next.add(key);
			return next;
		});

	return (
		<section className="panel group-farm" aria-labelledby="group-farm">
			<h2 id="group-farm">Farm plan for the group</h2>
			<p className="hint">
				Every character saved in this browser can be part of the group. To add a friend, have them send the share link from their Character tab and open it here. Their later changes need a new link: nothing is synced.
			</p>
			<fieldset className="group-members">
				<legend>Who is in the group</legend>
				{roster.characters.map((character, index) => {
					const spec = specOf(character);
					return (
						<label key={index} className="check">
							<input type="checkbox" checked={!saved.out.includes(index)} onChange={event => change({ out: event.target.checked ? saved.out.filter(i => i !== index) : [...saved.out, index] })} />
							{characterLabel(character, index, spec)} <span className="slot-source">{spec.name}</span>
						</label>
					);
				})}
			</fieldset>
			{picked.length > MOST && <p className="hint">Only the first {MOST} ticked characters are counted.</p>}
			<div className="group-switches">
				<div className="farm-order" role="group" aria-label="What counts as wanted">
					<span className="slot-source">Count</span>
					<button className="button button-small" aria-pressed={saved.scope === 'plan'} onClick={() => change({ scope: 'plan' })}>
						Planned items only
					</button>
					<button className="button button-small" aria-pressed={saved.scope === 'any'} onClick={() => change({ scope: 'any' })}>
						Every upgrade
					</button>
				</div>
				<div className="farm-order" role="group" aria-label="Order of the dungeons">
					<span className="slot-source">Sort by</span>
					<button className="button button-small" aria-pressed={saved.sort === 'total'} onClick={() => change({ sort: 'total' })}>
						Total gain
					</button>
					<button className="button button-small" aria-pressed={saved.sort === 'people'} onClick={() => change({ sort: 'people' })}>
						People who need something
					</button>
				</div>
			</div>
			{undo && (
				<p className="undo-toast" role="status">
					{undo.text}{' '}
					<button
						className="link"
						onClick={() => {
							onRosterChange({ ...roster, characters: roster.characters.map((character, index) => (index === undo.index ? undo.before : character)) });
							setUndo(null);
						}}>
						Undo
					</button>
				</p>
			)}
			{mixed && <p className="hint">The group has healers and damage dealers: a healer's gain is healing per second, the others' damage per second. The totals add both.</p>}
			{waiting && <p className="hint">Loading the item data of the group's builds…</p>}
			{!waiting && members.length === 0 && <p className="farm-empty">Tick at least one character.</p>}
			{!waiting && members.length > 0 && dungeons.length === 0 && (
				<p className="farm-empty">{saved.scope === 'plan' ? 'Nobody in the group has a dungeon drop in their plan. Switch to "Every upgrade", or build the plans first.' : 'No dungeon has an upgrade for anybody in the group.'}</p>
			)}
			<ol className="plain-list group-dungeons">
				{dungeons.map(dungeon => {
					const isOpen = open.has(dungeon.key);
					return (
						<li key={dungeon.key} className="group-dungeon">
							<button className="group-dungeon-head" aria-expanded={isOpen} onClick={() => toggle(dungeon.key)}>
								<strong className="dungeon-name">{dungeon.name}</strong>
								<span className="group-people">
									{dungeon.people} of {members.length} need something
								</span>
								<span className="dungeon-value num">{gain(dungeon.total)} in total</span>
							</button>
							<p className="group-split slot-source">
								{members
									.filter(member => dungeon.perMember.has(member.index))
									.sort((a, b) => dungeon.perMember.get(b.index)! - dungeon.perMember.get(a.index)!)
									.map(member => `${member.label} ${gain(dungeon.perMember.get(member.index)!)}`)
									.join(' · ')}
							</p>
							{isOpen &&
								dungeon.bosses.map(boss => (
									<div key={boss.name} className="group-boss">
										<h3>{boss.name}</h3>
										<ul className="plain-list">
											{boss.items.map(({ item, wants }) => (
												<li key={item.id} className="group-item">
													<a href={wowheadItemUrl(item.id)} data-wowhead={wowheadData('item', item.id)} target="_blank" rel="noreferrer" className="group-item-name">
														<ItemIcon icon={item.icon} quality={item.quality} small />
														<span className={`quality-${item.quality}`}>{item.name}</span>
													</a>
													{wants.length > 1 && <span className="group-contested">{wants.length} want it</span>}
													<span className="group-wants">
														{wants.map((want, order) => (
															<span key={want.member.index} className={order === 0 && wants.length > 1 ? 'group-want group-want-first' : 'group-want'}>
																{want.member.label} <span className="num">{gain(want.delta)}</span>
																{want.planned && saved.scope === 'any' && <span className="slot-source"> planned</span>}
																<button className="button button-small" onClick={() => got(want.member, want.slotIndex, item)} title={`${item.name} dropped for ${want.member.label}: equip it and take it out of the plan`}>
																	Got it
																</button>
															</span>
														))}
													</span>
												</li>
											))}
										</ul>
									</div>
								))}
						</li>
					);
				})}
			</ol>
		</section>
	);
}
