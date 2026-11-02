// Arc-style sidebar: a switcher over the folders inside the "Spaces" bookmark folder,
// with the PR lists background.js syncs shown inside the space named like config.org (any case), like Arc's live folders.
const ROOT = 'Spaces';
// Repo from the PR url: stored sections from before a sync may lack repoFull.
const repoOf = (pr) => new URL(pr.url).pathname.split('/').slice(1, 3).join('/');
// One accent per space, picked by position, like Arc's space colours.
const ACCENTS = ['#5b8def', '#9b6bf2', '#2fb37a', '#f08c38', '#e5609a', '#3bb3c9'];

const nav = document.getElementById('spaces');
const list = document.getElementById('list');
// Hover in script (panel.html data-hot): the card under the pointer, cleared when the pointer leaves the list.
let hot = null;
list.addEventListener('mouseover', ({ target }) => {
  // A phone's tap fires mouseover too and would leave its card lit; the phone has :active instead.
  if (document.documentElement.hasAttribute('data-remote')) return;
  const row = target.closest('.pr');
  if (row === hot) return;
  hot?.removeAttribute('data-hot');
  hot = row;
  hot?.setAttribute('data-hot', '');
});
list.addEventListener('mouseleave', () => {
  hot?.removeAttribute('data-hot');
  hot = null;
});
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
const REVIEW_LABELS = { APPROVED: 'Approved', CHANGES_REQUESTED: 'Changes', REVIEW_REQUIRED: '', DRAFT: 'Draft' };
// The one button on my own PR, by authorState().action: [label, tooltip, key]. The opener runs ccfix / ccnudge / ccmerge / ccready.
const AUTHOR_ACTIONS = {
  fix: ['Fix', 'Fix in cmux: address review threads, failing checks and conflicts, push, re-request review', 'f'],
  nudge: ['Nudge', 'Re-request review from everyone still pending', 'n'],
  merge: ['Merge', 'Squash-merge and delete the branch', 'm'],
  ready: ['Mark Ready', 'Mark ready for review', 'r'],
};
// Only failing checks get a glyph: passing or running ones ask nothing of me.
const CHECKS = { FAILURE: 'Checks failed', ERROR: 'Checks errored' };
// state.json verdict (claude-review): the state of my posted review, as [status word, its colour's data-state].
// Reviewers on a card: who and how, in each avatar's ring and tooltip; three faces, then +n.
const REVIEWER_LABELS = { APPROVED: 'approved', CHANGES_REQUESTED: 'requested changes', PENDING: 'review pending' };
const MAX_AVATARS = 3;
const VERDICTS = { approved: ['Approved', 'APPROVED'], changes: ['Changes', 'CHANGES_REQUESTED'], commented: ['Commented', 'COMMENTED'] };
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
// Settings: the footer's words raise a card over the bottom of the list, which blurs behind it (data-settings); Esc or a tap on
// the list lowers it again. It rises 12 px from the footer as it fades in, and sinks back the same way.
const settingsCard = document.getElementById('settings');
const settingsFold = document.getElementById('settings-fold');
const SHEET = [{ opacity: 0, transform: 'translateY(12px) scale(0.98)' }, {}];
let folding = null;
function toggleSettings(open = settingsFold.hidden) {
  if (!folding && settingsFold.hidden === !open) return;
  for (const pick of footConfig.children) pick.ariaExpanded = open;
  document.documentElement.toggleAttribute('data-settings', open);
  folding?.cancel();
  settingsFold.hidden = false;
  // While it is open the page is at least header, card and footer tall, so Sidak.app's popover has room for it over a short list.
  const sheet = document.querySelector('header').offsetHeight + settingsCard.offsetHeight + document.getElementById('foot').offsetHeight + 8;
  if (open) document.body.style.setProperty('--sheet', `${sheet}px`);
  const done = () => {
    folding = null;
    settingsFold.hidden = !open;
    if (!open) document.body.style.removeProperty('--sheet');
  };
  // Sidak.app grows its popover now, not after the spring.
  if (open) sendHeight(document.body.scrollHeight);
  folding = play(settingsCard, open ? SHEET : [...SHEET].reverse(), open ? {} : { duration: parseFloat(token('--lg-duration-fast')), easing: 'ease-in' });
  if (!folding) return done();
  folding.onfinish = done;
}
// The list takes no pointer while the card is up (panel.html), so a tap there lands on the page: anywhere outside the header and
// the footer lowers the card.
document.addEventListener('click', (event) => {
  if (settingsFold.hidden || event.target.closest('header, #foot')) return;
  event.preventDefault();
  event.stopPropagation();
  toggleSettings(false);
}, true);
for (const seg of document.querySelectorAll('#settings .seg[data-key]')) {
  const key = seg.dataset.key;
  const show = () => {
    for (const button of seg.children) button.setAttribute('aria-pressed', button.value === picks[key]);
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
const DEFAULT_SETTINGS = { staleDays: 30, vip: [], auto: { on: false }, snooze: {}, pollMinutes: 2, autoCap: 0 };
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
// Ignore (right-click) snoozes for good: the last time a Date holds, so pr-board's count and auto skip it like any snooze, and
// Stop Ignoring (or h) brings it back.
const IGNORED = 8.64e15;
function toggleSnooze(key, until = Date.now() + 86400000) {
  if (!key) return;
  const now = Date.now();
  const snooze = Object.fromEntries(Object.entries(settings.snooze ?? {}).filter(([k, at]) => k !== key && at > now));
  if (!(settings.snooze?.[key] > now)) snooze[key] = until;
  saveSettings({ snooze });
}
// Refresh every, Hide after (the stale cut-off) and the VIP list sit in the settings card under model and effort.
const pollSeg = document.querySelector('#settings [data-setting="pollMinutes"]');
const staleSeg = document.querySelector('#settings [data-setting="staleDays"]');
const capBox = document.getElementById('auto-cap');
const quietSeg = document.querySelector('#settings [data-setting="quiet"]');
// Quiet hours, as pr-board auto reads them: nights 22:00-08:00, week adds the weekend.
function quietNow(now = new Date()) {
  const night = now.getHours() >= 22 || now.getHours() < 8;
  return (['night', 'week'].includes(settings.quiet) && night) || (settings.quiet === 'week' && [0, 6].includes(now.getDay()));
}
const vipBox = document.getElementById('vip');
const vipList = document.getElementById('vip-list');
const vipPeople = document.getElementById('vip-people');
// Auto review: Sidak.app's timer runs pr-board auto, which reads auto.on and the picks; the footer says Auto while on.
const autoSeg = document.querySelector('#settings [data-setting="auto"]');
// Claude profile: the opener reads it from settings.json and starts claude-review with that config.profiles entry's CLAUDE_CONFIG_DIR.
const profileSeg = document.querySelector('#settings [data-setting="profile"]');
// Phone access: shown once config.json names the Access team, since the tunnel needs it.
const phoneSeg = document.querySelector('#settings [data-setting="phone"]');
const phoneOn = () => Boolean(config.remote?.team) && settings.phone !== false;
// The footer names what a click runs, in the pickers' words, as plain words that open and close the settings card above them: the
// profile always (its account pays), Auto only while auto review is on. Set-once settings (sync interval, stale cut-off) stay in the card.
// The sync status (#status, the last sync's time beside the refresh button) follows it. Every render refreshes it, and settings, picks and syncs all end in one.
const footConfig = document.getElementById('foot-config');
const used = document.getElementById('used');
// Today's reviews from state.json (render): their tokens for the footer, and auto's runs against settings.json autoCap (0: no limit).
// ponytail: state.json keeps one run per PR, so a PR reviewed twice today counts once; a usage log if that ever matters.
let today = { tokens: 0, cached: 0, auto: 0 };
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumSignificantDigits: 3 });
function countToday(state) {
  const midnight = new Date().setHours(0, 0, 0, 0) / 1000;
  const runs = Object.values(state).filter((entry) => (entry.run ?? 0) >= midnight);
  today = {
    tokens: runs.reduce((sum, entry) => sum + (entry.tokens ?? 0), 0),
    cached: runs.reduce((sum, entry) => sum + (entry.cached ?? 0), 0),
    auto: runs.filter((entry) => entry.auto).length,
  };
}
function renderFoot() {
  const label = (key) => document.querySelector(`#settings .seg[data-key="${key}"] button[value="${picks[key]}"]`)?.textContent ?? picks[key];
  const pick = (text, what) =>
    el('button', { type: 'button', className: 'pick', textContent: text, title: `${what}: settings`, ariaExpanded: !settingsFold.hidden, onclick: () => toggleSettings() });
  // A sign: an icon for a mode that is on (Auto, Phone), with its count when it has one; a tap opens the settings too.
  const sign = (iconId, what, text = '') => {
    const button = Object.assign(pick(text, what), { className: 'pick sign', ariaLabel: `${what}: settings` });
    button.prepend(icon(iconId));
    return button;
  };
  const profile = settings.profile || config.defaultProfile;
  // The settings chip: what a click runs with, profile · model · effort, in one capsule.
  footConfig.replaceChildren(...[
    Object.assign(pick([profile, label('model'), label('effort')].filter(Boolean).join(' · '), 'Profile, model and effort for new reviews'), { className: 'pick run' }),
    settings.auto?.on && (settings.autoCap
      ? sign('i-auto', `Auto review is on, ${today.auto} of its ${settings.autoCap} runs today used`, `${today.auto}/${settings.autoCap}`)
      : sign('i-auto', `Auto review is on, no daily limit (${today.auto} today)${quietNow() ? '; quiet hours now, nothing starts' : ''}`)),
    // Phone access on: so an open tunnel is never forgotten.
    phoneOn() && sign('i-phone', 'Phone access is on'),
  ].filter(Boolean));
  // Today's usage sits by the sync time, both muted on the right.
  Object.assign(used, {
    hidden: !today.tokens,
    textContent: compact.format(today.tokens),
    title: `Tokens today's reviews used: ${today.tokens.toLocaleString()} new, plus ${today.cached.toLocaleString()} cache reads`,
  });
}
function showSettings() {
  for (const button of pollSeg.children) button.setAttribute('aria-pressed', Number(button.value) === settings.pollMinutes);
  for (const button of staleSeg.children) button.setAttribute('aria-pressed', Number(button.value) === settings.staleDays);
  if (document.activeElement !== capBox) capBox.value = settings.autoCap || '';
  for (const button of quietSeg.children) button.setAttribute('aria-pressed', button.value === (settings.quiet ?? 'off'));
  const autoOn = Boolean(settings.auto?.on);
  for (const button of autoSeg.children) button.setAttribute('aria-pressed', (button.value === 'on') === autoOn);
  phoneSeg.parentElement.hidden = !config.remote?.team;
  for (const button of phoneSeg.children) button.setAttribute('aria-pressed', (button.value === 'on') === phoneOn());
  const names = Object.keys(config.profiles);
  if (names.join() !== [...profileSeg.children].map((button) => button.value).join()) {
    profileSeg.replaceChildren(...names.map((name) => el('button', { type: 'button', value: name, textContent: name })));
  }
  for (const button of profileSeg.children) button.setAttribute('aria-pressed', button.value === (settings.profile || config.defaultProfile));
  showVip();
  renderFoot();
}
pollSeg.onclick = ({ target }) => target.value && saveSettings({ pollMinutes: Number(target.value) });
staleSeg.onclick = ({ target }) => target.value && saveSettings({ staleDays: Number(target.value) });
// Auto per day: a whole number, empty or 0 for no limit; saved on Enter or leaving the field.
quietSeg.onclick = ({ target }) => target.value && saveSettings({ quiet: target.value });
capBox.onchange = () => saveSettings({ autoCap: Math.max(0, Math.floor(Number(capBox.value) || 0)) });
capBox.onkeydown = (event) => event.key === 'Enter' && capBox.blur();
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
// A pick from the suggestions adds at once; typing still waits for Enter.
vipBox.oninput = ({ inputType }) => (!inputType || inputType === 'insertReplacementText') && addVip();
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
  const img = el('img', { src: reviewer.avatarUrl, alt: label, title: label, width: 16, height: 16 });
  img.dataset.state = reviewer.state;
  return img;
}

// The cards whose TL;DR is open, kept across the re-render every sync does; ids tie each toggle to its block.
const openTldrs = new Set();
let tldrIds = 0;
// The card's status icon and its label, most pressing first: a run of Claude's (running, failed), else my own PR's blocker or wait
// (authorState icon and pill), else where the PR stands with me: back since my review, reviewed, or waiting for my review.
function statusMark(pr) {
  if (pr.claude === 'running') return ['i-play', `${pr.auto ? 'Auto review' : 'Review'} running (${pr.depth === 'full' ? 'Deep' : 'Skim'}): open in cmux (o)`];
  if (pr.claude === 'failed') return ['i-xcircle', 'Review failed: skim again (s)'];
  if (pr.mine) return [pr.next.icon, pr.next.pill[0].toUpperCase() + pr.next.pill.slice(1)];
  if (pr.followUp) return ['i-refresh', pr.followUp.why === 'requested' ? 'Re-requested your review' : 'New commits since your review'];
  if (pr.claude === 'reviewed') return ['i-done', VERDICTS[pr.verdict]?.[0] ?? 'Reviewed'];
  return ['i-eye', 'Waiting for your review'];
}

function prRow(pr) {
  const row = rowTemplate.cloneNode(true);
  row.href = pr.url;
  row.title = pr.title;
  row.dataset.state = pr.review;
  row.querySelector('.title').textContent = pr.title;
  row.querySelector('.time').textContent = ago(pr.updatedAt);
  // The meta line is one status word, then repo #n and author, 10 px apart (CSS), no separators. A VIP author gets a gold star in
  // front of the title.
  const info = row.querySelector('.info');
  const words = (...parts) => parts.filter(Boolean).map((text) => el('span', { textContent: text }));
  info.replaceChildren(...words(`${pr.repo} #${pr.number}`, pr.author));
  // The status word: Auto review on a review auto started that is still running, or why a PR is back since my review (both amber,
  // like its dot), else my verdict on one I reviewed, else its review state.
  // How and by whom it was reviewed goes in the tooltip.
  const live = pr.claude === 'running' && pr.auto ? 'Auto review' : { requested: 'Re-requested you', commits: 'New commits' }[pr.followUp?.why];
  const verdict = pr.claude === 'reviewed' ? VERDICTS[pr.verdict] : null;
  const state = row.querySelector('.state');
  state.textContent = live ?? verdict?.[0] ?? REVIEW_LABELS[pr.review];
  if (live) state.dataset.live = '';
  else if (verdict) state.dataset.state = verdict[1];
  const how = [pr.claude === 'reviewed' && pr.depth === 'quick' && 'quick review', pr.auto && 'auto'].filter(Boolean);
  if (how.length) state.title = [state.textContent, ...how].join(' · ');
  // A TL;DR (the top of the reviewer's handoff, which claude-review copies into state.json) turns the status word into its toggle:
  // What, Found and Next open under the card, Next being the live reason when the PR moved since. My own PRs show no status word.
  if (pr.claude === 'reviewed' && pr.tldr && !pr.mine) {
    const lines = new Map([...pr.tldr.matchAll(/^[-*]?[ \t]*(What|Found|Next):[ \t]*(.+)$/gm)].map(([, label, text]) => [label, text]));
    const next = { requested: 'Re-requested your review', commits: 'New commits since your review' }[pr.followUp?.why] ?? lines.get('Next');
    lines.delete('Next');
    if (next) lines.set('Next', next);
    const tldr = row.appendChild(el('div', { className: 'tldr', id: `tldr-${++tldrIds}` }));
    for (const [label, text] of lines) tldr.append(el('b', { textContent: label }), el('span', { textContent: text }));
    const toggle = el('button', { type: 'button', className: 'state', textContent: state.textContent, title: state.title });
    Object.assign(toggle.dataset, state.dataset);
    toggle.setAttribute('aria-controls', tldr.id);
    state.replaceWith(toggle);
    const key = `${repoOf(pr)}#${pr.number}`;
    const show = () => {
      toggle.setAttribute('aria-expanded', openTldrs.has(key));
      tldr.hidden = !openTldrs.has(key);
    };
    show();
    toggle.onclick = (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!openTldrs.delete(key)) openTldrs.add(key);
      show();
    };
  }
  // On the phone a tap (or a long press) opens the card's sheet instead of the PR: the buttons live there.
  const phone = document.documentElement.hasAttribute('data-remote');
  row.oncontextmenu = (event) => (phone ? (event.preventDefault(), openSheet(pr, row)) : openMenu(event, pr));
  if (phone) row.addEventListener('click', (event) => event.defaultPrevented || (event.preventDefault(), openSheet(pr, row)));
  row.draggable = false;
  const more = el('button', { type: 'button', className: 'more-menu', textContent: '⋯', ariaLabel: 'More: Zed, branch, files, checks, link, ignore' });
  more.onclick = (event) => {
    event.stopPropagation();
    openMenu(event, pr);
  };
  row.append(more);
  row.dataset.key = `${repoOf(pr)}#${pr.number}`;
  if (overdue(pr)) info.prepend(el('span', { className: 'overdue', textContent: `waiting ${ago(new Date(waitingSince(pr)).toISOString())}`, title: 'Waiting on you over a day' }));
  if (snoozedUntil(pr) >= IGNORED) info.append(...words('ignored'));
  else if (snoozedUntil(pr) > Date.now()) info.append(...words(`snoozed until ${new Date(snoozedUntil(pr)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`));


  // bin/claude-review-open focuses the PR's cmux workspace, or with a depth starts one with the picked model and effort.
  const openInCmux = (depth) => (event) => {
    event.preventDefault();
    const button = event.currentTarget;
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
      // Merge, Nudge and Mark ready are gh calls: only a run in cmux needs cmux.
      const gh = { merge: 'merge', nudge: 'nudge', ready: 'mark it ready' }[depth];
      if (error) alert(`Could not ${gh ?? 'start it'}:\n${error}${gh ? '' : '\nIs cmux running? Then try again.'}`);
      else if (gh) {
        // Say it worked on the button itself for a moment: the sync that follows changes nothing visible for a nudge.
        const done = { merge: 'Merging', nudge: 'Nudged', ready: 'Ready' }[depth];
        if (button?.firstChild?.nodeType === Node.TEXT_NODE) {
          const label = button.firstChild.data;
          button.firstChild.data = done;
          setTimeout(() => (button.firstChild.data = label), 2000);
        }
        refresh.click();
      }
    });
  };
  row.dataset.claude = pr.claude ?? '';
  // Back in the Inbox after my review: its dot says to review again.
  if (pr.followUp) row.dataset.follow = '';
  const claude = row.querySelector('.claude');
  // The status icon at the card's left (statusMark): running it opens cmux, failed it skims again, like s; any other click is the card's.
  // Badges on the icon's corners: a gold star for a VIP author (top), a red dot for failing checks (bottom; my own PRs' icon and
  // reason line already say so).
  const vip = isVip(pr, settings.vip);
  const red = (!pr.mine && CHECKS[pr.checks]) || '';
  const [iconId, mark] = statusMark(pr);
  const used = pr.tokens && `${compact.format(pr.tokens)} tokens`;
  const marks = [mark, vip && 'VIP author', red, used].filter(Boolean);
  claude.replaceChildren(icon(iconId), ...(vip ? [icon('i-star', 'vip')] : []), ...(red ? [el('span', { className: 'red' })] : []));
  claude.dataset.state = pr.claude ?? '';
  claude.title = marks.join(' · ');
  claude.ariaLabel = marks.join(', ');
  const skim = (event) => {
    event.preventDefault();
    row.querySelector('.review[data-depth="quick"]')?.click();
  };
  // On the phone a tap on the icon only says what it means, since there is no hover to show its tooltip, and a stray tap must never
  // start a review: Skim and Deep are the buttons right under it.
  const explain = (event) => {
    event.preventDefault();
    event.stopPropagation();
    // My own PR's icon says what it waits on in full (its reason line), not only the short word.
    const reason = pr.mine && pr.next?.reason;
    toast([reason ? reason[0].toUpperCase() + reason.slice(1) : mark, ...marks.slice(1)].join(' · '));
  };
  const remote = document.documentElement.hasAttribute('data-remote');
  claude.onclick = remote ? explain : pr.claude === 'failed' ? skim : pr.claude === 'running' ? openInCmux(null) : null;
  const actions = row.querySelector('.actions');
  if (pr.mine) {
    // My PR: the status icon says what it waits on (statusMark), the reason is the second line, the next step a button in front of
    // Skim / Deep (a self-check: claude-review writes the findings to a fix list instead of posting them).
    const { group, reason, action } = pr.next;
    // The status colour follows the group: red needs me, blue waiting, green ready, grey draft.
    row.dataset.group = group;
    // After a self-check the status word copies its fix list's path, to hand to Claude (Fix reads it by itself).
    const state = row.querySelector('.state');
    state.textContent = '';
    if (pr.report) {
      const copy = el('button', { type: 'button', className: 'state', textContent: 'Copy fix list', title: pr.report });
      copy.dataset.live = '';
      copy.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        copyText(pr.report);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy fix list'), 1500);
      };
      state.replaceWith(copy);
    }
    info.replaceChildren(...words(`${pr.repo} #${pr.number}`, ...reason.split(' · ')));
    const [label, tip, key] = AUTHOR_ACTIONS[action] ?? [];
    if (label) {
      const button = el('button', { className: `review ${action}`, type: 'button', textContent: label, title: tip, ariaKeyShortcuts: key });
      button.dataset.depth = action;
      button.append(el('kbd', { textContent: key, ariaHidden: 'true' }));
      // Auto self-checks new commits on my PR (pr-board auto); Nudge waits for that fix list, so reviewers see a checked head.
      if (action === 'nudge' && settings.auto?.on && pr.checkedSha && pr.head && pr.checkedSha !== pr.head) {
        button.disabled = true;
        button.title = 'Waits for Auto to self-check your new commits (10 minutes after the last push)';
      }
      actions.prepend(button);
    }
  }
  if (!config.reviewable.includes(repoOf(pr).split('/')[1]) || pr.claude === 'running') actions.remove();
  // How many buttons the card shows, for panel.html: WebKit misses :hover inside :has() on some rows, so no :has(.actions) there.
  else row.dataset.acts = actions.children.length;
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
function staleFold(prs, label = 'Stale', className = 'stale') {
  const details = el('details', { className });
  details.ontoggle = () => details.open && performance.now() - renderedAt > 100 && rise([...details.querySelectorAll(':scope > .pr:not([hidden])')]);
  const summary = el('summary');
  summary.append(el('span', { className: 'count', textContent: `${label} ${prs.length}` }));
  details.append(summary, ...prs.map(prRow));
  return details;
}

// Each profile keeps its own open tab: Inbox / Running / Reviewed, or To do / Waiting / Ready.
const openTab = { inbox: saved('tab', 'Inbox'), mine: saved('mineTab', 'To do') };
function showTab(title, group, dir = 0) {
  const moved = openTab[group] !== title;
  openTab[group] = title;
  save(group === 'mine' ? 'mineTab' : 'tab', title);
  markActive(moved);
  if (moved) slideIn(dir);
}
// The list now shown fades in over the fast duration; after a swipe it also slides in from the side the swipe went to (dir 1 or -1).
function slideIn(dir) {
  for (const section of list.querySelectorAll('.column:is(.active, .also)')) {
    play(section, [{ opacity: 0, transform: `translateX(${dir * 16}px)` }, {}], { duration: parseFloat(token('--lg-duration-fast')), easing: 'ease-out' });
  }
}
// Swipes page through all six tabs as one row, Inbox / Running / Reviewed then To do / Waiting / Ready: dir 1 the next tab, -1 the
// one before; past the end of one profile the next swipe turns to the other.
function stepTab(dir) {
  const strip = [...tabsBar.children];
  const view = document.body.dataset.view;
  const at = strip.findIndex((button) => button.dataset.group === view && button.value === openTab[view]);
  const next = at < 0 ? null : strip[at + dir];
  if (!next) return;
  if (next.dataset.group === view) return showTab(next.value, view, dir);
  openTab[next.dataset.group] = next.value;
  save(next.dataset.group === 'mine' ? 'mineTab' : 'tab', next.value);
  setView(next.dataset.group);
  slideIn(dir);
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
  // The phone's large title (panel.html #foot::before) is the open tab.
  document.getElementById('foot').dataset.title = tab;
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
    pr.report = entry?.report ?? null;
    // The head a self-check last read (claude-review's sha): newer commits on my PR wait for Auto's next one before a Nudge.
    pr.checkedSha = entry?.report ? entry.sha ?? null : null;
    pr.tokens = entry?.tokens ?? null;
    pr.followUp = followUp(pr, entry);
  }
  // The VIP field suggests everyone on these PRs, authors and reviewers, who is not a VIP yet.
  const people = new Set(all.flatMap((pr) => [pr.author, ...pr.reviewers.map((r) => r.login)]).filter(Boolean));
  const vips = new Set(settings.vip.map((v) => v.toLowerCase()));
  vipPeople.replaceChildren(...[...people].filter((login) => !vips.has(login.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' })).map((login) => el('option', { value: login })));
  // A snoozed PR (h, a day) folds away like a stale one, VIP or not.
  const stale = (pr) => snoozedUntil(pr) > now || (isStale(pr, settings.staleDays, now) && !isVip(pr, settings.vip));
  // A reviewed PR that moved since my review (followUp) is back in the Inbox; Reviewed keeps the rest, which wait on their author.
  const reviewed = all.filter((pr) => pr.claude === 'reviewed');
  const inbox = [...requested.filter((pr) => pr.claude !== 'running' && pr.claude !== 'reviewed'), ...reviewed.filter((pr) => pr.followUp)]
    .sort((a, b) => isVip(b, settings.vip) - isVip(a, settings.vip));
  const wrap = el('div', { className: 'board' });
  const mine = mineColumns(by.Mine ?? [], stale);
  wrap.append(
    ...nextStep(inbox.filter((pr) => !stale(pr)), (by.Mine ?? []).filter((pr) => !stale(pr))),
    column('Inbox', 'i-inbox', inbox.filter((pr) => !stale(pr)), 'inbox', inbox.filter(stale)),
    // My own PRs stay in Mine, a self-check running or done: their card there shows it.
    column('Running', 'i-play', all.filter((pr) => pr.claude === 'running' && pr.author)),
    reviewedColumn(reviewed.filter((pr) => !pr.followUp && pr.author)),
    ...mine,
  );
  return wrap;
}

// Reviewed: the ones the author still has to fix (changes asked, comments) first; my approvals under their own heading, waiting only on
// the author's merge.
function reviewedColumn(prs) {
  const approved = prs.filter((pr) => pr.verdict === 'approved');
  const section = column('Reviewed', 'i-done', prs.filter((pr) => pr.verdict !== 'approved'));
  if (approved.length) {
    const heading = el('h2');
    heading.append(el('span', { textContent: 'Approved' }), el('span', { className: 'count', textContent: approved.length }));
    section.append(heading, ...approved.map(prRow));
  }
  return section;
}

// How long an Inbox PR has waited on me: since it came back after my review, else since my latest request, else its last update.
// Over a day it is overdue: its card opens the meta line with the wait in amber, and the Next line counts them.
const DAY = 86400000;
const waitingSince = (pr) => pr.followUp?.since ?? Date.parse(pr.requestedAt ?? pr.updatedAt);
// One folded away (snoozed, ignored, or stale and not a VIP's) is put aside on purpose, so it is never overdue.
const overdue = (pr) => !pr.mine && pr.review !== 'DRAFT' && (!pr.claude || pr.claude === 'failed' || pr.followUp) && snoozedUntil(pr) <= Date.now()
  && !(isStale(pr, settings.staleDays) && !isVip(pr, settings.vip)) && Date.now() - waitingSince(pr) > DAY;

// Next: one line over every tab saying what to do now, a link to that PR. The Inbox PR waiting longest (VIPs first, no drafts), else my own PR
// that needs me most (mineColumns has ranked Mine); no line when both are clear.
function nextStep(inbox, mine) {
  const since = waitingSince;
  const review = inbox.filter((pr) => pr.review !== 'DRAFT').toSorted((a, b) => isVip(b, settings.vip) - isVip(a, settings.vip) || since(a) - since(b))[0];
  const fix = mine.find((pr) => pr.next.group === 'needs');
  const pr = review ?? fix;
  if (!pr) return [];
  const waited = review && ago(new Date(since(review)).toISOString());
  const what = review
    ? [review.followUp ? 'Review again' : 'Review', `by ${review.author}${waited === 'now' ? '' : `, waiting ${waited}`}`]
    : ['Fix', fix.next.pill];
  const link = el('a', { className: 'next', href: pr.url, target: '_blank', title: pr.title });
  // On the phone the Next card opens that PR's sheet, as its row does.
  link.onclick = (event) => {
    const row = document.documentElement.hasAttribute('data-remote') && [...list.querySelectorAll('.pr')].find((r) => r.href === pr.url);
    if (row) { event.preventDefault(); openSheet(pr, row); }
  };
  const late = inbox.filter(overdue).length;
  link.append(el('b', { textContent: 'Next' }), el('span', { textContent: `${what[0]} ${pr.repo}#${pr.number} ${what[1]}${late ? ` · ${late} waiting over a day` : ''}` }));
  return [link];
}

// Mine, one tab per authorState group (pr.js); worst blocker first, then oldest first.
const MINE_TABS = [['needs', 'To do', 'i-person'], ['waiting', 'Waiting', 'i-pr'], ['ready', 'Ready', 'i-done']];
// Waiting splits by what each PR waits on (authorState icon): asked reviewers, nobody asked yet, then checks on an approved one.
const WAITING_SECTIONS = [['i-hourglass', 'Awaiting reviewers'], ['i-person-add', 'No reviewers'], ['i-clock', 'Awaiting checks']];
function waitingColumn(title, iconId, prs, stale) {
  const groups = WAITING_SECTIONS.map(([id, label]) => [label, prs.filter((pr) => pr.next.icon === id)]).filter(([, rows]) => rows.length);
  const [[first, firstRows] = [title, []], ...rest] = groups;
  const section = column(title, iconId, firstRows, 'mine', stale);
  section.querySelector(':scope > h2 > span:not(.count)').textContent = first;
  // The stale fold stays last.
  const fold = section.querySelector(':scope > details.stale');
  for (const [label, rows] of rest) {
    const heading = el('h2');
    heading.append(el('span', { textContent: label }), el('span', { className: 'count', textContent: rows.length }));
    section.insertBefore(heading, fold);
    for (const row of rows.map(prRow)) section.insertBefore(row, fold);
  }
  return section;
}
function mineColumns(all, stale) {
  for (const pr of all) Object.assign(pr, { mine: true, next: authorState(pr) });
  all.sort((a, b) => a.next.rank - b.next.rank || Date.parse(a.updatedAt) - Date.parse(b.updatedAt));
  // A stack's parts leave their own tabs: the whole stack shows in its bottom PR's tab (the next to merge), stale or draft or not.
  const stacks = stacksOf(all);
  const stacked = new Set(stacks.flat());
  const prs = all.filter((pr) => !stacked.has(pr));
  const sections = MINE_TABS.map(([group, title, iconId]) => {
    // Drafts are mine to move too, so they fold at the end of To do (the stale fold class: search opens it), out of its count.
    const rows = prs.filter((pr) => pr.next.group === group || (group === 'needs' && pr.next.group === 'draft'));
    const fresh = rows.filter((pr) => !stale(pr));
    const cards = fresh.filter((pr) => pr.next.group !== 'draft');
    const section = group === 'waiting' ? waitingColumn(title, iconId, cards, rows.filter(stale)) : column(title, iconId, cards, 'mine', rows.filter(stale));
    const drafts = fresh.filter((pr) => pr.next.group === 'draft');
    if (drafts.length) section.insertBefore(staleFold(drafts, 'Drafts', 'stale drafts'), section.querySelector(':scope > details.stale'));
    return section;
  });
  for (const chain of stacks) {
    const section = sections[MINE_TABS.findIndex(([group]) => group === ({ draft: 'needs' }[chain[0].next.group] ?? chain[0].next.group))];
    // On top of the tab, its own heading over it; a tab that held nothing else loses its empty heading.
    if (section.querySelector(':scope > p.empty')?.remove() === undefined && !section.querySelector(':scope > .pr')) section.querySelector(':scope > h2').remove();
    section.prepend(stackBlock(chain));
  }
  return sections;
}

// Stacks: my PRs on each other's branches (a PR whose base is another's branch sits on it), as chains bottom → top of 2 or more.
// ponytail: one PR per branch; two PRs on the same base keep the last, a tree if stacks ever fork.
function stacksOf(prs) {
  const at = (pr, branch) => `${repoOf(pr)}:${branch}`;
  const byBranch = new Map(prs.map((pr) => [at(pr, pr.branch), pr]));
  const above = new Map(prs.filter((pr) => byBranch.has(at(pr, pr.base))).map((pr) => [byBranch.get(at(pr, pr.base)), pr]));
  return prs.filter((pr) => above.has(pr) && !byBranch.has(at(pr, pr.base))).map((bottom) => {
    const chain = [bottom];
    while (above.has(chain.at(-1))) chain.push(above.get(chain.at(-1)));
    return chain;
  });
}
// One stack: its cards bottom first, linked by a line through their icons (panel.html .stack), under a heading whose Merge stack
// merges the top PR, which on GitHub takes every open part under it along (merge-async, the opener's fallback for a stacked PR).
function stackBlock(chain) {
  const top = chain.at(-1);
  const ready = chain.every((pr) => pr.next.group === 'ready');
  const merge = el('button', {
    type: 'button',
    className: 'merge-stack',
    textContent: 'Merge stack',
    disabled: !ready,
    title: ready ? `Squash-merge all ${chain.length}, bottom first` : 'Merges once every part is approved with green checks',
  });
  merge.onclick = () => {
    if (!confirm(`Squash-merge the whole stack, ${chain.length} PRs from ${chain[0].repo} #${chain[0].number} up to #${top.number}?`)) return;
    chrome.runtime.sendNativeMessage('com.sidak.host', { url: `ccmerge://${repoOf(top)}/${top.number}` }, (reply) => {
      const error = chrome.runtime.lastError?.message ?? (reply?.ok ? null : reply?.error ?? 'no reply');
      if (error) alert(`Could not merge the stack:\n${error}`);
      else refresh.click();
    });
  };
  const heading = el('h2', { title: 'GitHub merges a stack from the bottom' });
  heading.append(el('span', { textContent: 'Stack' }), el('span', { className: 'count', textContent: chain.length }), merge);
  const block = el('div', { className: 'stack' });
  block.append(heading, ...chain.map(prRow));
  return block;
}

function bookmarkNode(node) {
  if (!node.url) {
    const children = node.children.map(bookmarkNode);
    return collapsible({ key: node.id, className: 'folder', iconId: 'i-folder', title: node.title, children });
  }
  const row = el('a', { className: 'link', href: node.url, target: '_blank', title: node.title });
  row.append(el('img', { src: favicon(node.url), alt: '', width: 16, height: 16 }), el('span', { textContent: node.title || node.url }));
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
  countToday(state);
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
  // Counts leave out the folded stale rows and drafts; the switch's Mine count is To do.
  const prsIn = (section) => section.querySelectorAll(':scope > .pr, :scope > .stack > .pr').length;
  tabsBar.replaceChildren(...columns.map((section) => tabButton(section.dataset.tab, prsIn(section), section.dataset.group)));
  const count = (tab) => prsIn(columns.find((section) => section.dataset.tab === tab) ?? el('section'));
  counts = { inbox: count('Inbox'), mine: count('To do') };
  labelSwitch();
  if (!columns.some((section) => section.dataset.tab === openTab.inbox)) openTab.inbox = 'Inbox';
  if (!columns.some((section) => section.dataset.tab === openTab.mine)) openTab.mine = 'To do';
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
  menu.querySelector('[data-do="ignore"]').textContent = snoozedUntil(pr) >= IGNORED ? 'Stop Ignoring' : 'Ignore';
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
  menuAction(action);
};
// One menu action on menuPr, from the card menu or the phone's sheet.
function menuAction(action) {
  if (action === 'branch' || action === 'link') {
    copyText(action === 'branch' ? menuPr.branch : menuPr.url);
    toast(action === 'branch' ? `Copied ${menuPr.branch}` : 'Copied the link');
  }
  // Ignoring an ignored PR, or one snoozed for the day, brings it back (toggleSnooze).
  if (action === 'ignore') toggleSnooze(`${repoOf(menuPr)}#${menuPr.number}`, IGNORED);
  // The opener runs Zed on the PR's review worktree, else on the checkout.
  if (action !== 'zed') return;
  chrome.runtime.sendNativeMessage('com.sidak.host', { url: `ccopen://${repoOf(menuPr)}/${menuPr.number}` }, (reply) => {
    const error = chrome.runtime.lastError?.message ?? (reply?.ok ? null : reply?.error ?? 'no reply');
    if (error) alert(`Could not open Zed:\n${error}\nCheck that the zed CLI is installed (zed: install cli in Zed), then try again.`);
  });
}

// The phone's card sheet (panel.html #sheet): the card's icon, title and meta, what it waits on, its TL;DR, Open PR, the card's own buttons
// (each tap runs the card's hidden button, so Skim / Deep / Fix / Nudge / Merge behave exactly as on the Mac), then the menu's actions.
const sheet = document.getElementById('sheet');
function openSheet(pr, row) {
  menuPr = pr;
  const icon = row.querySelector('.claude').cloneNode(true);
  icon.style.color = getComputedStyle(row.querySelector('.claude')).color; // the row's status colour, which lives on .pr
  const head = el('div', { className: 'sheet-head' });
  const meta = [...row.querySelectorAll('.info > span')].map((span) => span.textContent).join(' · ');
  const close = el('button', { type: 'button', className: 'sheet-close', ariaLabel: 'Close', onclick: () => sheet.close() });
  close.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  head.append(icon, el('p', { className: 'sheet-title', textContent: pr.title }), close, el('p', { className: 'sheet-meta', textContent: meta }));
  const tldr = row.querySelector('.tldr')?.cloneNode(true);
  if (tldr) tldr.hidden = false;
  const buttons = el('div', { className: 'sheet-buttons' });
  for (const button of row.querySelectorAll('.actions .review')) {
    const proxy = el('button', { type: 'button', className: button.className, textContent: button.firstChild.data, disabled: button.disabled, title: button.title });
    proxy.dataset.depth = button.dataset.depth;
    proxy.onclick = () => {
      sheet.close();
      button.click();
    };
    buttons.append(proxy);
  }
  const more = el('div', { className: 'sheet-more' });
  const act = (label, action) => Object.assign(el('button', { type: 'button', textContent: label }), { onclick: () => { sheet.close(); menuAction(action); } });
  more.append(
    ...(pr.branch ? [act('Copy Branch', 'branch')] : []), act('Copy Link', 'link'),
    el('a', { href: `${pr.url}/files`, target: '_blank', textContent: 'Files' }), el('a', { href: `${pr.url}/checks`, target: '_blank', textContent: 'Checks' }),
    Object.assign(act(snoozedUntil(pr) >= IGNORED ? 'Stop Ignoring' : 'Ignore', 'ignore'), { className: snoozedUntil(pr) >= IGNORED ? '' : 'danger' }),
  );
  sheet.replaceChildren(
    el('div', { className: 'sheet-grab' }), head, el('p', { className: 'sheet-why', textContent: icon.title }), ...(tldr ? [tldr] : []),
    el('a', { className: 'open', href: pr.url, target: '_blank', textContent: 'Open PR' }), ...(buttons.children.length ? [buttons] : []), more,
  );
  sheet.showModal();
}
// A tap above the sheet (on its backdrop) or a swipe down closes it; the sheet's own padding is the sheet, so it checks the spot.
sheet.addEventListener('click', ({ clientY }) => clientY < sheet.getBoundingClientRect().top && sheet.close());
let sheetTouch = null;
sheet.addEventListener('touchstart', ({ touches }) => { sheetTouch = sheet.scrollTop === 0 ? touches[0].clientY : null; }, { passive: true });
sheet.addEventListener('touchend', ({ changedTouches }) => { if (sheetTouch !== null && changedTouches[0].clientY - sheetTouch > 70) sheet.close(); }, { passive: true });
// A note for two seconds at the bottom: on the phone what a tapped status icon means (no hover there), and Copied after a copy.
const toastBox = document.body.appendChild(el('div', { id: 'toast', role: 'status' }));
function toast(text) {
  toastBox.textContent = text;
  toastBox.dataset.on = '';
  clearTimeout(toastBox.timer);
  toastBox.timer = setTimeout(() => delete toastBox.dataset.on, 3000);
}
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
// Help (?) has pages: Keys, Icons, Menu bar; its buttons or ← / → pick one.
const helpPages = document.getElementById('help-pages');
function showHelp(page) {
  for (const button of helpPages.children) button.ariaPressed = button.value === page;
  for (const section of document.querySelectorAll('#help [data-page]')) section.hidden = section.dataset.page !== page;
}
function stepHelp(dir) {
  const pages = [...helpPages.children];
  const at = pages.findIndex((button) => button.ariaPressed === 'true');
  showHelp(pages[(at + dir + pages.length) % pages.length].value);
}
helpPages.onclick = ({ target }) => target.value && showHelp(target.value);
// Keys: 1–9 switch spaces when there are any, else the current profile's tabs; Tab or ⌘← / ⌘→ switch Inbox / Mine; j/k move between cards,
// d deep-reviews the focused card, s skims it; on my own card f fixes, n nudges, m merges, r marks it ready; o opens its cmux workspace,
// Enter opens the PR (native link), x shows the stale fold, h snoozes the card for a day (again: unsnooze), R (shift) syncs, p pins the board (Sidak.app).
document.addEventListener('keydown', (event) => {
  const editing = event.target.matches('input, select, textarea');
  const help = document.getElementById('help');
  // Esc folds the settings card away from anywhere but the search field, whose own Esc clears it.
  if (event.key === 'Escape' && !settingsFold.hidden && event.target !== search && !help.open) {
    toggleSettings(false);
    return footConfig.firstChild?.focus();
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
  if (help.open) {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') stepHelp(event.key === 'ArrowRight' ? 1 : -1);
    return;
  }
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
    x: () => list.querySelector('.column.active details.stale:not(.drafts)')?.toggleAttribute('open'),
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
  const img = el('img', { src: `https://github.com/${config.login}.png?size=128`, alt: '', width: 30, height: 30 });
  img.onerror = () => img.remove();
  me.replaceChildren(config.login.slice(0, 1).toUpperCase(), img);
}
showMe();
// A red dot on the inbox tray while my own PRs need me (To do has rows); the tooltip counts the other profile's work.
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
// Two-finger swipe, paging like ← / →: fingers left (deltaX > 0 with natural scrolling) the next tab, right the one before (stepTab).
// One step per gesture, so 300 ms of quiet re-arms it.
let swipe = 0, swipeTimer, swiped = false;
addEventListener('wheel', ({ deltaX, deltaY }) => {
  // Trackpad wheel events come in small steps: sum the sideways travel over the gesture; 300 ms of quiet ends it.
  clearTimeout(swipeTimer);
  swipeTimer = setTimeout(() => { swipe = 0; swiped = false; }, 300);
  if (Math.abs(deltaX) <= Math.abs(deltaY)) return;
  swipe += deltaX;
  if (swiped || Math.abs(swipe) < 60) return;
  swiped = true;
  stepTab(swipe > 0 ? 1 : -1);
}, { passive: true });
// On a touch screen a sideways swipe does the same. A mostly vertical drag scrolls, and one that starts in a field is the field's.
let touch = null;
// On the phone a row takes its own swipes, like Mail's: right snoozes it until tomorrow (the capsule on the left), left skims it (an
// Inbox PR with Skim free).
// Past 90 px it is armed (panel.html .pr[data-armed]); a swipe that starts on a row never changes the tab.
const phoneUI = document.documentElement.hasAttribute('data-remote');
let rowSwipe = null, swallowClick = false;
addEventListener('touchstart', ({ touches, target }) => {
  const row = phoneUI && touches.length === 1 && target.closest('.pr');
  rowSwipe = row ? { row, x: touches[0].clientX, y: touches[0].clientY, dx: 0, on: false } : null;
  touch = !row && touches.length === 1 && !target.closest('input') ? { x: touches[0].clientX, y: touches[0].clientY } : null;
}, { passive: true });
addEventListener('touchmove', ({ touches: [t] }) => {
  const s = rowSwipe;
  if (!s) return;
  const dx = t.clientX - s.x, dy = t.clientY - s.y;
  if (!s.on) {
    if (Math.abs(dy) > 10) return (rowSwipe = null);
    if (Math.abs(dx) < 12) return;
    s.on = true;
  }
  const skim = s.row.querySelector('.review[data-depth="quick"]:not(:disabled)');
  s.dx = dx < 0 && !skim ? 0 : dx;
  // Past 120 px the row drags heavier, like iOS's rubber band; --dx sizes the glass capsule it uncovers (panel.html).
  const far = Math.abs(s.dx), shown = Math.sign(s.dx) * (far <= 120 ? far : 120 + (far - 120) * 0.35);
  s.row.style.transform = `translateX(${shown}px)`;
  s.row.style.setProperty('--dx', Math.abs(shown));
  s.row.dataset.swipe = s.dx < 0 ? 'left' : 'right';
  s.row.toggleAttribute('data-armed', Math.abs(s.dx) > 90);
}, { passive: true });
addEventListener('click', (event) => { if (swallowClick) { swallowClick = false; event.preventDefault(); event.stopPropagation(); } }, true);
addEventListener('touchend', ({ changedTouches: [end] }) => {
  if (rowSwipe?.on) {
    const { row, dx } = rowSwipe;
    rowSwipe = null;
    row.style.transform = '';
    delete row.dataset.swipe;
    row.removeAttribute('data-armed');
    // A snoozed row sits in the Stale fold (snoozed until … on its meta line); the same swipe there brings it back.
    if (dx > 90) {
      const was = (settings.snooze?.[row.dataset.key] ?? 0) > Date.now();
      toggleSnooze(row.dataset.key);
      toast(was ? 'Back from snooze' : 'Snoozed until tomorrow · it waits in Stale');
    }
    else if (dx < -90) row.querySelector('.review[data-depth="quick"]')?.click();
    // Then the tap iOS may send for the lift is not the row's (it would open the sheet).
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 400);
    return;
  }
  rowSwipe = null;
  if (!touch) return;
  const dx = end.clientX - touch.x, dy = end.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) stepTab(dx < 0 ? 1 : -1);
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
// A sync request (the refresh button, or Sidak.app opening the panel) spins the button until the sync's render.
chrome.storage.onChanged.addListener((changes) => (changes.syncRequest ? refresh.classList.add('spinning') : rerender()));
for (const event of ['onCreated', 'onRemoved', 'onChanged', 'onMoved']) chrome.bookmarks[event].addListener(rerender);

// Dev hook: opening panel.html#reload reloads the unpacked extension (manifest changes need it).
if (location.hash === '#reload') chrome.runtime.reload();
