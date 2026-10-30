importScripts('pr.js');

const FOLDER = 'GitHub PRs';
const SECTIONS = [
  ['Requested', 'is:open is:pr archived:false review-requested:@me sort:updated-desc'],
  ['Mine', 'is:open is:pr archived:false author:@me sort:updated-desc'],
  ['Reviewed by me', 'is:open is:pr archived:false reviewed-by:@me sort:updated-desc'],
];
const QUERY = `query ($q: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50) {
    nodes {
      ... on PullRequest {
        title url number isDraft updatedAt reviewDecision mergeable headRefName headRefOid
        reviewThreads(first: 100) { nodes { isResolved } }
        repository { name nameWithOwner }
        author { login }
        latestOpinionatedReviews(first: 10) { nodes { state author { login avatarUrl(size: 40) } } }
        reviewRequests(first: 10) {
          nodes { requestedReviewer { ... on User { login avatarUrl(size: 40) } ... on Team { login: slug avatarUrl(size: 40) } } }
        }
        commits(last: 1) { nodes { commit { committedDate statusCheckRollup { state } author { email } } } }
        timelineItems(itemTypes: [REVIEW_REQUESTED_EVENT], last: 10) { nodes { ... on ReviewRequestedEvent { createdAt requestedReviewer { ... on User { login } } } } }
      }
    }
  }
}`;

chrome.runtime.onInstalled.addListener(start);
chrome.runtime.onStartup.addListener(start);
chrome.alarms.onAlarm.addListener(sync);
// The panel's refresh button writes syncRequest; storage events also wake a sleeping worker.
chrome.storage.onChanged.addListener((changes) => changes.syncRequest && sync());
function start() {
  // Arc has no side panel, there panel.html runs as a pinned tab instead.
  chrome.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true });
  // Alarms may be cleared on browser restart, so recreate on every startup.
  chrome.alarms.create('sync', { periodInMinutes: 5 });
  sync();
}

// Serialize runs: two overlapping syncs would both create the folder.
let queue = Promise.resolve();
function sync() {
  queue = queue.then(run).catch(console.error);
}

async function run() {
  try {
    const token = await readToken();
    // Fetch everything before writing, so a failed request keeps the last list.
    const sections = [];
    for (const [title, q] of SECTIONS) {
      const { viewer, search } = await graphql(token, q);
      sections.push({ title, prs: search.nodes.map((pr) => toPr(pr, viewer.login)) });
    }
    // Timestamps always change, so every sync fires storage.onChanged for the panel.
    await chrome.storage.local.set({ sections, syncedAt: Date.now(), syncError: null });
    // The bookmark copy is a convenience (Arc does not show it), so it never fails the sync.
    await syncBookmarks(sections).catch(console.warn);
  } catch (e) {
    await chrome.storage.local.set({ syncError: String(e), failedAt: Date.now() });
  }
}

async function graphql(token, q) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: QUERY, variables: { q } }),
  });
  const body = await res.json();
  if (!res.ok || body.errors) throw new Error(`GitHub ${res.status}: ${body.message ?? body.errors[0].message}`);
  return body.data;
}

async function syncBookmarks(sections) {
  const bar = (await chrome.bookmarks.getTree())[0].children[0];
  const root = await folder(bar.id, FOLDER);
  for (const { title, prs } of sections) {
    const want = prs.map((pr) => ({ title: pr.title, url: pr.url }));
    const sub = await folder(root.id, title);
    const have = await chrome.bookmarks.getChildren(sub.id);
    if (same(have, want)) continue;
    // ponytail: wipe and refill, diff by URL if the reorder ever bothers you
    for (const b of have) await chrome.bookmarks.removeTree(b.id);
    for (const b of want) await chrome.bookmarks.create({ parentId: sub.id, ...b });
  }
}

async function folder(parentId, title) {
  const found = (await chrome.bookmarks.getChildren(parentId)).find((b) => !b.url && b.title === title);
  return found ?? chrome.bookmarks.create({ parentId, title });
}

function same(have, want) {
  const key = (list) => JSON.stringify(list.map((b) => [b.title, b.url]));
  return key(have) === key(want);
}
