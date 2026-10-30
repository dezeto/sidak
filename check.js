// Run: node check.js
const assert = require('node:assert/strict');
const { toPr, authorState, isStale, isVip, followUp } = require('./pr.js');

const user = (login) => ({ login, avatarUrl: `https://avatars.example/${login}` });
const review = (state, login) => ({ state, author: user(login) });
const pr = (overrides) =>
  toPr(
    {
      title: 'feat: x',
      url: 'https://github.com/o/crm/pull/1',
      number: 1,
      updatedAt: '2026-10-20T00:00:00Z',
      repository: { name: 'crm', nameWithOwner: 'o/crm' },
      author: user('me'),
      isDraft: false,
      reviewDecision: null,
      latestOpinionatedReviews: { nodes: [] },
      reviewRequests: { nodes: [] },
      commits: { nodes: [] },
      mergeable: 'MERGEABLE',
      headRefName: 'feat/x',
      reviewThreads: { nodes: [] },
      ...overrides,
    },
    'me',
  );

assert.equal(pr({}).review, 'REVIEW_REQUIRED');
assert.equal(pr({ isDraft: true, reviewDecision: 'APPROVED' }).review, 'DRAFT');
assert.equal(pr({ reviewDecision: 'CHANGES_REQUESTED' }).review, 'CHANGES_REQUESTED');
assert.equal(pr({ latestOpinionatedReviews: { nodes: [review('APPROVED', 'a')] } }).review, 'APPROVED');
assert.equal(
  pr({ latestOpinionatedReviews: { nodes: [review('APPROVED', 'a'), review('CHANGES_REQUESTED', 'b')] } }).review,
  'CHANGES_REQUESTED',
);

const rerequested = pr({
  latestOpinionatedReviews: { nodes: [review('APPROVED', 'a'), review('APPROVED', 'b')] },
  reviewRequests: { nodes: [{ requestedReviewer: user('a') }, { requestedReviewer: user('me') }, { requestedReviewer: null }] },
});
assert.deepEqual(
  rerequested.reviewers.map((r) => [r.login, r.state]),
  [['a', 'PENDING'], ['b', 'APPROVED']],
);

assert.equal(pr({}).author, null);
assert.equal(pr({ author: user('someone') }).author, 'someone');
assert.equal(pr({ author: null }).author, null);
assert.equal(pr({}).checks, null);
assert.equal(pr({ commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } }).checks, 'FAILURE');
assert.equal(pr({}).repoFull, 'o/crm');

// Reviewed: a follow-up once the PR moved after my review
const at = Date.parse('2026-10-20T00:00:00Z');
const later = { nodes: [{ commit: { committedDate: '2026-10-21T00:00:00Z' } }] };
const asked = (login, createdAt) => ({ timelineItems: { nodes: [{ createdAt, requestedReviewer: user(login) }] } });
const mine = { state: 'reviewed', at, sha: 'a', verdict: 'changes' };
const why = (overrides, entry = mine) => followUp(pr({ headRefOid: 'a', ...overrides }), entry)?.why ?? null;
assert.equal(why({}), null);
assert.equal(why({ headRefOid: 'b', commits: later }), 'commits');
assert.equal(why({ headRefOid: 'b', commits: later }, { ...mine, verdict: 'approved' }), null); // after my approval a push is theirs to merge
assert.equal(why(asked('me', '2026-10-21T00:00:00Z')), 'requested');
assert.equal(why(asked('me', '2026-10-21T00:00:00Z'), { ...mine, verdict: 'approved' }), 'requested');
assert.equal(why(asked('me', '2026-10-19T00:00:00Z')), null); // the request this review answered
assert.equal(why(asked('a', '2026-10-21T00:00:00Z')), null);
assert.equal(why({ commits: later }, { state: 'reviewed', at }), 'commits'); // no sha recorded: the commit date stands in
assert.equal(why({ headRefOid: 'b', commits: later }, { ...mine, state: 'running' }), null);
assert.equal(followUp(pr({}), undefined), null);

// Mine: what each of my PRs needs next
const green = { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'SUCCESS' } } }] } };
const red = { commits: { nodes: [{ commit: { statusCheckRollup: { state: 'FAILURE' } } }] } };
const group = (overrides) => authorState(pr(overrides)).group;
assert.equal(group({}), 'waiting');
assert.equal(group({ ...green, reviewDecision: 'APPROVED' }), 'ready');
assert.equal(group({ reviewDecision: 'APPROVED' }), 'waiting'); // no green checks yet
assert.equal(group({ ...green, reviewDecision: 'APPROVED', reviewThreads: { nodes: [{ isResolved: false }] } }), 'needs');
assert.equal(group({ reviewDecision: 'CHANGES_REQUESTED' }), 'needs');
assert.equal(group({ isDraft: true, mergeable: 'CONFLICTING' }), 'draft');
assert.equal(group({ mergeable: 'CONFLICTING' }), 'needs');
assert.equal(group(red), 'needs');
assert.equal(pr({ reviewThreads: { nodes: [{ isResolved: false }, { isResolved: true }] } }).unresolved, 1);
assert.equal(pr({ reviewThreads: undefined }).unresolved, 0); // sections stored before this field existed

const day = 86400000;
const updated = Date.parse('2026-10-20T00:00:00Z'); // the fixture's updatedAt
const state = (overrides) => authorState(pr(overrides), updated + 2 * day);
const twoThreads = { reviewThreads: { nodes: [{ isResolved: false }, { isResolved: false }] } };
assert.deepEqual(state({ mergeable: 'CONFLICTING', ...red, ...twoThreads }), {
  group: 'needs', rank: 0, pill: 'conflicts +2', reason: 'conflicts with the base branch · checks failing · 2 threads open', action: 'fix',
});
assert.deepEqual(state({ reviewDecision: 'CHANGES_REQUESTED', latestOpinionatedReviews: { nodes: [review('CHANGES_REQUESTED', 'j')] }, ...twoThreads }), {
  group: 'needs', rank: 2, pill: 'changes asked +1', reason: 'j asked for changes · 2 threads open', action: 'fix',
});
assert.equal(state({ reviewThreads: { nodes: [{ isResolved: false }] } }).pill, '1 thread');
assert.equal(state(red).rank, 1);
const requested = { reviewRequests: { nodes: ['a', 'b', 'c'].map((login) => ({ requestedReviewer: user(login) })) } };
assert.deepEqual(state(requested), { group: 'waiting', rank: 4, pill: 'awaiting a, b +1', reason: 'no reviews yet, updated 2 d ago', action: 'nudge' });
assert.equal(authorState(pr(requested), updated + 3600000).reason, 'no reviews yet, updated today');
assert.deepEqual(state({}), { group: 'waiting', rank: 4, pill: 'no reviewers', reason: 'no reviews yet, updated 2 d ago', action: null });
const approvals = { reviewDecision: 'APPROVED', latestOpinionatedReviews: { nodes: [review('APPROVED', 'j'), review('APPROVED', 'c')] } };
assert.deepEqual(state({ ...green, ...approvals }), { group: 'ready', rank: 5, pill: null, reason: 'approved by j, c', action: 'merge' });
assert.equal(state(approvals).action, null); // approved, checks not green yet: nothing to press
assert.deepEqual(state({ isDraft: true }), { group: 'draft', rank: 6, pill: null, reason: 'updated 2 d ago', action: 'ready' });
assert.deepEqual(state({ isDraft: true, ...red }), { group: 'draft', rank: 6, pill: null, reason: 'checks failing', action: 'ready' });

// Stale: updatedAt older than the cut-off; 0 is off
assert.equal(isStale(pr({}), 30, updated + 31 * day), true);
assert.equal(isStale(pr({}), 30, updated + 29 * day), false);
assert.equal(isStale(pr({}), 0, updated + 31 * day), false);
assert.equal(isStale(pr({ updatedAt: undefined }), 30, updated + 31 * day), false);

// VIP: author login or last commit email, any case
const boss = pr({ author: user('Boss'), commits: { nodes: [{ commit: { author: { email: 'Lead@X.io' }, statusCheckRollup: null } }] } });
assert.equal(boss.authorEmail, 'Lead@X.io');
assert.equal(pr({}).authorEmail, null); // sections stored before the field existed
assert.equal(isVip(boss, ['boss']), true);
assert.equal(isVip(boss, ['lead@x.io']), true);
assert.equal(isVip(boss, ['someone']), false);
assert.equal(isVip(pr({}), ['me']), false); // my own PRs carry no author
console.log('ok');
