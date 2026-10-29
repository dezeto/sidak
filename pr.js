// Flattens a GraphQL PullRequest into the shape panel.js renders. Shared with check.js.
function toPr(pr, viewer) {
  const reviewers = new Map();
  for (const { state, author } of pr.latestOpinionatedReviews.nodes) {
    if (author) reviewers.set(author.login, { ...author, state });
  }
  // An open request is the current state, even if that person reviewed before.
  for (const { requestedReviewer } of pr.reviewRequests.nodes) {
    if (requestedReviewer) reviewers.set(requestedReviewer.login, { ...requestedReviewer, state: 'PENDING' });
  }
  reviewers.delete(viewer);
  const author = pr.author?.login;
  const commit = pr.commits.nodes[0]?.commit;
  return {
    title: pr.title,
    url: pr.url,
    repo: pr.repository.name,
    repoFull: pr.repository.nameWithOwner,
    number: pr.number,
    updatedAt: pr.updatedAt,
    author: author && author !== viewer ? author : null,
    authorEmail: commit?.author?.email ?? null,
    review: reviewOf(pr),
    checks: commit?.statusCheckRollup?.state ?? null,
    reviewers: [...reviewers.values()],
    mergeable: pr.mergeable ?? null,
    branch: pr.headRefName ?? null,
    unresolved: (pr.reviewThreads?.nodes ?? []).filter((t) => !t.isResolved).length,
  };
}

// One of my own PRs in the author profile. group is its tab (needs, waiting, ready, draft) and rank its order, conflicts first and drafts last;
// pill is what the tab name does not say (the worst blocker +n for the rest, or who is awaited), null in Ready and Drafts;
// reason is the plain-words second line, action the one button (or null).
function authorState(pr, now = Date.now()) {
  const by = (state) => pr.reviewers.filter((r) => r.state === state).map((r) => r.login);
  const names = (logins) => logins.slice(0, 2).join(', ') + (logins.length > 2 ? ` +${logins.length - 2}` : '');
  const threads = `${pr.unresolved} thread${pr.unresolved === 1 ? '' : 's'}`;
  const days = Math.floor((now - Date.parse(pr.updatedAt)) / 86400000);
  const updated = `updated ${days >= 1 ? `${days} d ago` : 'today'}`;
  const approved = by('APPROVED').length ? `approved by ${names(by('APPROVED'))}` : 'approved';
  // [rank, pill, reason] per blocker, most severe first.
  const blockers = [
    pr.mergeable === 'CONFLICTING' && [0, 'conflicts', 'conflicts with the base branch'],
    (pr.checks === 'FAILURE' || pr.checks === 'ERROR') && [1, 'checks red', 'checks failing'],
    pr.review === 'CHANGES_REQUESTED' && [2, 'changes asked', `${names(by('CHANGES_REQUESTED')) || 'a reviewer'} asked for changes`],
    pr.unresolved > 0 && [3, threads, `${threads} open`],
  ].filter(Boolean);
  const reason = blockers.map(([, , text]) => text).join(' · ');
  if (pr.review === 'DRAFT') return { group: 'draft', rank: 6, pill: null, reason: reason || updated, action: 'ready' };
  if (blockers.length) {
    const [[rank, pill]] = blockers;
    return { group: 'needs', rank, pill: blockers.length > 1 ? `${pill} +${blockers.length - 1}` : pill, reason, action: 'fix' };
  }
  if (pr.review === 'APPROVED' && pr.checks === 'SUCCESS') return { group: 'ready', rank: 5, pill: null, reason: approved, action: 'merge' };
  if (pr.review === 'APPROVED') return { group: 'waiting', rank: 4, pill: 'awaiting checks', reason: approved, action: null };
  // Nudge re-requests whoever is still pending, so with nobody requested there is nothing to press.
  const pending = by('PENDING');
  return {
    group: 'waiting',
    rank: 4,
    pill: pending.length ? `awaiting ${names(pending)}` : 'no reviewers',
    reason: by('APPROVED').length ? approved : `no reviews yet, ${updated}`,
    action: pending.length ? 'nudge' : null,
  };
}

// Not updated for more than `days` days; 0 turns it off, and a PR without updatedAt is never stale.
function isStale(pr, days, now = Date.now()) {
  return days > 0 && Boolean(pr.updatedAt) && now - Date.parse(pr.updatedAt) > days * 86400000;
}

// Listed by GitHub login, or by the email on the PR's last commit; case does not matter.
function isVip(pr, vip) {
  const listed = new Set(vip.map((entry) => entry.toLowerCase()));
  return [pr.author, pr.authorEmail].some((id) => id && listed.has(id.toLowerCase()));
}

// Not named reviewState: Sidak.app loads background.js into the panel page, where panel.js's reviewState() would shadow it.
function reviewOf(pr) {
  if (pr.isDraft) return 'DRAFT';
  if (pr.reviewDecision) return pr.reviewDecision;
  // Repos without required reviews have no decision, so derive one from the reviews.
  const states = pr.latestOpinionatedReviews.nodes.map((review) => review.state);
  if (states.includes('CHANGES_REQUESTED')) return 'CHANGES_REQUESTED';
  return states.includes('APPROVED') ? 'APPROVED' : 'REVIEW_REQUIRED';
}

// token.txt holds the gh CLI token: `gh auth token > token.txt`
async function readToken() {
  const res = await fetch(chrome.runtime.getURL('token.txt')).catch(() => null);
  if (!res?.ok) throw new Error('token.txt missing, run: gh auth token > token.txt');
  return (await res.text()).trim();
}

if (typeof module === 'object') module.exports = { toPr, authorState, isStale, isVip };
