// chrome.* for the board on a phone, through the tunnel (config.json "remote"). Sidak.app on the Mac serves this page, its own copy of
// the PR lists (/storage.json) and runs the actions (/act); nothing here talks to GitHub or holds a token.
(() => {
  // Marks the page as the phone's: panel.html shows card actions without hover and hides what only works at the Mac.
  document.documentElement.dataset.remote = '1';
  // iOS keeps a fixed bar at the bottom of the page behind the keyboard; --kb is the keyboard's height, so the bar (panel.html)
  // rides on top of it while search is open, as Safari's own bar does.
  const vv = window.visualViewport;
  const kb = () => document.documentElement.style.setProperty('--kb', `${Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop))}px`);
  if (vv) { vv.addEventListener('resize', kb); vv.addEventListener('scroll', kb); }
  // iOS controls in the settings: an Off/On choice becomes a native switch, one of three or more a native picker (a select). Each
  // drives its segmented control's buttons, which stay the source of truth (hidden by panel.html, .seg.native).
  addEventListener('DOMContentLoaded', () => {
    for (const seg of document.querySelectorAll('#settings .seg')) {
      const values = [...seg.querySelectorAll('button')].map((b) => b.value);
      const isSwitch = values.join() === 'off,on';
      if (!isSwitch && values.length < 3) continue;
      const ctl = document.createElement(isSwitch ? 'input' : 'select');
      if (isSwitch) Object.assign(ctl, { type: 'checkbox' }).setAttribute('switch', '');
      else for (const b of seg.querySelectorAll('button')) ctl.append(new Option(b.textContent, b.value));
      ctl.className = isSwitch ? 'ios-switch' : 'ios-select';
      ctl.setAttribute('aria-label', seg.getAttribute('aria-label'));
      const sync = () => {
        const on = seg.querySelector('[aria-pressed="true"]');
        if (isSwitch) ctl.checked = on?.value === 'on';
        else if (on) ctl.value = on.value;
      };
      new MutationObserver(sync).observe(seg, { subtree: true, attributes: true, attributeFilter: ['aria-pressed'] });
      ctl.onchange = () => seg.querySelector(`button[value="${isSwitch ? (ctl.checked ? 'on' : 'off') : ctl.value}"]`)?.click();
      seg.classList.add('native');
      seg.after(ctl);
      sync();
    }
    // iOS Settings: a title with Done, then the rows in labelled groups on rounded cards. The rows move, not copies, so panel.js keeps
    // its handles on them.
    const settings = document.getElementById('settings');
    const rows = [...settings.querySelectorAll(':scope > .set')];
    const row = (sel) => rows.find((r) => r.matches(sel) || r.querySelector(sel));
    const head = document.createElement('div');
    head.className = 'ios-head';
    const done = Object.assign(document.createElement('button'), { type: 'button', textContent: 'Done', onclick: () => document.querySelector('#foot .run')?.click() });
    head.append(document.createElement('span'), Object.assign(document.createElement('h2'), { textContent: 'Settings' }), done);
    settings.append(head);
    for (const [label, sels] of [
      ['New reviews', ['[data-key="model"]', '[data-key="effort"]', '[data-setting="profile"]']],
      ['Auto', ['[data-setting="auto"]', '#auto-cap', '[data-setting="quiet"]']],
      ['Board', ['[data-setting="pollMinutes"]', '[data-setting="staleDays"]', '#phone-set']],
      ['VIP authors', ['.vip']],
    ]) {
      const group = document.createElement('div');
      group.className = 'ios-group';
      const cells = document.createElement('div');
      cells.className = 'ios-cells';
      cells.append(...sels.map(row).filter(Boolean));
      group.append(Object.assign(document.createElement('p'), { className: 'ios-label', textContent: label }), cells);
      settings.append(group);
    }
  });
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
  // A finger is never still: up to 10 px of drift keeps the press; at half a second the card lights up (data-held) to say lift now.
  let timer, start = null, held = null;
  const drop = () => { clearTimeout(timer); start?.card.removeAttribute('data-held'); start = null; };
  addEventListener('touchstart', (e) => {
    const card = e.target.closest('.pr');
    held = null;
    drop();
    if (!card || e.touches.length > 1) return;
    const { clientX, clientY } = e.touches[0];
    start = { card, clientX, clientY };
    timer = setTimeout(() => { held = start; card.setAttribute('data-held', ''); }, 500);
  }, { passive: true });
  addEventListener('touchmove', (e) => {
    const t = e.touches[0];
    if (start && !held && Math.hypot(t.clientX - start.clientX, t.clientY - start.clientY) > 10) drop();
  }, { passive: true });
  // iOS may still take a held touch for itself (touchcancel, no lift): a press already held opens the menu then.
  addEventListener('touchcancel', () => {
    const was = held;
    drop();
    if (was) setTimeout(() => was.card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: was.clientX, clientY: was.clientY })));
  }, { passive: true });
  addEventListener('touchend', () => {
    held?.card.removeAttribute('data-held');
    drop();
    if (!held) return;
    const { card, clientX, clientY } = held;
    setTimeout(() => card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX, clientY })));
  }, { passive: true });
  addEventListener('click', (e) => { if (held) { held = null; e.preventDefault(); e.stopPropagation(); } }, true);
})();
