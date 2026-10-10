/**
 * Plugin Menu -- one icon in Stash's top bar (MainNavBar.UtilityItems, right of Statistics) with a drop-down of plugin pages.
 *
 *  - Entries come from two places: plugins that register themselves (see "For plugin authors" in the README: push {id, label, path, badge?}
 *    to window.__stashPluginMenuQueue or call window.StashPluginMenu.register -- works whichever plugin loads first) and the entries the user
 *    adds on the page /plugins/stash-plugin-menu (stored as JSON in this plugin's own Stash setting `pages`).
 *  - No entries: the icon links to the editor page. Otherwise a drop-down with the entries and "Edit menu..." at the bottom.
 *  - A registered `badge: () => boolean` puts a dot on the icon while it returns true (call window.StashPluginMenu.refresh() when it changes).
 */
(function () {
  'use strict';

  const PLUGIN_ID = 'stash-plugin-menu';
  const PAGE_PATH = `/plugins/${PLUGIN_ID}`;
  const CACHE_KEY = 'spm:pages';
  const EVENT = 'spm-change';
  const MAX_USER_ENTRIES = 12;

  // ---------- pure helpers (tested in tests/test_menu.js) ----------

  function cleanPages(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((x) => x && typeof x.label === 'string' && x.label.trim() && typeof x.path === 'string'
        && /^\/[A-Za-z0-9/_.\-?=&#%]*$/.test(x.path) && !x.path.includes('//'))
      .map((x) => ({ label: x.label.trim().slice(0, 40), path: x.path }))
      .slice(0, MAX_USER_ENTRIES);
  }

  // Registered entries first (by `order`, then label), then the user's; a path is listed once (the registered entry wins).
  function mergeEntries(registered, user) {
    const out = [];
    const seen = new Set();
    const reg = [...registered].sort((a, b) => ((a.order ?? 100) - (b.order ?? 100)) || a.label.localeCompare(b.label));
    for (const e of reg) { if (!seen.has(e.path)) { seen.add(e.path); out.push({ ...e, source: 'plugin' }); } }
    for (const e of user) { if (!seen.has(e.path)) { seen.add(e.path); out.push({ ...e, source: 'user' }); } }
    return out;
  }

  // The utility children are ONE fragment holding the icons; put `item` right after the Statistics icon (or first).
  function insertUtilityItem(React, children, item) {
    const list = React.Children.toArray(children);
    const frag = list.find((c) => c && c.type === React.Fragment);
    if (!frag) return [item, ...list];
    const inner = React.Children.toArray(frag.props.children);
    const at = inner.findIndex((c) => c && c.props && c.props.to === '/stats');
    inner.splice(at + 1, 0, item);
    return list.map((c) => (c === frag ? React.createElement(React.Fragment, { key: c.key }, ...inner) : c));
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { cleanPages, mergeEntries, insertUtilityItem }; return; }

  // ---------- registry for other plugins ----------

  const registered = [];
  function register(item) {
    if (!item || typeof item.label !== 'string' || typeof item.path !== 'string') return;
    const clean = cleanPages([{ label: item.label, path: item.path }])[0];
    if (!clean) return;
    const at = registered.findIndex((x) => x.id === (item.id || clean.path));
    const entry = { ...clean, id: item.id || clean.path, order: item.order, badge: typeof item.badge === 'function' ? item.badge : null };
    if (at >= 0) registered[at] = entry; else registered.push(entry);
    refresh();
  }
  function refresh() { window.dispatchEvent(new CustomEvent(EVENT)); }
  function drainQueue() {
    const q = window.__stashPluginMenuQueue;
    if (Array.isArray(q)) q.splice(0).forEach(register);
  }
  window.StashPluginMenu = { version: '0.1.1', register, refresh };
  // From now on `push` registers at once (a plugin that loads after us can keep using the queue).
  window.__stashPluginMenuQueue = Object.assign(window.__stashPluginMenuQueue || [], { push: (...items) => { items.forEach(register); return items.length; } });
  drainQueue();

  // ---------- the user's entries: Stash plugin setting `pages`, cached in localStorage ----------

  function readCache() {
    try { return cleanPages(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')); } catch (e) { return []; }
  }
  function writeCache(list) {
    const clean = cleanPages(list);
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(clean)); } catch (e) { /* private mode */ }
    refresh();
    return clean;
  }
  async function gql(query, variables) {
    const res = await fetch('/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, variables }) });
    const body = await res.json();
    if (body.errors) throw new Error(body.errors[0].message);
    return body.data;
  }
  let refreshed = false;
  async function loadFromStash(force) {
    if (refreshed && !force) return readCache();
    refreshed = true;
    try {
      const data = await gql('{ configuration { plugins } }');
      const raw = ((data.configuration.plugins || {})[PLUGIN_ID] || {}).pages;
      return writeCache(raw ? JSON.parse(raw) : []);
    } catch (e) { return readCache(); }
  }
  async function savePages(list) {
    const clean = cleanPages(list);
    await gql('mutation($id: ID!, $input: Map!) { configurePlugin(plugin_id: $id, input: $input) }', { id: PLUGIN_ID, input: { pages: JSON.stringify(clean) } });
    return writeCache(clean);
  }

  // ---------- the icon ----------

  function registerNav() {
    const PluginApi = window.PluginApi;
    if (!PluginApi || !PluginApi.patch || !PluginApi.React) return;
    if (window.__spmNavRegistered) return;  // Stash re-runs plugin scripts after reloadPlugins: patch once per page
    window.__spmNavRegistered = true;
    try {
      const React = PluginApi.React;
      const RR = PluginApi.libraries.ReactRouterDOM;
      const { Link } = RR;
      const NavLink = RR.NavLink || Link;
      const useLocation = RR.useLocation || (() => window.location);
      const { Button, Dropdown } = PluginApi.libraries.Bootstrap;
      const { FontAwesomeIcon } = PluginApi.libraries.ReactFontAwesome;
      const solid = PluginApi.libraries.FontAwesomeSolid;
      const icon = solid.faPuzzlePiece || solid.faGrip || solid.faEye;

      const glyph = (busy) => [React.createElement(FontAwesomeIcon, { key: 'i', icon }), React.createElement('span', { key: 'd', className: 'spm-dot', hidden: !busy })];
      const renderMenu = () => {
        const [user, setUser] = React.useState(readCache);
        const [, tick] = React.useState(0);
        const location = useLocation();
        React.useEffect(() => {
          const onChange = () => { setUser(readCache()); tick((n) => n + 1); };
          window.addEventListener(EVENT, onChange);
          loadFromStash();
          return () => window.removeEventListener(EVENT, onChange);
        }, []);
        const entries = mergeEntries(registered, user);
        const busy = registered.some((e) => { try { return e.badge && e.badge(); } catch (x) { return false; } });
        const here = entries.some((e) => location.pathname === e.path || location.pathname.startsWith(`${e.path}/`)) || location.pathname === PAGE_PATH;
        const link = (to, title) => React.createElement(NavLink, { className: 'nav-utility spm-menu', to, isActive: () => here },
          React.createElement(Button, { className: 'minimal d-flex align-items-center h-100', title }, ...glyph(busy)));
        if (!entries.length) return link(PAGE_PATH, 'Plugin menu: add your plugin pages');
        if (!Dropdown) return link(entries[0].path, entries[0].label);  // (no drop-down component: at least the first page)
        const item = (key, label, to) => React.createElement(Dropdown.Item, { key, as: Link, to }, label);
        return React.createElement(Dropdown, { className: `nav-utility spm-menu${here ? ' active' : ''}`, alignRight: true },
          React.createElement(Dropdown.Toggle, { as: Button, className: 'minimal d-flex align-items-center h-100', title: 'Plugins' }, ...glyph(busy)),
          React.createElement(Dropdown.Menu, null, ...entries.map((e) => item(e.path, e.label, e.path)),
            React.createElement(Dropdown.Divider, { key: 'div' }), item('edit', 'Edit menu…', PAGE_PATH)));
      };
      const Menu = () => { try { return renderMenu(); } catch (e) { console.error('[Plugin Menu] icon failed:', e); return null; } }; // never take the top bar down

      PluginApi.patch.before('MainNavBar.UtilityItems', (props) => {
        const mine = (c) => c && String(c.key || '').includes('spm-menu');
        const flat = React.Children.toArray(props.children);
        if (flat.some((c) => mine(c) || (c && c.props && React.Children.toArray(c.props.children).some(mine)))) return [props];
        return [{ ...props, children: insertUtilityItem(React, props.children, React.createElement(Menu, { key: 'spm-menu' })) }];
      });
    } catch (e) {
      console.error('[Plugin Menu] could not add the icon:', e);
    }
  }

  // ---------- the editor page /plugins/stash-plugin-menu ----------

  function el(tag, props, children) {
    const n = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (k === 'className') n.className = v;
      else if (k === 'textContent') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    });
    (children || []).forEach((c) => c && n.appendChild(c));
    return n;
  }

  async function renderPage(root) {
    root.replaceChildren(el('div', { className: 'spm-page', textContent: 'Loading…' }));
    let list = await loadFromStash(true);
    const message = el('div', { className: 'spm-hint' });
    const listBox = el('div');
    const regBox = el('div');
    const pick = el('select', { className: 'form-control spm-grow' });
    const labelInput = el('input', { type: 'text', className: 'form-control spm-grow', placeholder: 'Name in the menu' });
    const pathInput = el('input', { type: 'text', className: 'form-control spm-grow', placeholder: '/plugins/some-plugin' });
    const say = (t) => { message.textContent = t; };
    const save = async (next) => {
      try { list = await savePages(next); say('Saved.'); draw(); } catch (e) { say(`Could not save: ${e.message}`); }
    };
    function draw() {
      listBox.replaceChildren(...(list.length ? list.map((x, i) => el('div', { className: 'spm-row' }, [
        el('span', { className: 'spm-grow', textContent: `${x.label}  ·  ${x.path}` }),
        el('button', { className: 'btn btn-secondary', textContent: '↑', title: 'Move up', onClick: () => i > 0 && save(list.map((_, j) => list[j === i - 1 ? i : j === i ? i - 1 : j])) }),
        el('button', { className: 'btn btn-secondary', textContent: '↓', title: 'Move down', onClick: () => i < list.length - 1 && save(list.map((_, j) => list[j === i + 1 ? i : j === i ? i + 1 : j])) }),
        el('button', { className: 'btn btn-danger', textContent: 'Remove', onClick: () => save(list.filter((_, j) => j !== i)) }),
      ])) : [el('div', { className: 'spm-hint', textContent: 'No entries of your own yet.' })]));
      const reg = mergeEntries(registered, []);
      regBox.replaceChildren(...(reg.length ? reg.map((e) => el('div', { className: 'spm-row', textContent: `${e.label}  ·  ${e.path}` }))
        : [el('div', { className: 'spm-hint', textContent: 'No plugin has added itself.' })]));
    }
    root.replaceChildren(el('div', { className: 'spm-page' }, [
      el('h2', { textContent: 'Plugin Menu' }),
      el('div', { className: 'spm-hint', textContent: 'The icon next to Statistics opens a menu with the pages below. Stash does not say which plugins have a page of their own: pick the ones that do (a page lives at /plugins/<plugin id>, e.g. /plugins/stash-sense2).' }),
      el('h4', { textContent: 'Your entries' }), listBox,
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Add an installed plugin' }),
        el('div', { className: 'spm-row' }, [pick, el('button', { className: 'btn btn-primary', textContent: 'Add', onClick: () => {
          const o = pick.selectedOptions[0];
          if (!o || !o.value) return say('Pick a plugin first.');
          if (list.some((x) => x.path === o.value)) return say('Already in the menu.');
          if (list.length >= MAX_USER_ENTRIES) return say(`At most ${MAX_USER_ENTRIES} entries.`);
          return save([...list, { label: o.dataset.name, path: o.value }]);
        } })])]),
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Or any page of Stash by its address' }),
        el('div', { className: 'spm-row' }, [labelInput, pathInput, el('button', { className: 'btn btn-primary', textContent: 'Add this address', onClick: () => {
          const label = labelInput.value.trim(); const path = pathInput.value.trim();
          if (!label || !path) return say('Enter a name and an address.');
          if (cleanPages([{ label, path }]).length !== 1) return say('The address is a path inside Stash and starts with / (no host, no //).');
          if (list.length >= MAX_USER_ENTRIES) return say(`At most ${MAX_USER_ENTRIES} entries.`);
          labelInput.value = ''; pathInput.value = '';
          return save([...list, { label, path }]);
        } })])]),
      message,
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Added by plugins themselves' }), regBox]),
    ]));
    draw();
    try {
      const data = await gql('{ plugins { id name } }');
      pick.replaceChildren(el('option', { value: '', textContent: 'Choose a plugin…' }), ...data.plugins
        .filter((p) => p.id !== PLUGIN_ID).sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => { const o = el('option', { value: `/plugins/${p.id}`, textContent: `${p.name} (${p.id})` }); o.dataset.name = p.name; return o; }));
    } catch (e) { pick.replaceChildren(el('option', { value: '', textContent: 'Plugin list not available' })); }
  }

  let mountToken = 0;
  async function syncPage() {
    const onPage = location.pathname.replace(/\/$/, '') === PAGE_PATH;
    const existing = document.getElementById('spm-page-root');
    if (!onPage) { if (existing) existing.remove(); return; }
    if (existing) return;
    const myToken = ++mountToken;
    let host = null;
    for (let i = 0; i < 40 && !host; i += 1) {  // Stash's own content area for an unknown route: div.main.container-fluid
      host = document.querySelector('.main.container-fluid') || document.querySelector('main');
      if (!host) await new Promise((r) => setTimeout(r, 100));
    }
    if (myToken !== mountToken || document.getElementById('spm-page-root')) return;
    const root = el('div', { id: 'spm-page-root' });
    (host || document.body).appendChild(root);
    renderPage(root);
  }

  function init() {
    registerNav();
    new MutationObserver(syncPage).observe(document.body, { childList: true, subtree: true });
    window.addEventListener('popstate', syncPage);
    syncPage();
    loadFromStash();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
