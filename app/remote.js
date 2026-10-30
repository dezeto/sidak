// chrome.* for the board on a phone, through the tunnel (config.json "remote"). Sidak.app on the Mac serves this page, its own copy of
// the PR lists (/storage.json) and runs the actions (/act); nothing here talks to GitHub or holds a token.
(() => {
  // Marks the page as the phone's: panel.html shows card actions without hover and hides what only works at the Mac.
  document.documentElement.dataset.remote = '1';
  const changed = new Set();
  // The Mac's lists, refetched every minute and when the phone comes back to the tab; the page's own keys (view, tab, snooze picks)
  // stay on the phone.
  let mac = {};
  const pull = () => fetch('storage.json', { cache: 'no-store' }).then((r) => r.json()).then((j) => { mac = j; }).catch(() => {});
  let ready = pull();
  const repull = () => { ready = pull().then(() => changed.forEach((fn) => fn({ sections: {} }, 'local'))); };
  setInterval(repull, 60000);
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && repull());
  const act = (url) =>
    fetch('act', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sidak': '1' }, body: JSON.stringify({ url }) })
      .then((r) => (r.ok ? r.json() : { ok: false, error: `HTTP ${r.status}` }));
  const local = {
    async get(keys) {
      await ready;
      const out = {};
      for (const k of [].concat(keys)) {
        const v = localStorage.getItem(`s:${k}`);
        if (v != null) out[k] = JSON.parse(v);
        else if (k in mac) out[k] = mac[k];
      }
      return out;
    },
    async set(obj) {
      // The refresh button: the Mac syncs, then the new lists come back here.
      if ('syncRequest' in obj) return act('sidaksync://').then(repull);
      const changes = {};
      for (const [k, v] of Object.entries(obj)) { localStorage.setItem(`s:${k}`, JSON.stringify(v)); changes[k] = { newValue: v }; }
      for (const fn of changed) fn(changes, 'local');
    },
  };
  const event = () => ({ addListener() {} });
  window.chrome = {
    storage: { local, onChanged: { addListener: (fn) => changed.add(fn) } },
    runtime: {
      getURL: (p) => new URL(p, location.href).href,
      lastError: null,
      sendNativeMessage: (host, msg, cb) => act(msg.url).then(cb, (e) => cb({ ok: false, error: String(e) })),
      reload: () => location.reload(),
    },
    bookmarks: { search: async () => [], getSubTree: async () => [], onCreated: event(), onRemoved: event(), onChanged: event(), onMoved: event() },
  };
  // A long press opens the card menu, as a right-click does at the Mac. It opens when the finger lifts: a menu already open then would
  // be closed at once by that lift (a touch stays on the card it started on, outside the menu). The tap that ends it doesn't open the PR.
  let timer, held = null;
  addEventListener('touchstart', (e) => {
    const card = e.target.closest('.pr');
    held = null;
    if (!card) return;
    const { clientX, clientY } = e.touches[0];
    timer = setTimeout(() => { held = { card, clientX, clientY }; }, 500);
  }, { passive: true });
  for (const type of ['touchmove', 'touchcancel']) addEventListener(type, () => clearTimeout(timer), { passive: true });
  addEventListener('touchend', () => {
    clearTimeout(timer);
    if (!held) return;
    const { card, clientX, clientY } = held;
    setTimeout(() => card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX, clientY })));
  }, { passive: true });
  addEventListener('click', (e) => { if (held) { held = null; e.preventDefault(); e.stopPropagation(); } }, true);
})();
