import { type ReactNode, useState } from 'react';

/** On trial on Dev: the pages in their new order. The answers that name pages follow it there. */
const IS_DEV = import.meta.env.VITE_CHANNEL === 'dev';
const REPO = 'https://github.com/DM15001/forever-gear-planner';

interface Question {
	q: string;
	a: ReactNode;
}

/** Questions and answers about the planner, in groups. Kept by hand: change it when the site changes. */
const GROUPS: { title: string; questions: Question[] }[] = [
	{
		title: 'What it is',
		questions: [
			{
				q: 'What does this site do?',
				a: (
					<>
						<p>It plans gear for a WoW Forever character. You bring the character, it shows which items are better than what you wear, where they come from, and which dungeons are worth running, alone or as a group.</p>
						<p>The numbers come from the WoWSims simulator, which runs inside your browser. For the same character and settings, "Simulate" here gives the same result as wowsims.com.</p>
					</>
				),
			},
			{
				q: 'Who is it for?',
				a: <p>Level 60 characters gearing up before raids: dungeons, quests, crafting, reputation and world drops. Every class has at least one damage build, and priests have healing builds too. Tanks and the other healers are not covered yet.</p>,
			},
			{
				q: 'Does it cost anything, and do I need an account?',
				a: <p>No and no. There is no login and no server. It is a fan project, not affiliated with or endorsed by Blizzard.</p>,
			},
		],
	},
	{
		title: 'How to use it',
		questions: [
			{
				q: 'How do I start?',
				a: (
					<ol>
						<li>On the start page, paste your character: an export from wowsims.com or a link somebody copied from this site. No export at hand? Load the WoWSims preset for your build and change the items by clicking the slots.</li>
						<li>Pick your build under "Check gear". Talents, consumables and buffs follow the build; change them with the "Sim setup" button under the simulation on "Build plan".</li>
						{IS_DEV ? (
							<>
								<li>Open "Content Selection" and go through the list: switch on the dungeons, reputations, sets, PvP and other sources you play. The plan is built from that and rebuilt on every change.</li>
								<li>"Customize" is optional: it lists the better items for each slot with the gain in front, to pick single ones yourself. What you pick is locked.</li>
								<li>Open "Build plan": your planned gear, with enchants and professions in the same panel. "Check the plan with the simulator" tests it with real simulations and keeps your locked picks.</li>
								<li>"Farm it" shows how to get the plan, sorted by dungeon. Press "Got it" when an item drops.</li>
							</>
						) : (
							<>
								<li>Open "Build plan". Say what content you do and it fills every slot with the best set for it; "Rebuild the plan" does it again. Enchants and professions are a section at the bottom of that page.</li>
								<li>"Customize" lists the better items for each slot with the gain in front, to pick single ones yourself. What you pick there overrides the plan.</li>
								<li>"Farm it" sorts the planned items by dungeon.</li>
							</>
						)}
					</ol>
				),
			},
			{
				q: 'What do the tabs do?',
				a: (
					<ul>
						{IS_DEV ? (
							<>
								<li><strong>Check gear</strong>: what you wear, your build, talents and the link to copy your character.</li>
								<li><strong>Content Selection</strong>: what counts for the plan: dungeons, reputations, sets, PvP, quests, crafting, drops, vendors.</li>
								<li><strong>Customize</strong>: every better item per slot with its gain, to pick single ones yourself. Optional.</li>
								<li><strong>Build plan</strong>: your planned gear slot by slot, the simulation and the check with the simulator, enchants and professions.</li>
								<li><strong>Farm it</strong>: how to get your plan and where the upgrades drop, best dungeon first.</li>
							</>
						) : (
							<>
								<li><strong>Character</strong>: what you wear, your build, talents and the link to copy your character.</li>
								<li><strong>Plan</strong>: your plan slot by slot, what to count (dungeons, crafting, set bonuses) and the simulation.</li>
								<li><strong>Upgrades</strong>: every better item per slot, with source and gain.</li>
								<li><strong>Enchants &amp; professions</strong>: the best enchant per slot and what your professions add.</li>
								<li><strong>Farm it</strong>: where your planned items drop, best dungeon first.</li>
							</>
						)}
						<li><strong>Group up</strong>: the same for several characters at once, with who wants which drop.</li>
						<li><strong>Sim setup</strong>: talents, rotation, consumables, buffs, the fight.</li>
						<li><strong>News</strong>: what changed in WoW Forever and in WoWSims, and items the simulator cannot value yet.</li>
					</ul>
				),
			},
			{
				q: 'How do I plan with friends?',
				a: (
					<>
						<p>Everyone presses "Copy character (equipped + planned gear)" under "Check gear" and sends what it copies. Paste each one into the box on "Group up". Or one person collects everybody and presses "Share the whole group": that link carries all of them.</p>
						<p>Nothing is synced. A link is a snapshot of the moment it was copied; after changes, copy it again.</p>
					</>
				),
			},
			{
				q: 'Can one character have several gear sets?',
				a: <p>Yes, as presets. Under Build on "Check gear", "Create preset" makes a copy of the open preset under a name of your choice: one for fire, one for frost, one against beasts. Each has its own build, worn gear and plan. Switch there or in the menu at the top of the gear panes at the side. A new item you equip in one preset is not equipped in the others.</p>,
			},
			{
				q: 'What do "planned", "BiS" and "upgrade" mean under "Group up"?',
				a: <p>"planned": the item is in that character's plan. "BiS": nothing in the game is better for that character in that slot. "upgrade": better than what they wear, but not their best option.</p>,
			},
		],
	},
	{
		title: 'The numbers',
		questions: [
			{
				q: 'Where do the DPS numbers come from?',
				a: (
					<>
						<p>From two places, and it matters which one you are looking at.</p>
						<ul>
							<li><strong>Simulate</strong> runs the real WoWSims simulator on your exact character. This is the number to trust.</li>
							<li><strong>The lists</strong> (Customize, Farm it, Group up) use values measured in advance: stat weights per build, plus a measured value for every item effect, set bonus and weapon. They are estimates, good for ranking, not exact for your character.</li>
						</ul>
						<p>When it counts, press "Check the top 5 with the simulator" in a slot, or simulate your plan.</p>
					</>
				),
			},
			{
				q: 'Why does a list say an item is better and the simulator says it is not?',
				a: <p>The list values are measured on the build's standard gear, once a night. Your gear is different, and caps (hit, for example) or set bonuses shift what a stat is worth. Small differences in the lists are noise; the simulator decides.</p>,
			},
			{
				q: 'Why does the first simulation take longer?',
				a: 'The first run downloads the simulator, about 6 MB. After that your browser keeps it and every run starts at once.',
			},
			{
				q: 'How current is it?',
				a: <p>The site looks for a new WoWSims version every half hour and takes it over together with WoWSims' own presets. The measurements for the lists follow: after an update only the builds it touches are measured again (a change to one class takes minutes, a change to the shared rules a few hours), and once a night everything is. The note above each list says from when its numbers are.</p>,
			},
			{
				q: 'How are healers handled?',
				a: <p>Healers get healing per second instead of DPS, for the healing situation you pick. Prayer of Mending is worked out by hand, because the simulator cannot cast it yet; its row is marked as an estimate.</p>,
			},
		],
	},
	{
		title: 'Where the data comes from',
		questions: [
			{
				q: 'Which sources does the site use?',
				a: (
					<ul>
						<li><strong>Items, stats, sets, enchants, the simulator itself</strong>: <a href="https://github.com/wowsims/forever">WoWSims Forever</a>.</li>
						<li><strong>Where items drop</strong>: <a href="https://github.com/Hoizame/AtlasLootClassic">AtlasLootClassic</a> and <a href="https://www.curseforge.com/wow/addons/atlasloot-forever">AtlasLoot Classic Forever</a> and AtlasLoot Continued (by Okrah and Lag), drop chances and guide picks from <a href="https://www.wowhead.com/forever">Wowhead</a>, and a hand-kept list for what those miss.</li>
						<li><strong>Icons</strong>: Blizzard's and Wowhead's image servers. Item tooltips are Wowhead's.</li>
						<li><strong>News</strong>: written by hand from official posts and the WoWSims changes, with links.</li>
					</ul>
				),
			},
			{
				q: 'An item is missing or its source is wrong. What now?',
				a: (
					<>
						<p>First check {IS_DEV ? '"Content Selection"' : '"What content do you do?" on "Build plan"'}: items with no known source and items not in the game yet are switched off by default, and a hidden item stays hidden until you bring it back there. Class-only items show only for that class.</p>
						<p>If the source really is unknown or wrong: next to such items there is a link "know where it drops?", which opens a filled-in report. Or write an <a href={`${REPO}/issues`}>issue</a>.</p>
					</>
				),
			},
		],
	},
	{
		title: 'The limits',
		questions: [
			{
				q: 'What can the site not do?',
				a: (
					<ul>
						<li><strong>No raids yet.</strong> Raid loot is not planned for. The raids are already listed, greyed out, under {IS_DEV ? '"Content Selection"' : '"What content do you do?"'}; that is where you will switch them on.</li>
						<li><strong>No tanks.</strong> There is no number for survival.</li>
						<li><strong>One target, one standard fight</strong> unless you change it with "Sim setup" under the simulation. Movement, mistakes and your group's real buffs are not in it.</li>
						<li><strong>Some item effects are unknown.</strong> Where WoWSims has no trigger rate for an effect, the item is left out instead of guessed. "News" lists them under "On the radar".</li>
						<li><strong>Some sources are unknown.</strong> Forever has new items nobody has documented yet.</li>
						<li><strong>Drop chances are Wowhead's</strong> and can be off for Forever.</li>
						<li><strong>It cannot read your character from the game.</strong> You paste an export.</li>
					</ul>
				),
			},
			{
				q: 'Is the simulator always right?',
				a: <p>It is as right as WoWSims is. Forever is new, and WoWSims changes several times a day. A number can move from one day to the next without your gear changing.</p>,
			},
		],
	},
	{
		title: 'Your data',
		questions: [
			{
				q: 'Where are my characters saved?',
				a: (
					<>
						<p>Only in this browser, on this device. Nothing is sent anywhere. Another browser or device starts empty, and clearing the browser's site data deletes them.</p>
						<p>To keep a copy or move a character, use "Copy character" and keep the link: opening it adds the character again.</p>
					</>
				),
			},
			{
				q: 'What is in a share link?',
				a: <p>The character itself: name, race, build, talents, professions, worn and planned gear with enchants. Nothing else, and it is not stored on a server: the link is the data.</p>,
			},
		],
	},
];

const slug = (title: string) => `faq-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`;
/** The plain words of an answer, to search in. */
const textOf = (node: ReactNode): string => {
	if (typeof node === 'string' || typeof node === 'number') return String(node);
	if (Array.isArray(node)) return node.map(textOf).join(' ');
	if (node && typeof node === 'object' && 'props' in node) return textOf((node as { props: { children?: ReactNode } }).props.children);
	return '';
};

/** Everything a new visitor asks: what the planner does, how to use it, where its numbers and data come from, and where it stops. All answers are open; the topics at the side jump, the box filters. */
export function FaqTab() {
	const [search, setSearch] = useState('');
	const words = search.toLowerCase().split(/\s+/).filter(Boolean);
	const groups = GROUPS.map(group => ({ ...group, questions: group.questions.filter(({ q, a }) => words.every(word => `${q} ${textOf(a)}`.toLowerCase().includes(word))) })).filter(group => group.questions.length > 0);
	return (
		<section className="panel faq" aria-labelledby="faq">
			<h2 id="faq">Questions and answers</h2>
			<p className="hint">What the planner does, how to use it, where the numbers come from and where it stops.</p>
			<div className="faq-layout">
				<nav className="faq-topics" aria-label="Topics">
					<input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search the answers" aria-label="Search the answers" />
					{groups.map(group => (
						<a key={group.title} href={`#${slug(group.title)}`} onClick={event => {
								event.preventDefault();
								document.getElementById(slug(group.title))?.scrollIntoView({ behavior: 'smooth', block: 'start' });
							}}>
							{group.title}
						</a>
					))}
				</nav>
				<div>
					{groups.length === 0 && <p className="farm-empty">No answer mentions that. Try another word.</p>}
					{groups.map(group => (
						<div key={group.title} id={slug(group.title)} className="faq-group">
							<h3>{group.title}</h3>
							{group.questions.map(({ q, a }) => (
								<article key={q} className="faq-item">
									<h4>{q}</h4>
									<div className="faq-answer">{a}</div>
								</article>
							))}
						</div>
					))}
					<p className="hint">
						Something missing here? <a href={`${REPO}/issues`}>Ask on GitHub</a>.
					</p>
				</div>
			</div>
		</section>
	);
}
