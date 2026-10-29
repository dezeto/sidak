// chrome.* shim for the Sidak menu-bar app (WKWebView). Only what panel.js, pr.js and background.js use.
// Injected at document start, before pr.js/panel.js; background.js is injected at document end.
(() => {
  const changed = new Set();
  const local = {
    async get(keys) {
      const out = {};
      for (const k of [].concat(keys)) { const v = localStorage.getItem(`s:${k}`); if (v != null) out[k] = JSON.parse(v); }
      return out;
    },
    async set(obj) {
      const changes = {};
      for (const [k, v] of Object.entries(obj)) { localStorage.setItem(`s:${k}`, JSON.stringify(v)); changes[k] = { newValue: v }; }
      for (const fn of changed) fn(changes, 'local');
    },
  };
  const event = () => ({ addListener() {} });
  const now = () => ({ addListener: (fn) => setTimeout(fn, 0) }); // after background.js finished evaluating (its `let queue`)
  const alarmFns = [];
  const bridge = (kind, data) => webkit.messageHandlers.sidak.postMessage({ kind, ...data });
  window.chrome = {
    storage: { local, onChanged: { addListener: (fn) => changed.add(fn) } },
    runtime: {
      getURL: (p) => new URL(p, location.href).href,
      lastError: null,
      sendNativeMessage: (host, msg, cb) => bridge('review', msg).then(cb, (e) => cb({ ok: false, error: String(e) })),
      reload: () => location.reload(),
      onInstalled: event(),
      onStartup: now(), // background.js's start(): one sync alarm + a first sync
    },
    alarms: {
      create: (name, { periodInMinutes }) => setInterval(() => alarmFns.forEach((fn) => fn({ name })), periodInMinutes * 60000),
      onAlarm: { addListener: (fn) => alarmFns.push(fn) },
    },
    // No bookmarks outside a browser: the Spaces switcher stays empty and the bookmark copy is a no-op.
    bookmarks: {
      search: async () => [], getSubTree: async () => [], getChildren: async () => [],
      getTree: async () => [{ children: [{ id: '1', children: [] }] }],
      create: async (b) => ({ id: '1', ...b }), removeTree: async () => {},
      onCreated: event(), onRemoved: event(), onChanged: event(), onMoved: event(),
    },
  };
  window.importScripts = () => {}; // background.js imports pr.js, which panel.html already loaded
  // Page errors reach the app log (log show --process Sidak); WKWebView has no console of its own.
  addEventListener('error', (e) => bridge('log', { text: `${e.message} @ ${e.filename}:${e.lineno}` }));
  addEventListener('unhandledrejection', (e) => bridge('log', { text: `unhandled: ${e.reason}` }));
})();
