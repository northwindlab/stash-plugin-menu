/**
 * Plugin Menu -- one icon in Stash's top bar (MainNavBar.UtilityItems, right of Statistics) with a floating menu of plugin pages.
 *
 *  - Entries come from two places: plugins that register themselves (see "For plugin authors" in the README: push {id, label, path, badge?}
 *    to window.__stashPluginMenuQueue or call window.StashPluginMenu.register -- works whichever plugin loads first) and the entries the user
 *    adds on the page /plugins/stash-plugin-menu (stored as JSON in this plugin's own Stash setting `pages`).
 *  - A click opens a floating panel (fixed under the icon): the entries, then "Edit menu..." -- which is all there is while nothing is registered.
 *  - A registered `badge: () => boolean` puts a dot on the icon while it returns true (call window.StashPluginMenu.refresh() when it changes).
 */
(function () {
  'use strict';

  const PLUGIN_ID = 'stash-plugin-menu';
  const PAGE_PATH = `/plugins/${PLUGIN_ID}`;
  const CACHE_KEY = 'spm:pages';
  const EVENT = 'spm-change';
  const PREFS_KEY = 'spm:prefs';
  const MAX_USER_ENTRIES = 12;
  const MAX_OVERRIDES = 50;

  // ---------- pure helpers (tested in tests/test_menu.js) ----------

  const isPath = (p) => typeof p === 'string' && /^\/[A-Za-z0-9/_.\-?=&#%]*$/.test(p) && !p.includes('//');

  // An icon is the name of a FontAwesome solid icon (faBolt) or an image path inside Stash (/plugin/x/assets/icon.png); anything else: none.
  function cleanIcon(v) {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    return /^fa[A-Z][A-Za-z0-9]*$/.test(s) || isPath(s) ? s : undefined;
  }

  function cleanPages(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((x) => x && typeof x.label === 'string' && x.label.trim() && isPath(x.path))
      .map((x) => { const icon = cleanIcon(x.icon); return { label: x.label.trim().slice(0, 40), path: x.path, ...(icon ? { icon } : {}) }; })
      .slice(0, MAX_USER_ENTRIES);
  }

  // Settings: `icons` shows an icon in front of every entry; `overrides` renames (and gives an icon to) entries added by plugins, by path.
  function cleanPrefs(p) {
    const out = { icons: false, overrides: {} };
    if (!p || typeof p !== 'object') return out;
    out.icons = p.icons === true;
    const o = p.overrides && typeof p.overrides === 'object' ? p.overrides : {};
    for (const path of Object.keys(o).slice(0, MAX_OVERRIDES)) {
      if (!isPath(path)) continue;
      const v = o[path] || {};
      const label = typeof v.label === 'string' ? v.label.trim().slice(0, 40) : '';
      const icon = cleanIcon(v.icon);
      if (label || icon) out.overrides[path] = { ...(label ? { label } : {}), ...(icon ? { icon } : {}) };
    }
    return out;
  }

  // Registered entries first (by `order`, then shown label), then the user's; a path is listed once (the registered entry wins).
  // `overrides` (from cleanPrefs) rename / re-icon the registered entries; `defaultLabel` keeps the name the plugin gave.
  function mergeEntries(registered, user, overrides) {
    const ov = overrides || {};
    const out = [];
    const seen = new Set();
    const reg = registered
      .map((e) => ({ ...e, defaultLabel: e.label, label: (ov[e.path] && ov[e.path].label) || e.label, icon: (ov[e.path] && ov[e.path].icon) || e.icon }))
      .sort((a, b) => ((a.order ?? 100) - (b.order ?? 100)) || a.label.localeCompare(b.label));
    for (const e of reg) { if (!seen.has(e.path)) { seen.add(e.path); out.push({ ...e, source: 'plugin' }); } }
    for (const e of user) { if (!seen.has(e.path)) { seen.add(e.path); out.push({ ...e, source: 'user' }); } }
    return out;
  }

  // Which pages does a plugin have? Stash does not say, so read the plugin's script: a page is either registered with
  // PluginApi.register.route("/path", ...) or lives at /plugins/<plugin id> (drawn by the plugin itself). A hint, not a guarantee.
  function detectPages(pluginId, source) {
    const found = [];
    for (const m of String(source).matchAll(/register\s*\.\s*route\s*\(\s*(["'`])([^"'`$]+)\1/g)) if (isPath(m[2])) found.push(m[2]);
    const esc = String(pluginId).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`/plugins/${esc}(?![A-Za-z0-9_-])`).test(source)) found.push(`/plugins/${pluginId}`);
    return [...new Set(found)];
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

  // Where the floating panel goes: under the icon, right edge aligned with it (kept inside the window); above the icon when
  // there is little room below (icon at the bottom of the collapsed bar); on a narrow screen it spans the width (8px gutters).
  // `rect` = the icon's bounding box; returns CSS pixel values for position: fixed (vertical: either top or bottom is a number).
  const PANEL_GUTTER = 8;
  const PANEL_WIDTH = 288;
  const PANEL_MIN_BELOW = 160;
  function panelPlacement(rect, viewportWidth, viewportHeight) {
    const belowTop = Math.round(rect.bottom + 4);
    const below = viewportHeight - belowTop - PANEL_GUTTER;
    const above = (rect.top === undefined ? rect.bottom : rect.top) - 4 - PANEL_GUTTER;
    const vertical = below < PANEL_MIN_BELOW && above > below
      ? { top: 'auto', bottom: Math.round(viewportHeight - rect.top + 4), maxHeight: Math.max(120, above) }
      : { top: belowTop, bottom: 'auto', maxHeight: Math.max(120, below) };
    if (viewportWidth < 480) return { ...vertical, left: PANEL_GUTTER, right: PANEL_GUTTER, width: 'auto' };
    const width = Math.min(PANEL_WIDTH, viewportWidth - 2 * PANEL_GUTTER);
    const right = Math.min(Math.max(PANEL_GUTTER, Math.round(viewportWidth - rect.right)), viewportWidth - PANEL_GUTTER - width);
    return { ...vertical, left: 'auto', right, width };
  }

  if (typeof module !== 'undefined' && module.exports) { module.exports = { cleanPages, cleanPrefs, cleanIcon, mergeEntries, detectPages, insertUtilityItem, panelPlacement }; return; }

  // ---------- registry for other plugins ----------

  const registered = [];
  function register(item) {
    if (!item || typeof item.label !== 'string' || typeof item.path !== 'string') return;
    const clean = cleanPages([{ label: item.label, path: item.path, icon: item.icon }])[0];
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
  window.StashPluginMenu = { version: '0.3.1', register, refresh };
  // From now on `push` registers at once (a plugin that loads after us can keep using the queue).
  window.__stashPluginMenuQueue = Object.assign(window.__stashPluginMenuQueue || [], { push: (...items) => { items.forEach(register); return items.length; } });
  drainQueue();

  // ---------- the user's entries: Stash plugin setting `pages`, cached in localStorage ----------

  function readCache() {
    try { return cleanPages(JSON.parse(localStorage.getItem(CACHE_KEY) || '[]')); } catch (e) { return []; }
  }
  function readPrefs() {
    try { return cleanPrefs(JSON.parse(localStorage.getItem(PREFS_KEY) || '{}')); } catch (e) { return cleanPrefs(null); }
  }
  function writeCache(list, prefs) {
    const clean = cleanPages(list);
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(clean));
      if (prefs) localStorage.setItem(PREFS_KEY, JSON.stringify(cleanPrefs(prefs)));
    } catch (e) { /* private mode */ }
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
      const mine = (data.configuration.plugins || {})[PLUGIN_ID] || {};
      return writeCache(mine.pages ? JSON.parse(mine.pages) : [], mine.prefs ? JSON.parse(mine.prefs) : {});
    } catch (e) { return readCache(); }
  }
  // configurePlugin replaces the plugin's whole setting map: always send both settings together.
  async function saveAll(list, prefs) {
    const clean = cleanPages(list);
    const cleanP = cleanPrefs(prefs);
    await gql('mutation($id: ID!, $input: Map!) { configurePlugin(plugin_id: $id, input: $input) }',
      { id: PLUGIN_ID, input: { pages: JSON.stringify(clean), prefs: JSON.stringify(cleanP) } });
    return writeCache(clean, cleanP);
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
      const useLocation = RR.useLocation || (() => window.location);
      const { Button } = PluginApi.libraries.Bootstrap;
      const { FontAwesomeIcon } = PluginApi.libraries.ReactFontAwesome;
      const solid = PluginApi.libraries.FontAwesomeSolid;
      const icon = solid.faPuzzlePiece || solid.faGrip || solid.faEye;

      const glyph = (busy) => [React.createElement(FontAwesomeIcon, { key: 'i', icon }), React.createElement('span', { key: 'd', className: 'spm-dot', hidden: !busy })];

      // The panel is plain DOM on <body> (position: fixed), not a child of the top bar: it is never clipped or mis-placed by the collapsed
      // navbar of a narrow window or by a theme's navbar styles, and it uses Bootstrap's own dropdown classes so every theme styles it.
      let panel = null;
      const closePanel = () => {
        if (!panel) return;
        panel.remove(); panel = null;
        document.removeEventListener('mousedown', onOutside, true);
        document.removeEventListener('keydown', onKey, true);
        window.removeEventListener('resize', closePanel);
      };
      const onOutside = (e) => { if (panel && !panel.contains(e.target) && !e.target.closest('.spm-menu')) closePanel(); };
      const onKey = (e) => { if (e.key === 'Escape') closePanel(); };
      const go = (path) => {  // inside Stash's router: push the address and let the router see it
        window.history.pushState({}, '', path);
        window.dispatchEvent(new PopStateEvent('popstate'));
      };
      const openPanel = (anchor) => {
        if (panel) { closePanel(); return; }
        const prefs = readPrefs();
        const entries = mergeEntries(registered, readCache(), prefs.overrides);
        const link = (label, path, icon) => {
          const a = prefs.icons
            ? el('a', { className: 'dropdown-item', href: path }, [iconNode(icon), el('span', { textContent: label })])
            : el('a', { className: 'dropdown-item', href: path, textContent: label });
          a.addEventListener('click', (e) => {
            if (e.ctrlKey || e.metaKey || e.shiftKey || e.button === 1) return;  // let the browser open it in a new tab
            e.preventDefault(); closePanel(); go(path);
          });
          return a;
        };
        panel = el('div', { className: 'dropdown-menu show spm-panel', role: 'menu' }, [
          ...entries.map((e) => link(e.label, e.path, e.icon)),
          entries.length ? el('div', { className: 'dropdown-divider' }) : null,
          link('Edit menu…', PAGE_PATH, 'faPen'),
        ]);
        const pos = panelPlacement(anchor.getBoundingClientRect(), document.documentElement.clientWidth, document.documentElement.clientHeight);  // without the scrollbars: that is what position: fixed uses
        Object.entries({ top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, width: pos.width, maxHeight: pos.maxHeight })
          .forEach(([k, v]) => { panel.style[k] = typeof v === 'number' ? `${v}px` : v; });
        document.body.appendChild(panel);
        document.addEventListener('mousedown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
        window.addEventListener('resize', closePanel);
      };

      const renderMenu = () => {
        const [, tick] = React.useState(0);
        const location = useLocation();
        React.useEffect(() => {
          const onChange = () => tick((n) => n + 1);
          window.addEventListener(EVENT, onChange);
          loadFromStash();
          return () => window.removeEventListener(EVENT, onChange);
        }, []);
        React.useEffect(() => { closePanel(); }, [location.pathname]);  // leaving a page closes the panel
        const entries = mergeEntries(registered, readCache(), readPrefs().overrides);
        const busy = registered.some((e) => { try { return e.badge && e.badge(); } catch (x) { return false; } });
        const here = entries.some((e) => location.pathname === e.path || location.pathname.startsWith(`${e.path}/`)) || location.pathname === PAGE_PATH;
        return React.createElement('div', { className: `nav-utility spm-menu${here ? ' active' : ''}` },
          React.createElement(Button, { className: 'minimal d-flex align-items-center h-100', title: 'Plugins', onClick: (e) => openPanel(e.currentTarget) }, ...glyph(busy)));
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

  // A FontAwesome solid icon (by name) or an image (a path inside Stash) as a small node in front of a menu entry.
  function iconNode(spec) {
    if (typeof spec === 'string' && spec.startsWith('/')) return el('img', { className: 'spm-icon', src: spec, alt: '' });
    const lib = (window.PluginApi && window.PluginApi.libraries && window.PluginApi.libraries.FontAwesomeSolid) || {};
    const def = lib[spec] || lib.faPuzzlePiece;
    const d = def && def.icon && def.icon[4];
    if (typeof d !== 'string') return el('span', { className: 'spm-icon' });
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('class', 'spm-icon');
    svg.setAttribute('viewBox', `0 0 ${def.icon[0]} ${def.icon[1]}`);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', 'currentColor');
    svg.appendChild(path);
    return svg;
  }

  let iconNameCache = null;
  function iconNameList() {
    if (!iconNameCache) {
      const lib = (window.PluginApi && window.PluginApi.libraries && window.PluginApi.libraries.FontAwesomeSolid) || {};
      iconNameCache = Object.keys(lib).filter((k) => /^fa[A-Z]/.test(k) && lib[k] && lib[k].icon).sort();
    }
    return iconNameCache;
  }

  // Icon field with a grid of the icons themselves (a <datalist> cannot show pictures): click into the field, type to filter, click an icon.
  // A path (starts with /) or an empty field: no grid. The grid shows at most PICKER_MAX icons.
  const PICKER_MAX = 96;
  function iconPicker(value, onSave) {
    const input = el('input', { type: 'text', className: 'form-control', placeholder: 'Icon (optional)', value });
    input.title = 'A FontAwesome name such as faBolt (click to pick one), or an image path inside Stash such as /plugin/my-plugin/assets/icon.png';
    const preview = el('span', { className: 'spm-picker-preview' });
    const grid = el('div', { className: 'spm-picker-grid dropdown-menu show' });
    grid.hidden = true;
    const showPreview = () => { const v = cleanIcon(input.value); preview.replaceChildren(v ? iconNode(v) : el('span', { className: 'spm-icon' })); };
    const fill = () => {
      const q = input.value.trim().toLowerCase();
      if (q.startsWith('/')) { grid.hidden = true; return; }
      const hits = iconNameList().filter((n) => n.toLowerCase().includes(q)).slice(0, PICKER_MAX);
      grid.replaceChildren(...(hits.length ? hits.map((n) => el('button', { type: 'button', className: 'spm-pick', title: n, onMouseDown: (e) => {
        e.preventDefault();  // keep the focus in the field: no blur / change before the pick
        input.value = n; grid.hidden = true; showPreview(); onSave(n);
      } }, [iconNode(n)])) : [el('div', { className: 'spm-hint', textContent: 'No icon with that name.' })]));
      grid.hidden = false;
    };
    input.addEventListener('focus', fill);
    input.addEventListener('input', () => { showPreview(); fill(); });
    input.addEventListener('blur', () => { grid.hidden = true; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') grid.hidden = true; });
    input.addEventListener('change', () => onSave(input.value.trim()));
    showPreview();
    return el('div', { className: 'spm-picker spm-icon-input' }, [preview, input, grid]);
  }

  // Read each enabled plugin's script and look for a page of its own (see detectPages). Disabled plugins and unreadable scripts: no page.
  async function scanPlugins() {
    const data = await gql('{ plugins { id name enabled paths { javascript } } }');
    const found = await Promise.all(data.plugins.filter((p) => p.id !== PLUGIN_ID).map(async (p) => {
      let pages = [];
      if (p.enabled !== false) {
        try {
          const sources = await Promise.all(((p.paths && p.paths.javascript) || []).map((u) => {
            const url = new URL(u, window.location.href);  // same origin whatever host Stash reports
            return fetch(url.pathname + url.search).then((r) => (r.ok ? r.text() : ''));
          }));
          pages = detectPages(p.id, sources.join('\n'));
        } catch (e) { /* unreadable script: no page found */ }
      }
      return { id: p.id, name: p.name, enabled: p.enabled !== false, pages };
    }));
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  async function renderPage(root) {
    root.replaceChildren(el('div', { className: 'spm-page', textContent: 'Loading…' }));
    let list = await loadFromStash(true);
    let prefs = readPrefs();
    let plugins = null;  // result of scanPlugins, null while it runs / when it failed
    const message = el('div', { className: 'spm-hint' });
    const listBox = el('div');
    const regBox = el('div');
    const pick = el('select', { className: 'form-control spm-grow' });
    const onlyPages = el('input', { type: 'checkbox', checked: 'checked', onChange: () => fillPick() });
    const iconsBox = el('input', { type: 'checkbox', onChange: () => save(list, { ...prefs, icons: iconsBox.checked }) });
    const labelInput = el('input', { type: 'text', className: 'form-control spm-grow', placeholder: 'Name in the menu' });
    const pathInput = el('input', { type: 'text', className: 'form-control spm-grow', placeholder: '/plugins/some-plugin' });
    const say = (t) => { message.textContent = t; };
    const save = async (nextList, nextPrefs) => {
      try { list = await saveAll(nextList, nextPrefs); prefs = readPrefs(); say('Saved.'); } catch (e) { say(`Could not save: ${e.message}`); }
      draw();
    };
    const field = (value, placeholder, onSave, extra) => {
      const i = el('input', { type: 'text', className: `form-control ${extra || 'spm-grow'}`, placeholder, value });
      i.addEventListener('change', () => onSave(i.value.trim()));
      return i;
    };
    const iconField = iconPicker;
    function draw() {
      iconsBox.checked = prefs.icons;
      const move = (i, to) => to >= 0 && to < list.length && save(list.map((_, j) => list[j === to ? i : j === i ? to : j]), prefs);
      listBox.replaceChildren(...(list.length ? list.map((x, i) => el('div', { className: 'spm-row' }, [
        field(x.label, 'Name in the menu', (v) => v && save(list.map((y, j) => (j === i ? { ...y, label: v } : y)), prefs)),
        iconField(x.icon || '', (v) => save(list.map((y, j) => (j === i ? { label: y.label, path: y.path, ...(v ? { icon: v } : {}) } : y)), prefs)),
        el('span', { className: 'spm-path', textContent: x.path }),
        el('button', { className: 'btn btn-secondary', textContent: '↑', title: 'Move up', onClick: () => move(i, i - 1) }),
        el('button', { className: 'btn btn-secondary', textContent: '↓', title: 'Move down', onClick: () => move(i, i + 1) }),
        el('button', { className: 'btn btn-danger', textContent: 'Remove', onClick: () => save(list.filter((_, j) => j !== i), prefs) }),
      ])) : [el('div', { className: 'spm-hint', textContent: 'No entries of your own yet.' })]));
      const setOverride = (path, key, v) => {
        const cur = { ...(prefs.overrides[path] || {}) };
        if (v) cur[key] = v; else delete cur[key];
        const overrides = { ...prefs.overrides };
        if (cur.label || cur.icon) overrides[path] = cur; else delete overrides[path];
        save(list, { ...prefs, overrides });
      };
      const reg = mergeEntries(registered, [], prefs.overrides);
      regBox.replaceChildren(...(reg.length ? reg.map((e) => el('div', { className: 'spm-row' }, [
        field((prefs.overrides[e.path] || {}).label || '', e.defaultLabel, (v) => setOverride(e.path, 'label', v)),
        iconField((prefs.overrides[e.path] || {}).icon || '', (v) => setOverride(e.path, 'icon', v)),
        el('span', { className: 'spm-path', textContent: e.path }),
      ])) : [el('div', { className: 'spm-hint', textContent: 'No plugin has added itself.' })]));
    }
    function fillPick() {
      if (!plugins) return;
      const only = onlyPages.checked;
      const options = [];
      plugins.forEach((p) => {
        if (only) p.pages.forEach((path) => options.push([path, `${p.name} (${path})`, p.name]));
        else options.push([p.pages[0] || `/plugins/${p.id}`, `${p.name} (${p.id})${p.enabled ? '' : ' (disabled)'}`, p.name]);
      });
      pick.replaceChildren(el('option', { value: '', textContent: options.length ? 'Choose a plugin…' : 'No plugin with a page found' }),
        ...options.map(([path, text, name]) => { const o = el('option', { value: path, textContent: text }); o.dataset.name = name; return o; }));
    }
    root.replaceChildren(el('div', { className: 'spm-page' }, [
      el('h2', { textContent: 'Plugin Menu' }),
      el('div', { className: 'spm-hint', textContent: 'The icon next to Statistics opens a menu with the pages below. Change a name or icon in its field; it is saved when you leave the field. An empty name field in the second list keeps the name the plugin chose.' }),
      el('label', { className: 'spm-check' }, [iconsBox, el('span', { textContent: ' Show an icon in front of every entry' })]),
      el('h4', { textContent: 'Your entries' }), listBox,
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Add an installed plugin' }),
        el('div', { className: 'spm-hint', textContent: 'Stash does not say which plugins have a page of their own. The list is made by reading each plugin\'s script for a page address: a good hint, not a guarantee.' }),
        el('div', { className: 'spm-row' }, [pick, el('button', { className: 'btn btn-primary', textContent: 'Add', onClick: () => {
          const o = pick.selectedOptions[0];
          if (!o || !o.value) return say('Pick a plugin first.');
          if (list.some((x) => x.path === o.value)) return say('Already in the menu.');
          if (list.length >= MAX_USER_ENTRIES) return say(`At most ${MAX_USER_ENTRIES} entries.`);
          return save([...list, { label: o.dataset.name, path: o.value }], prefs);
        } })]),
        el('label', { className: 'spm-check' }, [onlyPages, el('span', { textContent: ' Only plugins with a page of their own' })])]),
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Or any page of Stash by its address' }),
        el('div', { className: 'spm-row' }, [labelInput, pathInput, el('button', { className: 'btn btn-primary', textContent: 'Add this address', onClick: () => {
          const label = labelInput.value.trim(); const path = pathInput.value.trim();
          if (!label || !path) return say('Enter a name and an address.');
          if (cleanPages([{ label, path }]).length !== 1) return say('The address is a path inside Stash and starts with / (no host, no //).');
          if (list.length >= MAX_USER_ENTRIES) return say(`At most ${MAX_USER_ENTRIES} entries.`);
          labelInput.value = ''; pathInput.value = '';
          return save([...list, { label, path }], prefs);
        } })])]),
      message,
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Added by plugins themselves' }), regBox]),
    ]));
    draw();
    pick.replaceChildren(el('option', { value: '', textContent: 'Checking the plugins…' }));
    try { plugins = await scanPlugins(); fillPick(); }
    catch (e) { pick.replaceChildren(el('option', { value: '', textContent: 'Plugin list not available' })); }
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
    // Client-side navigation (a click in Stash's own router) changes the address without touching the DOM we watch: follow pushState / replaceState too.
    ['pushState', 'replaceState'].forEach((fn) => {
      const original = window.history[fn];
      window.history[fn] = function patched(...args) {
        const result = original.apply(this, args);
        setTimeout(syncPage, 0);
        return result;
      };
    });
    syncPage();
    loadFromStash();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
