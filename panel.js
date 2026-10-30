// Arc-style sidebar: a switcher over the folders inside the "Spaces" bookmark folder,
// with the PR lists background.js syncs shown inside the space named like config.org (any case), like Arc's live folders.
const ROOT = 'Spaces';
// Repo from the PR url: stored sections from before a sync may lack repoFull.
const repoOf = (pr) => new URL(pr.url).pathname.split('/').slice(1, 3).join('/');
// One accent per space, picked by position, like Arc's space colours.
const ACCENTS = ['#5b8def', '#9b6bf2', '#2fb37a', '#f08c38', '#e5609a', '#3bb3c9'];

const nav = document.getElementById('spaces');
const list = document.getElementById('list');
const status = document.getElementById('status');
const refresh = document.getElementById('refresh');
const tabsBar = document.getElementById('tabs');
// Filter: hides cards whose text does not contain the query; counts stay as the full list.
// While a query is typed the popup shows every list's matches, not just the open tab's.
const search = document.getElementById('search');
function applyFilter() {
  const query = search.value.trim().toLowerCase();
  for (const row of list.querySelectorAll('.pr')) row.hidden = Boolean(query) && !row.textContent.toLowerCase().includes(query);
  // Stale rows always take part: their fold opens while the query matches inside it.
  for (const fold of list.querySelectorAll('details.stale')) fold.open = Boolean(query) && fold.querySelector('.pr:not([hidden])') !== null;
  list.querySelector('.board')?.toggleAttribute('data-searching', Boolean(query));
}
search.oninput = applyFilter;
// Esc clears the query; on an empty field it blurs, which folds the field back into its round button.
search.onkeydown = (event) => {
  if (event.key !== 'Escape') return;
  if (!search.value) return search.blur();
  search.value = '';
  applyFilter();
};
const rowTemplate = document.getElementById('pr').content.firstElementChild;

// No word for REVIEW_REQUIRED: the section label (To review) and the amber dot say it.
const REVIEW_LABELS = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes requested', REVIEW_REQUIRED: '', DRAFT: 'Draft' };
const REVIEWER_LABELS = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', PENDING: 'review pending' };
// The one button on my own PR, by authorState().action: [label, tooltip, key]. The opener runs ccfix / ccnudge / ccmerge / ccready.
const AUTHOR_ACTIONS = {
  fix: ['Fix', 'Fix in cmux: address review threads, failing checks and conflicts, push, re-request review', 'f'],
  nudge: ['Nudge', 'Re-request review from everyone still pending', 'n'],
  merge: ['Merge', 'Squash-merge and delete the branch', 'm'],
  ready: ['Mark ready', 'Mark ready for review', 'r'],
};
const CHECKS = {
  SUCCESS: ['✓', 'Checks passed'],
  FAILURE: ['✕', 'Checks failed'],
  ERROR: ['✕', 'Checks errored'],
  PENDING: ['●', 'Checks running'],
  EXPECTED: ['●', 'Checks expected'],
};
// state.json verdict (claude-review): the state of my posted review.
const VERDICTS = { approved: 'approved', changes: 'changes requested', commented: 'commented' };
const MAX_AVATARS = 4;
const UNITS = [['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]];
const relative = new Intl.RelativeTimeFormat(undefined, { style: 'narrow' });

// The open space and collapsed folders survive closing the panel.
const saved = (key, fallback) => JSON.parse(localStorage.getItem(key)) ?? fallback;
const save = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const el = (tag, props) => Object.assign(document.createElement(tag), props);
// Motion: the scripted springs, skipped unless motion is welcome (panel.html gates the CSS ones the same way). Durations and the
// spring come from lg.css (--lg-duration-*, --lg-easing-spring); nothing runs longer than 400 ms and only on the user's own actions.
const motion = matchMedia('(prefers-reduced-motion: no-preference)');
const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const spring = () => ({ duration: parseFloat(token('--lg-duration-normal')) || 0, easing: token('--lg-easing-spring') || 'ease-out' });
const play = (node, frames, options) => (motion.matches ? node.animate(frames, { ...spring(), ...options }) : null);
// Rows rise 6 px into place, 20 ms apart, at most 8.
const RISE = [{ opacity: 0, transform: 'translateY(6px)' }, {}];
const rise = (rows) => rows.slice(0, 8).forEach((row, i) => play(row, RISE, { delay: i * 20, fill: 'backwards' }));
let activeSpace = saved('space', null);
// Model and effort for new reviews ride in the URL: ccreview://<pr>/<model>/<effort>/<depth>; depth is the card button.
const picks = { model: saved('model', 'opus'), effort: saved('effort', 'high') };
// The pickers sit in the settings card; the sliders button's tooltip names the current picks.
const picksButton = document.getElementById('picks');
// Settings: the sliders button unfolds a card under the header and folds it again; Esc folds it too. The fold's height springs
// between 0 and the card's, so the list below moves with it rather than jumping, while the card fades and grows from 0.98 at its top;
// a second press mid-way turns it around from where it is.
const settingsCard = document.getElementById('settings');
const settingsFold = document.getElementById('settings-fold');
let folding = null;
function toggleSettings(open = settingsFold.hidden) {
  if (!folding && settingsFold.hidden === !open) return open && scrollTo(0, 0);
  picksButton.setAttribute('aria-expanded', open);
  const from = folding ? settingsFold.offsetHeight : open ? 0 : settingsCard.offsetHeight;
  folding?.cancel();
  settingsFold.hidden = false;
  if (open) scrollTo(0, 0);
  if (!motion.matches) return void (settingsFold.hidden = !open);
  // Sidak.app grows its popover to the open height now, not after the spring.
  if (open) sendHeight(document.body.scrollHeight);
  settingsFold.classList.add('folding');
  folding = play(settingsFold, [{ height: `${from}px` }, { height: `${open ? settingsCard.offsetHeight : 0}px` }]);
  play(settingsCard, open ? [{ opacity: 0, transform: 'scale(0.98)' }, {}] : [{}, { opacity: 0, transform: 'scale(0.98)' }]);
  folding.onfinish = () => {
    folding = null;
    settingsFold.classList.remove('folding');
    settingsFold.hidden = !open;
  };
}
picksButton.onclick = () => toggleSettings();
for (const seg of document.querySelectorAll('#settings .seg[data-key]')) {
  const key = seg.dataset.key;
  const show = () => {
    for (const button of seg.children) button.setAttribute('aria-pressed', button.value === picks[key]);
    const pressed = [...document.querySelectorAll('#settings .seg[data-key] [aria-pressed="true"]')].map((button) => button.textContent);
    picksButton.title = `Reviews use ${pressed.join(' · ')}`;
  };
  // settings.json carries the picks too: pr-board auto starts its reviews with them.
  seg.onclick = ({ target }) => {
    if (!target.value) return;
    picks[key] = target.value;
    save(key, picks[key]);
    saveSettings({ [key]: picks[key] });
    show();
  };
  show();
}
const collapsed = new Set(saved('collapsed', []));

// config.json (./install.sh writes it) holds everything personal: { org, login, repos, reviewable, rulesRepo, profiles, defaultProfile, extensionId }.
// Read like settings.json in render(); localStorage caches it for the first paint. Without it the board still renders, with a line saying so.
// reviewable: repos checked out under config.repos that get Skim / Deep; login: the author profile's switch shows its avatar.
const NO_CONFIG = { org: '', login: '', reviewable: [], profiles: {}, defaultProfile: '' };
let config = saved('config', NO_CONFIG);
async function loadConfig() {
  const res = await fetch(chrome.runtime.getURL('config.json'), { cache: 'no-store' }).catch(() => null);
  return res?.ok ? res.json().catch(() => null) : null;
}

// settings.json sits next to state.json and is shared with Sidak.app and bin/pr-board: { staleDays, vip, auto, model, effort, profile, snooze, pollMinutes, phone }.
// pollMinutes: how often Sidak.app's timer syncs. phone: false stops Sidak.app's tunnel (config.json remote); unset means on.
// Read like reviewState(), written through the opener (ccset://); localStorage caches it so the header renders before the fetch.
// No profile picked yet: config.defaultProfile.
const DEFAULT_SETTINGS = { staleDays: 30, vip: [], auto: { on: false }, snooze: {}, pollMinutes: 2 };
let settings = { ...DEFAULT_SETTINGS, ...saved('settings', {}) };
// While a write is in flight the file is older than the page, so renders keep the page's copy.
let settingsWrites = 0;
async function loadSettings() {
  if (settingsWrites) return settings;
  const res = await fetch(chrome.runtime.getURL('settings.json'), { cache: 'no-store' }).catch(() => null);
  const file = res?.ok ? await res.json().catch(() => null) : null;
  return { ...DEFAULT_SETTINGS, ...(file ?? saved('settings', {})) };
}
function saveSettings(change) {
  settings = { ...settings, ...change };
  save('settings', settings);
  settingsWrites++;
  const url = `ccset://${encodeURIComponent(JSON.stringify(settings))}`;
  chrome.runtime.sendNativeMessage('com.sidak.host', { url }, (reply) => {
    settingsWrites--;
    const error = chrome.runtime.lastError?.message ?? (reply?.ok ? null : reply?.error ?? 'no reply');
    if (error) alert(`Could not save settings:\n${error}\nCheck that Arc may write to the Sidak folder, then try again.`);
    rerender();
  });
  rerender();
}
// Snooze (h): settings.snooze maps "owner/repo#n" to the time the PR comes back, a day from the press; h again brings it back now.
// Expired entries drop at the next write, so the file stays small.
const snoozedUntil = (pr) => settings.snooze?.[`${repoOf(pr)}#${pr.number}`] ?? 0;
function toggleSnooze(key) {
  if (!key) return;
  const now = Date.now();
  const snooze = Object.fromEntries(Object.entries(settings.snooze ?? {}).filter(([k, until]) => k !== key && until > now));
  if (!(settings.snooze?.[key] > now)) snooze[key] = now + 86400000;
  saveSettings({ snooze });
}
// Refresh every, Hide after (the stale cut-off) and the VIP list sit in the settings card under model and effort.
const pollSeg = document.querySelector('#settings [data-setting="pollMinutes"]');
const staleSeg = document.querySelector('#settings [data-setting="staleDays"]');
const vipBox = document.getElementById('vip');
const vipList = document.getElementById('vip-list');
// Auto review: Sidak.app's timer runs pr-board auto, which reads auto.on and the picks; the sliders button wears an amber dot while on.
const autoSeg = document.querySelector('#settings [data-setting="auto"]');
// Claude profile: the opener reads it from settings.json and starts claude-review with that config.profiles entry's CLAUDE_CONFIG_DIR.
const profileSeg = document.querySelector('#settings [data-setting="profile"]');
// Phone access: shown once config.json names the Access team, since the tunnel needs it.
const phoneSeg = document.querySelector('#settings [data-setting="phone"]');
const phoneOn = () => Boolean(config.remote?.team) && settings.phone !== false;
// The footer names what a click runs, in the pickers' words, as plain words that open the settings card: the profile only when it is
// not config.defaultProfile, Auto only while on. Set-once settings (sync interval, stale cut-off) stay in the card.
// The sync status (#status, the last sync's time beside the refresh button) follows it. Every render refreshes it, and settings, picks and syncs all end in one.
const footConfig = document.getElementById('foot-config');
function renderFoot() {
  const label = (key) => document.querySelector(`#settings .seg[data-key="${key}"] button[value="${picks[key]}"]`)?.textContent ?? picks[key];
  const pick = (text, what) => el('button', { type: 'button', className: 'pick', textContent: text, title: `${what}: open settings`, onclick: () => toggleSettings(true) });
  const profile = settings.profile !== config.defaultProfile && settings.profile;
  footConfig.replaceChildren(...[
    profile && pick(profile, 'Claude profile for new reviews'),
    pick(label('model'), 'Model for new reviews'),
    pick(label('effort'), 'Effort for new reviews'),
    settings.auto?.on && pick('Auto on', 'Auto review is on'),
  ].filter(Boolean));
}
function showSettings() {
  for (const button of pollSeg.children) button.setAttribute('aria-pressed', Number(button.value) === settings.pollMinutes);
  for (const button of staleSeg.children) button.setAttribute('aria-pressed', Number(button.value) === settings.staleDays);
  const autoOn = Boolean(settings.auto?.on);
  for (const button of autoSeg.children) button.setAttribute('aria-pressed', (button.value === 'on') === autoOn);
  phoneSeg.parentElement.hidden = !config.remote?.team;
  for (const button of phoneSeg.children) button.setAttribute('aria-pressed', (button.value === 'on') === phoneOn());
  const names = Object.keys(config.profiles);
  if (names.join() !== [...profileSeg.children].map((button) => button.value).join()) {
    profileSeg.replaceChildren(...names.map((name) => el('button', { type: 'button', value: name, textContent: name })));
  }
  for (const button of profileSeg.children) button.setAttribute('aria-pressed', button.value === (settings.profile || config.defaultProfile));
  picksButton.toggleAttribute('data-auto', autoOn);
  showVip();
  renderFoot();
}
pollSeg.onclick = ({ target }) => target.value && saveSettings({ pollMinutes: Number(target.value) });
staleSeg.onclick = ({ target }) => target.value && saveSettings({ staleDays: Number(target.value) });
// Turning it on writes the picks as well, so the runs use the model and effort shown here.
autoSeg.onclick = ({ target }) => target.value && saveSettings({ auto: { ...settings.auto, on: target.value === 'on' }, ...picks });
profileSeg.onclick = ({ target }) => target.value && saveSettings({ profile: target.value });
phoneSeg.onclick = ({ target }) => target.value && saveSettings({ phone: target.value === 'on' });
// VIP authors: a chip per login or email, × drops it; Enter in the field (or leaving it) adds what was typed. settings.vip stays a list of strings.
function showVip() {
  if (vipList.dataset.shown === settings.vip.join('\n')) return;
  vipList.dataset.shown = settings.vip.join('\n');
  vipList.replaceChildren(...settings.vip.map((entry) => {
    const chip = el('span', { className: 'chip' });
    // A login wears its GitHub avatar; an email has none.
    if (!entry.includes('@')) {
      const img = el('img', { src: `https://github.com/${encodeURIComponent(entry)}.png?size=36`, alt: '', width: 18, height: 18 });
      img.onerror = () => img.remove();
      chip.append(img);
    }
    const remove = el('button', { type: 'button', textContent: '×', title: `Remove ${entry}`, ariaLabel: `Remove ${entry}` });
    remove.onclick = () => {
      saveSettings({ vip: settings.vip.filter((v) => v !== entry) });
      vipBox.focus();
    };
    chip.append(el('span', { textContent: entry, title: entry }), remove);
    return chip;
  }));
}
function addVip() {
  const entry = vipBox.value.trim();
  vipBox.value = '';
  if (entry && !settings.vip.some((v) => v.toLowerCase() === entry.toLowerCase())) saveSettings({ vip: [...settings.vip, entry] });
}
vipBox.onkeydown = (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  addVip();
};
vipBox.onblur = addVip;
showSettings();

function icon(id, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#${id}`);
  svg.append(use);
  return svg;
}

// ponytail: drops the English " ago" ("5d ago" -> "5d") to fit the card; other locales keep their suffix.
function ago(iso) {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  const [unit, size] = UNITS.find(([, size]) => -seconds >= size) ?? [];
  return unit ? relative.format(Math.round(seconds / size), unit).replace(/ ago$/, '') : 'now';
}

function favicon(pageUrl) {
  const url = new URL(chrome.runtime.getURL('/_favicon/'));
  url.searchParams.set('pageUrl', pageUrl);
  url.searchParams.set('size', '32');
  return url.toString();
}

const countLinks = (node) => (node.url ? 1 : node.children.reduce((sum, child) => sum + countLinks(child), 0));

function collapsible({ key, className, iconId, title, children }) {
  const details = el('details', { className, open: !collapsed.has(key) });
  details.ontoggle = () => {
    details.open ? collapsed.delete(key) : collapsed.add(key);
    save('collapsed', [...collapsed]);
  };
  const summary = el('summary');
  summary.append(icon(iconId), el('span', { textContent: title }));
  details.append(summary, ...children);
  return details;
}

function avatar(reviewer) {
  const label = `${reviewer.login}: ${REVIEWER_LABELS[reviewer.state]}`;
  const img = el('img', { src: reviewer.avatarUrl, alt: label, title: label });
  img.dataset.state = reviewer.state;
  return img;
}

// The cards whose TL;DR is open, kept across the re-render every sync does.
const openTldrs = new Set();
function prRow(pr) {
  const row = rowTemplate.cloneNode(true);
  row.href = pr.url;
  row.title = pr.title;
  row.dataset.state = pr.review;
  row.querySelector('.title').textContent = pr.title;
  row.querySelector('.time').textContent = ago(pr.updatedAt);
  row.querySelector('.state').textContent = REVIEW_LABELS[pr.review];
  // The meta line is words 10 px apart (CSS), no separators. A VIP author gets a gold star in front of the title.
  const info = row.querySelector('.info');
  const words = (...parts) => parts.filter(Boolean).map((text) => el('span', { textContent: text }));
  info.replaceChildren(...words(`${pr.repo} #${pr.number}`, pr.author, pr.claude === 'reviewed' && pr.depth === 'quick' && 'quick review', VERDICTS[pr.verdict], pr.auto && 'auto'));
  if (isVip(pr, settings.vip)) row.querySelector('.title').prepend(icon('i-star', 'icon vip'));
  // Reviewed: the Next line, live when the PR moved since the review; a click on it opens the reviewer's What and Found above it.
  // The TL;DR is the top of the reviewer's handoff, which claude-review copies into state.json.
  const live = { requested: 'Re-requested your review', commits: 'New commits since your review' }[pr.followUp?.why];
  if (pr.claude === 'reviewed' && (pr.tldr || live)) {
    const lines = new Map([...(pr.tldr ?? '').matchAll(/^[-*]?[ \t]*(What|Found|Next):[ \t]*(.+)$/gm)].map(([, label, text]) => [label, text]));
    const next = live ?? lines.get('Next');
    lines.delete('Next');
    if (next) lines.set('Next', next);
    const tldr = row.appendChild(el('button', { className: 'tldr', type: 'button' }));
    for (const [label, text] of lines) {
      const line = tldr.appendChild(el('span', { className: label === 'Next' ? 'next' : '' }));
      line.append(el('b', { textContent: label }), el('span', { textContent: text }));
    }
    if (live) tldr.lastChild.dataset.live = '';
    const key = `${repoOf(pr)}#${pr.number}`;
    const show = () => tldr.setAttribute('aria-expanded', openTldrs.has(key));
    show();
    tldr.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!openTldrs.delete(key)) openTldrs.add(key);
      show();
    };
  }
  row.oncontextmenu = (event) => openMenu(event, pr);
  row.dataset.key = `${repoOf(pr)}#${pr.number}`;
  if (snoozedUntil(pr) > Date.now()) info.append(...words(`snoozed until ${new Date(snoozedUntil(pr)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));

  const [glyph = '', label = ''] = CHECKS[pr.checks] ?? [];
  const checks = Object.assign(row.querySelector('.checks'), { textContent: glyph, title: label });
  checks.dataset.state = pr.checks ?? '';

  // bin/claude-review-open focuses the PR's cmux workspace, or with a depth starts one with the picked model and effort.
  const openInCmux = (depth) => (event) => {
    event.preventDefault();
    let url = `ccreview://${repoOf(pr)}/${pr.number}${depth ? `/${picks.model}/${picks.effort}/${depth}` : ''}`;
    // My own PRs: ccfix runs claude-fix on the branch, ccmerge squash-merges (the opener handles both schemes).
    if (depth === 'fix') url = `ccfix://${repoOf(pr)}/${pr.number}/${picks.model}/${picks.effort}`;
    if (depth === 'merge') {
      if (!confirm(`Squash-merge ${pr.repo} #${pr.number}?\n${pr.title}`)) return;
      url = `ccmerge://${repoOf(pr)}/${pr.number}`;
    }
    // Nudge re-requests every pending reviewer and Mark ready leaves draft: one gh call each in the opener, then a sync shows it.
    if (depth === 'nudge' || depth === 'ready') url = `cc${depth}://${repoOf(pr)}/${pr.number}`;
    // The native messaging host (bin/) runs the opener directly; Arc's external-URL launch was unreliable.
    chrome.runtime.sendNativeMessage('com.sidak.host', { url }, (reply) => {
      const error = chrome.runtime.lastError?.message ?? (reply?.ok ? null : reply?.error ?? 'no reply');
      if (error) alert(`Could not ${{ merge: 'merge', nudge: 'nudge', ready: 'mark it ready' }[depth] ?? 'start it'}:\n${error}\nIs cmux running? Then try again.`);
      else if (depth === 'nudge' || depth === 'ready') refresh.click();
    });
  };
  row.dataset.claude = pr.claude ?? '';
  // Back in the Inbox after my review: its dot says to review again.
  if (pr.followUp) row.dataset.follow = '';
  const claude = row.querySelector('.claude');
  // The column already says running/reviewed; the badge is an icon or the word "failed". Running it opens cmux; reviewed it lets the
  // card's link open the PR (state.json has no review id); failed it skims again, like s.
  claude.replaceChildren(...(pr.claude === 'running' ? [icon('i-play')] : pr.claude === 'reviewed' ? [icon('i-done')] : pr.claude === 'failed' ? ['failed'] : []));
  claude.dataset.state = pr.claude ?? '';
  claude.title = { reviewed: 'Open the reviews on GitHub', failed: 'Review failed: skim again (s)' }[pr.claude] ?? 'Open in cmux';
  const skim = (event) => {
    event.preventDefault();
    row.querySelector('.review[data-depth="quick"]')?.click();
  };
  claude.onclick = pr.claude === 'reviewed' ? null : pr.claude === 'failed' ? skim : openInCmux(null);
  const actions = row.querySelector('.actions');
  if (pr.mine) {
    // My PR: a pill after the title when it says more than the tab (the blocker, who is awaited), the reason as the second line,
    // the next step as a button in front of Skim / Deep (a self-check: claude-review prints the findings instead of posting them).
    const { group, pill, reason, action } = pr.next;
    // The status dot follows the group: red needs me, blue waiting, green ready, grey draft.
    row.dataset.group = group;
    if (pill) {
      const tag = el('span', { className: 'pill', textContent: pill });
      tag.dataset.group = group;
      row.querySelector('.title').replaceChildren(el('span', { className: 'name', textContent: pr.title }), tag);
    }
    row.querySelector('.state').textContent = '';
    info.replaceChildren(...words(`${pr.repo} #${pr.number}`, ...reason.split(' · ')));
    const [label, tip, key] = AUTHOR_ACTIONS[action] ?? [];
    if (label) {
      const button = el('button', { className: `review ${action}`, type: 'button', textContent: label, title: tip, ariaKeyShortcuts: key });
      button.dataset.depth = action;
      button.append(el('kbd', { textContent: key, ariaHidden: 'true' }));
      actions.prepend(button);
    }
  }
  if (!config.reviewable.includes(repoOf(pr).split('/')[1]) || pr.claude === 'running') actions.remove();
  for (const button of actions.children) button.onclick = openInCmux(button.dataset.depth);
  // The label is the button's first text node; its key hint stays.
  if (pr.claude === 'reviewed') actions.lastElementChild.firstChild.data = 'Again';

  const avatars = row.querySelector('.avatars');
  avatars.append(...pr.reviewers.slice(0, MAX_AVATARS).map(avatar));
  const hidden = pr.reviewers.length - MAX_AVATARS;
  if (hidden > 0) avatars.append(el('span', { className: 'more', textContent: `+${hidden}` }));
  return row;
}

// The popup shows one column at a time, picked by a tab, under its section label; Inbox's label says what is left.
// Stale rows close in a fold at the bottom, outside the count.
const SECTION_LABELS = { Inbox: 'To review', Reviewed: 'Waiting on author' };
function column(title, iconId, prs, group = 'inbox', stale = []) {
  const section = el('section', { className: 'column' });
  section.dataset.tab = title;
  section.dataset.group = group;
  const heading = el('h2');
  heading.append(icon(iconId), el('span', { textContent: SECTION_LABELS[title] ?? title }), el('span', { className: 'count', textContent: prs.length }));
  section.append(heading, ...(prs.length ? prs.map(prRow) : [el('p', { className: 'empty', textContent: 'Nothing here' })]));
  if (stale.length) section.append(staleFold(stale));
  return section;
}

// Opening the fold (a click, x, or a search that matches inside it) lifts its rows in; a render that reopens it for a query does not.
let renderedAt = 0;
function staleFold(prs) {
  const details = el('details', { className: 'stale' });
  details.ontoggle = () => details.open && performance.now() - renderedAt > 100 && rise([...details.querySelectorAll(':scope > .pr:not([hidden])')]);
  const summary = el('summary');
  summary.append(el('span', { className: 'count', textContent: `Stale ${prs.length}` }));
  details.append(summary, ...prs.map(prRow));
  return details;
}

// Each profile keeps its own open tab: Inbox / Running / Reviewed, or Needs me / Waiting / Ready / Drafts.
const openTab = { inbox: saved('tab', 'Inbox'), mine: saved('mineTab', 'Needs me') };
function showTab(title, group) {
  const moved = openTab[group] !== title;
  openTab[group] = title;
  save(group === 'mine' ? 'mineTab' : 'tab', title);
  markActive(moved);
  // The lists cross-fade: the one now shown fades in over the fast duration.
  if (moved) for (const section of list.querySelectorAll('.column:is(.active, .also)')) play(section, [{ opacity: 0 }, {}], { duration: parseFloat(token('--lg-duration-fast')), easing: 'ease-out' });
}
// The active list is the current profile's open tab: its button pressed, its column the one the popup shows.
// The Inbox tab also lists what is running (.also), as a second section.
// The glass lozenge (#tabs::before) sits under the open tab by its index among the current profile's tabs; it glides on a pick only.
function markActive(glide = false) {
  for (const button of tabsBar.children) button.setAttribute('aria-pressed', button.value === openTab[button.dataset.group]);
  const tab = openTab[document.body.dataset.view];
  for (const section of list.querySelectorAll('.column')) {
    section.classList.toggle('active', section.dataset.tab === tab);
    section.classList.toggle('also', tab === 'Inbox' && section.dataset.tab === 'Running');
  }
  const shown = [...tabsBar.children].filter((button) => button.dataset.group === document.body.dataset.view);
  tabsBar.style.setProperty('--n', shown.length || 1);
  tabsBar.style.setProperty('--i', Math.max(shown.findIndex((button) => button.value === tab), 0));
  tabsBar.dataset.glide = glide ? 'move' : 'still';
}

// Both profiles' tabs sit in the bar; the CSS shows the current profile's.
function tabButton(title, count, group) {
  const button = el('button', { type: 'button', value: title, onclick: () => showTab(title, group) });
  button.dataset.group = group;
  button.append(el('span', { className: 'label', textContent: title }));
  if (count) {
    const n = el('span', { className: 'n', textContent: count });
    // Amber so a running review shows from any tab.
    if (title === 'Running') n.dataset.live = '';
    button.append(n);
  }
  return button;
}

// bin/claude-review writes state.json next to this file: { "owner/repo#n": { state, at, model, depth, run, auto, verdict, sha, tldr } }.
async function reviewState() {
  const res = await fetch(chrome.runtime.getURL('state.json'), { cache: 'no-store' }).catch(() => null);
  return res?.ok ? res.json() : {};
}

// Review pipeline: requested PRs flow Inbox -> Running -> Reviewed by state.json, and back to the Inbox when they move after my review;
// Mine splits by what each PR needs next.
// Stale PRs (settings.staleDays) fold away in Inbox and Mine, never in Running or Reviewed; a VIP is never stale and tops the Inbox.
function board(sections, state) {
  const by = Object.fromEntries(sections.map((s) => [s.title, s.prs]));
  const requested = by.Requested ?? [];
  const all = [...new Map([...requested, ...(by['Reviewed by me'] ?? []), ...(by.Mine ?? [])].map((pr) => [pr.url, pr])).values()];
  const now = Date.now();
  for (const pr of all) {
    const entry = state[`${repoOf(pr)}#${pr.number}`];
    // Still "running" after 2 h is a tab that died without settling (Sidak.app and pr-board auto skip it too): failed, so it skims again.
    pr.claude = entry?.state === 'running' && now - entry.at > 2 * 3600 * 1000 ? 'failed' : (entry?.state ?? null);
    pr.depth = entry?.depth ?? null;
    pr.auto = entry?.auto ?? false;
    pr.verdict = entry?.verdict ?? null;
    pr.tldr = entry?.tldr ?? null;
    pr.followUp = followUp(pr, entry);
  }
  // A snoozed PR (h, a day) folds away like a stale one, VIP or not.
  const stale = (pr) => snoozedUntil(pr) > now || (isStale(pr, settings.staleDays, now) && !isVip(pr, settings.vip));
  // A reviewed PR that moved since my review (followUp) is back in the Inbox; Reviewed keeps the rest, which wait on their author.
  const reviewed = all.filter((pr) => pr.claude === 'reviewed');
  const inbox = [...requested.filter((pr) => pr.claude !== 'running' && pr.claude !== 'reviewed'), ...reviewed.filter((pr) => pr.followUp)]
    .sort((a, b) => isVip(b, settings.vip) - isVip(a, settings.vip));
  const wrap = el('div', { className: 'board' });
  wrap.append(
    column('Inbox', 'i-inbox', inbox.filter((pr) => !stale(pr)), 'inbox', inbox.filter(stale)),
    column('Running', 'i-play', all.filter((pr) => pr.claude === 'running')),
    column('Reviewed', 'i-done', reviewed.filter((pr) => !pr.followUp)),
    ...mineColumns(by.Mine ?? [], stale),
  );
  return wrap;
}

// Mine, one tab per authorState group (pr.js); worst blocker first, then oldest first.
const MINE_TABS = [['needs', 'Needs me', 'i-person'], ['waiting', 'Waiting', 'i-pr'], ['ready', 'Ready', 'i-done'], ['draft', 'Drafts', 'i-pr']];
function mineColumns(prs, stale) {
  for (const pr of prs) Object.assign(pr, { mine: true, next: authorState(pr) });
  prs.sort((a, b) => a.next.rank - b.next.rank || Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  return MINE_TABS.map(([group, title, iconId]) => {
    const rows = prs.filter((pr) => pr.next.group === group);
    return column(title, iconId, rows.filter((pr) => !stale(pr)), 'mine', rows.filter(stale));
  });
}

function bookmarkNode(node) {
  if (!node.url) {
    const children = node.children.map(bookmarkNode);
    return collapsible({ key: node.id, className: 'folder', iconId: 'i-folder', title: node.title, children });
  }
  const row = el('a', { className: 'link', href: node.url, target: '_blank', title: node.title });
  row.append(el('img', { src: favicon(node.url), alt: '' }), el('span', { textContent: node.title || node.url }));
  return row;
}

function spaceButton(space, index, active) {
  const button = el('button', { className: 'space', title: `${space.title} (${index + 1})` });
  button.style.setProperty('--dot', ACCENTS[index % ACCENTS.length]);
  button.setAttribute('aria-pressed', active);
  button.append(el('span', { className: 'dot' }), el('span', { textContent: space.title }));
  button.onclick = () => {
    activeSpace = space.title;
    save('space', activeSpace);
    render();
  };
  return button;
}

async function loadSpaces() {
  const [root] = (await chrome.bookmarks.search({ title: ROOT })).filter((b) => !b.url);
  if (!root) return [];
  const [tree] = await chrome.bookmarks.getSubTree(root.id);
  return tree.children.filter((child) => !child.url);
}

function renderHeader(space, index, syncStatus) {
  const title = space?.title ?? 'Pull requests';
  document.documentElement.style.setProperty('--accent', ACCENTS[Math.max(index, 0) % ACCENTS.length]);
  document.getElementById('space-title').textContent = title;
  const links = space ? countLinks(space) : 0;
  status.textContent = [space && `${links} ${links === 1 ? 'link' : 'links'}`, syncStatus].filter(Boolean).join(' · ');
  // The status sits at the end of the footer, so a long sync error is cut off; the tooltip has the whole text.
  status.title = status.textContent;
  status.dataset.error = String(syncStatus?.startsWith('Sync failed') ?? false);
  refresh.classList.remove('spinning');
}

async function render() {
  const [{ sections = [], syncedAt, syncError }, spaces, state, stored, file] = await Promise.all([
    chrome.storage.local.get(['sections', 'syncedAt', 'syncError']),
    loadSpaces(),
    reviewState(),
    loadSettings(),
    loadConfig(),
  ]);
  config = { ...NO_CONFIG, ...file };
  save('config', config);
  showMe();
  if (!settingsWrites) settings = stored;
  save('settings', settings);
  showSettings();
  const syncStatus = syncError
    ? `Sync failed: ${syncError}`
    : syncedAt
      ? new Date(syncedAt).toLocaleTimeString([], { timeStyle: 'short' })
      : 'Not synced yet';
  const index = Math.max(spaces.findIndex((s) => s.title === activeSpace), 0);
  const space = spaces[index];
  renderHeader(space, index, syncStatus);
  nav.replaceChildren(...spaces.map((s, i) => spaceButton(s, i, i === index)));

  // Without a Spaces folder (Arc, which has its own spaces) this is a plain PR live folder.
  const prs = !space || space.title.toLowerCase() === config.org.toLowerCase() ? [board(sections, state)] : [];
  const bookmarks = space ? space.children.map(bookmarkNode) : [];
  const missing = file ? [] : [el('p', { className: 'empty', textContent: 'No config.json: run ./install.sh in the Sidak folder.' })];
  list.replaceChildren(...missing, ...prs, ...(prs.length && bookmarks.length ? [el('hr')] : []), ...bookmarks);
  const columns = [...list.querySelectorAll('.column')];
  // Counts leave out the folded stale rows; the switch's Mine count is Needs me.
  const prsIn = (section) => section.querySelectorAll(':scope > .pr').length;
  tabsBar.replaceChildren(...columns.map((section) => tabButton(section.dataset.tab, prsIn(section), section.dataset.group)));
  const count = (tab) => prsIn(columns.find((section) => section.dataset.tab === tab) ?? el('section'));
  counts = { inbox: count('Inbox'), mine: count('Needs me') };
  labelSwitch();
  if (!columns.some((section) => section.dataset.tab === openTab.inbox)) openTab.inbox = 'Inbox';
  if (!columns.some((section) => section.dataset.tab === openTab.mine)) openTab.mine = 'Needs me';
  markActive();
  applyFilter();
  riseNewRows();
  renderedAt = performance.now();
  sendHeight();
}

// A render that lands a row under a still pointer shows its buttons without the pop: the pop answers a hover, not a sync.
list.addEventListener('animationstart', (event) => {
  if (event.animationName === 'cap-in' && performance.now() - renderedAt < 300) for (const run of event.target.parentElement.getAnimations({ subtree: true })) run.finish();
});
// Rows a sync brings into a list (keyed by list and PR) rise into place; the first paint, and rows that only moved, stay still.
let seenRows = null;
function riseNewRows() {
  const rows = [...list.querySelectorAll('.column .pr')];
  const key = (row) => `${row.closest('.column').dataset.tab}|${row.dataset.key}`;
  const fresh = seenRows ? rows.filter((row) => !seenRows.has(key(row)) && row.offsetParent) : [];
  seenRows = new Set(rows.map(key));
  rise(fresh);
}

// Right-click on a card: a small menu instead of the native one, the same in Arc and in Sidak's WKWebView.
// A popover, so Esc and a click elsewhere close it; its links open like the card does.
const menu = document.getElementById('menu');
let menuPr;
function openMenu(event, pr) {
  event.preventDefault();
  menuPr = pr;
  menu.querySelector('[data-do="files"]').href = `${pr.url}/files`;
  menu.querySelector('[data-do="checks"]').href = `${pr.url}/checks`;
  menu.querySelector('[data-do="branch"]').disabled = !pr.branch;
  menu.showPopover();
  // Under the pointer, clear of the rounded corner (outside it for hit tests): on macOS the menu opens on mousedown,
  // and a mouseup outside it would light-dismiss it at once.
  menu.style.left = `${Math.min(event.clientX - 8, innerWidth - menu.offsetWidth - 4)}px`;
  menu.style.top = `${Math.min(event.clientY - 8, innerHeight - menu.offsetHeight - 4)}px`;
  // Tab and Enter work from here; closing the popover hands focus back to the card.
  menu.querySelector('[data-do]').focus();
}
menu.onclick = ({ target }) => {
  const action = target.closest('[data-do]')?.dataset.do;
  if (!action) return;
  menu.hidePopover();
  if (action === 'branch' || action === 'link') copyText(action === 'branch' ? menuPr.branch : menuPr.url);
  // The opener runs Zed on the PR's review worktree, else on the checkout.
  if (action !== 'zed') return;
  chrome.runtime.sendNativeMessage('com.sidak.host', { url: `ccopen://${repoOf(menuPr)}/${menuPr.number}` }, (reply) => {
    const error = chrome.runtime.lastError?.message ?? (reply?.ok ? null : reply?.error ?? 'no reply');
    if (error) alert(`Could not open Zed:\n${error}\nCheck that the zed CLI is installed (zed: install cli in Zed), then try again.`);
  });
};
// sidak:// is no secure context, so WKWebView may lack the Clipboard API: copy from a selected textarea there.
function copyText(text) {
  if (navigator.clipboard) return navigator.clipboard.writeText(text).catch((error) => alert(`Could not copy:\n${error}`));
  const box = el('textarea', { value: text });
  document.body.append(box);
  box.select();
  document.execCommand('copy');
  box.remove();
}

// Bookmark syncs fire dozens of events at once, so batch them into one render.
let pending;
function rerender() {
  clearTimeout(pending);
  pending = setTimeout(render, 50);
}

refresh.onclick = () => {
  refresh.classList.add('spinning');
  chrome.storage.local.set({ syncRequest: Date.now() });
};
// Keys: 1–9 switch spaces when there are any, else the current profile's tabs; Tab or ⌘← / ⌘→ switch Inbox / Mine; j/k move between cards,
// d deep-reviews the focused card, s skims it; on my own card f fixes, n nudges, m merges, r marks it ready; o opens its cmux workspace,
// Enter opens the PR (native link), x shows the stale fold, h snoozes the card for a day (again: unsnooze), R (shift) syncs, p pins the board (Sidak.app).
document.addEventListener('keydown', (event) => {
  const editing = event.target.matches('input, select, textarea');
  const help = document.getElementById('help');
  // Esc folds the settings card away from anywhere but the search field, whose own Esc clears it.
  if (event.key === 'Escape' && !settingsFold.hidden && event.target !== search && !help.open) {
    toggleSettings(false);
    return picksButton.focus();
  }
  // ⌘← / ⌘→ pick a profile the way a swipe does: left the Inbox, right Mine.
  if (event.metaKey && !editing && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
    event.preventDefault();
    return setView(event.key === 'ArrowLeft' ? 'inbox' : 'mine');
  }
  if (event.metaKey || event.ctrlKey || event.altKey || editing) return;
  if (event.key === '?') return help.open ? help.close() : help.showModal();
  if (event.key === '/') {
    event.preventDefault();
    return search.focus();
  }
  if (help.open) return;
  if (/^[1-9]$/.test(event.key)) {
    const tabs = [...tabsBar.children].filter((button) => button.dataset.group === document.body.dataset.view);
    (nav.children.length ? [...nav.children] : tabs)[event.key - 1]?.click();
    return;
  }
  // Visible rows without a layout read per row: the active tab's cards, or every column of the profile while searching or in the wide layout,
  // minus closed stale folds.
  const wide = matchMedia('(min-width: 760px)').matches || list.querySelector('.board[data-searching]');
  const scope = wide ? `.column[data-group="${document.body.dataset.view}"]` : '.column:is(.active, .also)';
  const rows = [...list.querySelectorAll(`${scope} .pr:not([hidden])`)].filter((row) => !row.closest('details.stale:not([open])'));
  const index = rows.indexOf(document.activeElement);
  const actions = {
    j: () => rows[Math.min(index + 1, rows.length - 1)]?.focus(),
    k: () => rows[Math.max(index - 1, 0)]?.focus(),
    d: () => rows[index]?.querySelector('.review[data-depth="full"]')?.click(),
    s: () => rows[index]?.querySelector('.review[data-depth="quick"]')?.click(),
    o: () => rows[index]?.querySelector('.claude')?.click(),
    f: () => rows[index]?.querySelector('.review[data-depth="fix"]')?.click(),
    n: () => rows[index]?.querySelector('.review[data-depth="nudge"]')?.click(),
    m: () => rows[index]?.querySelector('.review[data-depth="merge"]')?.click(),
    r: () => rows[index]?.querySelector('.review[data-depth="ready"]')?.click(),
    x: () => list.querySelector('.column.active details.stale')?.toggleAttribute('open'),
    h: () => toggleSnooze(rows[index]?.dataset.key),
    R: () => refresh.click(),
    p: () => pinButton.click(),
    Tab: () => setView(document.body.dataset.view === 'mine' ? 'inbox' : 'mine'),
  };
  if (actions[event.key]) {
    event.preventDefault();
    actions[event.key]();
  }
});
// Profile: Inbox (reviewing, the pipeline behind the tabs) or Mine (my own PRs, blockers first), from the round switch, Tab,
// ⌘← / ⌘→ or a sideways swipe; the header follows it. #inbox / #mine in the URL still pick one; the last profile is kept like the tab.
const profileSwitch = document.getElementById('view');
// config.login's initial, covered by its avatar: 128 px for the 26 px disc on a retina screen. render() redraws it once config.json is read.
const me = profileSwitch.querySelector('.me');
function showMe() {
  if (me.dataset.login === config.login) return;
  me.dataset.login = config.login;
  const img = el('img', { src: `https://github.com/${config.login}.png?size=128`, alt: '' });
  img.onerror = () => img.remove();
  me.replaceChildren(config.login.slice(0, 1).toUpperCase(), img);
}
showMe();
// A red dot on the inbox tray while my own PRs need me (Needs me has rows); the tooltip counts the other profile's work.
const viewCount = document.getElementById('view-count');
let counts = { inbox: 0, mine: 0 };
function labelSwitch() {
  const [other, name] = document.body.dataset.view === 'mine' ? ['inbox', 'Inbox'] : ['mine', 'Mine'];
  profileSwitch.title = `Switch to ${name} (${counts[other]}) · Tab`;
  viewCount.hidden = !(other === 'mine' && counts.mine > 0);
  profileSwitch.setAttribute('aria-label', `Switch to ${name}${viewCount.hidden ? '' : `, ${counts.mine} need${counts.mine === 1 ? 's' : ''} you`}`);
}
let booted = false;
function setView(view) {
  if (view !== 'inbox' && view !== 'mine') return;
  // The switch flips a half turn on a profile change (not on load), the new face turning in.
  if (booted && document.body.dataset.view !== view) play(profileSwitch, [{ transform: 'perspective(240px) rotateY(180deg)' }, { transform: 'perspective(240px) rotateY(0deg)' }]);
  save('view', view);
  // The URL carries the profile, so #inbox / #mine deep-link and the app's hash handling stays in step.
  if (location.hash.slice(1) !== view) history.replaceState(null, '', `#${view}`);
  document.body.dataset.view = view;
  search.placeholder = view === 'mine' ? 'Search my pull requests…' : 'Search title, #number or author…';
  labelSwitch();
  markActive();
}
profileSwitch.onclick = () => setView(document.body.dataset.view === 'mine' ? 'inbox' : 'mine');
// Pin (Sidak.app only): asks the app to float the board as a window (sidakpin://1) or put it back in the popover (sidakpin://0).
// The app owns the state, it sets data-pinned after each change (dragging the board off or closing it changes it too),
// so the button shows that attribute rather than its own clicks.
const pinButton = document.getElementById('pin');
// Turning pinned, the button gives a short bounce (the spring's overshoot from 0.8).
let pinShown = null;
function showPin() {
  const pinned = document.documentElement.dataset.pinned === '1';
  pinButton.setAttribute('aria-pressed', pinned);
  if (pinned && pinShown === false) play(pinButton, [{ transform: 'scale(0.8)' }, {}]);
  pinShown = pinned;
}
pinButton.onclick = () => {
  if (!document.documentElement.dataset.app) return;
  const pinned = document.documentElement.dataset.pinned === '1';
  chrome.runtime.sendNativeMessage('com.sidak.host', { url: `sidakpin://${pinned ? 0 : 1}` }, () => {});
};
new MutationObserver(showPin).observe(document.documentElement, { attributes: true, attributeFilter: ['data-pinned'] });
showPin();
setView(saved('view', 'inbox'));
setView(location.hash.slice(1));
booted = true;
addEventListener('hashchange', () => setView(location.hash.slice(1)));
// Two-finger swipe, by direction like ⌘← / ⌘→: a swipe left (deltaX > 0 with natural scrolling) lands on the Inbox (reviewer),
// a swipe right on Mine (author). One switch per gesture, so 400 ms of quiet re-arms it.
let swipe = 0, swipeTimer, swiped = false;
addEventListener('wheel', ({ deltaX, deltaY }) => {
  // Trackpad wheel events come in small steps: sum the sideways travel over the gesture; 300 ms of quiet ends it.
  clearTimeout(swipeTimer);
  swipeTimer = setTimeout(() => { swipe = 0; swiped = false; }, 300);
  if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
  swipe += deltaX;
  if (swiped || Math.abs(swipe) < 60) return;
  swiped = true;
  setView(swipe > 0 ? 'inbox' : 'mine');
}, { passive: true });
// Sidak.app sizes its popover to the page: after a render or any size change the height goes through the bridge, 50 ms after the last.
// Only there (shim.js sets data-app); Arc never sends it.
// An explicit height (the settings card about to unfold) goes at once.
let heightTimer;
function sendHeight(height) {
  if (!document.documentElement.dataset.app) return;
  clearTimeout(heightTimer);
  const send = (px) => chrome.runtime.sendNativeMessage('com.sidak.host', { url: `sidakheight://${Math.ceil(px)}` }, () => {});
  if (height) return send(height);
  heightTimer = setTimeout(() => send(document.body.scrollHeight), 50);
}
// The header and footer turn to toolbar glass while the list runs under them.
function edges() {
  const root = document.documentElement;
  root.toggleAttribute('data-scrolled', scrollY > 0);
  root.toggleAttribute('data-more', scrollY + innerHeight < root.scrollHeight - 1);
}
addEventListener('scroll', edges, { passive: true });
addEventListener('resize', edges);
new ResizeObserver(() => {
  edges();
  sendHeight();
}).observe(document.body);
render();
// Skip our own sync request, so the spinner keeps going until the sync result lands.
chrome.storage.onChanged.addListener((changes) => !changes.syncRequest && rerender());
for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) chrome.bookmarks[event].addListener(rerender);

// Dev hook: opening panel.html#reload reloads the unpacked extension (manifest changes need it).
if (location.hash === '#reload') chrome.runtime.reload();
