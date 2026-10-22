/**
 * Plugin Menu -- one icon in Stash's top bar (MainNavBar.UtilityItems, right of Statistics) with a floating menu of plugin pages.
 *
 *  - Entries come from two places: plugins that register themselves (see "For plugin authors" in the README: push {id, label, path, badge?}
 *    to window.__stashPluginMenuQueue or call window.StashPluginMenu.register -- works whichever plugin loads first) and the entries the user
 *    adds on the page /plugins/stash-plugin-menu (stored as JSON in this plugin's own Stash setting `pages`).
 *  - A target is a path inside Stash or an http(s) address elsewhere (a sidecar, another machine): the latter opens in a new tab.
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
  const MAX_ORDER = 100;
  const MAX_DATA_ICON = 8000;  // characters of an uploaded icon (a small PNG as a data: address)

  // ---------- pure helpers (tested in tests/test_menu.js) ----------

  const isPath = (p) => typeof p === 'string' && /^\/[A-Za-z0-9/_.\-?=&#%]*$/.test(p) && !p.includes('//');
  // A target outside Stash (a sidecar, a container on another machine): http(s) only, no user:password@ in front of the host.
  const isUrl = (u) => typeof u === 'string' && u.length <= 300
    && /^https?:\/\/[^\s/?#@\\'"<>]+(?:[/?#][A-Za-z0-9\-._~:/?#\[\]!$&'()*+,;=%]*)?$/i.test(u);
  const isTarget = (t) => isPath(t) || isUrl(t);

  // An icon is the name of a FontAwesome solid icon (faBolt), an image path inside Stash (/plugin/x/assets/icon.png) or a small
  // uploaded PNG (data:image/png;base64,...); anything else (other hosts, other data types): none.
  function cleanIcon(v) {
    if (typeof v !== 'string') return undefined;
    const s = v.trim();
    if (/^fa[A-Z][A-Za-z0-9]*$/.test(s) || isPath(s)) return s;
    return s.length <= MAX_DATA_ICON && /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(s) ? s : undefined;
  }

  function cleanPages(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((x) => x && typeof x.label === 'string' && x.label.trim() && isTarget(x.path))
      .map((x) => { const icon = cleanIcon(x.icon); return { label: x.label.trim().slice(0, 40), path: x.path, ...(icon ? { icon } : {}) }; })
      .slice(0, MAX_USER_ENTRIES);
  }

  // Settings: `icons` shows an icon in front of every entry; `overrides` renames / re-icons / hides entries added by plugins, by target;
  // `order` lists the targets of all entries in the order the user wants (entries not listed follow in the default order).
  function cleanPrefs(p) {
    const out = { icons: false, overrides: {}, order: [] };
    if (!p || typeof p !== 'object') return out;
    out.icons = p.icons === true;
    const o = p.overrides && typeof p.overrides === 'object' ? p.overrides : {};
    for (const path of Object.keys(o).slice(0, MAX_OVERRIDES)) {
      if (!isTarget(path)) continue;
      const v = o[path] || {};
      const label = typeof v.label === 'string' ? v.label.trim().slice(0, 40) : '';
      const icon = cleanIcon(v.icon);
      const hidden = v.hidden === true;
      if (label || icon || hidden) out.overrides[path] = { ...(label ? { label } : {}), ...(icon ? { icon } : {}), ...(hidden ? { hidden } : {}) };
    }
    if (Array.isArray(p.order)) out.order = [...new Set(p.order.filter(isTarget))].slice(0, MAX_ORDER);
    return out;
  }

  // Registered entries first (by `order`, then shown label), then the user's; a target is listed once (the registered entry wins).
  // `prefs` (from cleanPrefs): `overrides` rename / re-icon / hide the registered entries (`defaultLabel` keeps the plugin's name,
  // `hidden` is only a flag: the caller leaves hidden entries out of the menu), `order` puts entries in the user's order.
  function mergeEntries(registered, user, prefs) {
    const ov = (prefs && prefs.overrides) || {};
    const order = (prefs && prefs.order) || [];
    let out = [];
    const seen = new Set();
    const reg = registered
      .map((e) => { const o = ov[e.path] || {}; return { ...e, defaultLabel: e.label, label: o.label || e.label, icon: o.icon || e.icon, hidden: o.hidden === true }; })
      .sort((a, b) => ((a.order ?? 100) - (b.order ?? 100)) || a.label.localeCompare(b.label));
    for (const e of reg) { if (!seen.has(e.path)) { seen.add(e.path); out.push({ ...e, source: 'plugin' }); } }
    for (const e of user) { if (!seen.has(e.path)) { seen.add(e.path); out.push({ ...e, source: 'user', hidden: false }); } }
    if (order.length) {
      const at = (path) => { const i = order.indexOf(path); return i < 0 ? Infinity : i; };
      out = out.map((e, n) => [e, n]).sort((x, y) => (at(x[0].path) - at(y[0].path)) || (x[1] - y[1])).map((x) => x[0]);
    }
    return out;
  }

  // github.com/<user>/<repo>/raw|blob/<ref>/<file> answers with a redirect that carries no CORS header, so a browser cannot read it;
  // the file itself is served by raw.githubusercontent.com, which allows it.
  function normalizeImageUrl(url) {
    const m = /^https:\/\/github\.com\/([^/?#]+)\/([^/?#]+)\/(?:raw|blob)\/([^?#]+)(?:\?raw=true)?$/.exec(url);
    return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url;
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

  if (typeof module !== 'undefined' && module.exports) { module.exports = { cleanPages, cleanPrefs, cleanIcon, mergeEntries, detectPages, normalizeImageUrl, isUrl, isTarget, insertUtilityItem, panelPlacement }; return; }

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
  window.StashPluginMenu = { version: '0.6.0', register, refresh };
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
        const entries = mergeEntries(registered, readCache(), prefs).filter((e) => !e.hidden);
        const link = (label, path, icon) => {
          const external = isUrl(path);  // outside Stash: a new tab, and a marker when there is no icon to show it
          const shown = external && !prefs.icons ? `${label} ↗` : label;
          const a = prefs.icons
            ? el('a', { className: 'dropdown-item', href: path }, [iconNode(icon || defaultIconName(path)), el('span', { textContent: shown })])
            : el('a', { className: 'dropdown-item', href: path, textContent: shown });
          if (external) {
            a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noopener noreferrer');
            a.addEventListener('click', () => closePanel());
            return a;
          }
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
        const entries = mergeEntries(registered, readCache(), readPrefs()).filter((e) => !e.hidden && !isUrl(e.path));
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
    if (typeof spec === 'string' && (spec.startsWith('/') || spec.startsWith('data:'))) return el('img', { className: 'spm-icon', src: spec, alt: '' });
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

  // The icon of an entry without one: only addresses outside Stash get a different one (an arrow out of a box); else the puzzle piece.
  function defaultIconName(target) {
    if (!isUrl(target)) return undefined;
    const lib = (window.PluginApi && window.PluginApi.libraries && window.PluginApi.libraries.FontAwesomeSolid) || {};
    return ['faUpRightFromSquare', 'faExternalLinkAlt', 'faArrowUpRightFromSquare'].find((n) => lib[n]);
  }

  let iconNameCache = null;
  function iconNameList() {
    if (!iconNameCache) {
      const lib = (window.PluginApi && window.PluginApi.libraries && window.PluginApi.libraries.FontAwesomeSolid) || {};
      iconNameCache = Object.keys(lib).filter((k) => /^fa[A-Z]/.test(k) && lib[k] && lib[k].icon).sort();
    }
    return iconNameCache;
  }

  // Draw a picture into a small square PNG (data: address) that fits MAX_DATA_ICON: 64, then 48, then 32 pixels.
  // `cors`: the picture comes from another site and is requested with CORS, so the canvas stays readable (only possible when that site allows it).
  function pictureToIcon(src, cors) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      if (cors) img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const w = img.naturalWidth || img.width; const h = img.naturalHeight || img.height;
          if (!w || !h) { reject(new Error('Could not read the size of the image.')); return; }
          for (const size of [64, 48, 32]) {
            const c = document.createElement('canvas');
            c.width = size; c.height = size;
            const k = Math.min(size / w, size / h);
            c.getContext('2d').drawImage(img, (size - w * k) / 2, (size - h * k) / 2, w * k, h * k);
            const d = c.toDataURL('image/png');
            if (d.length <= MAX_DATA_ICON) { resolve(d); return; }
          }
          reject(new Error('The image is too detailed for an icon; try a simpler one.'));
        } catch (e) { reject(new Error('The image cannot be read from that address.')); }
      };
      img.onerror = () => reject(new Error(cors ? 'Could not load the image from that address: not found, or the site does not let other sites read its images. Download it and use the upload button instead.' : 'Could not read the image.'));
      img.src = src;
    });
  }
  function imageToIcon(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('That is not an image.')); return; }
      if (file.size > 2 * 1024 * 1024) { reject(new Error('The image is larger than 2 MB.')); return; }
      const reader = new FileReader();  // Stash's CSP allows data: images but not blob: ones
      reader.onerror = () => reject(new Error('Could not read the file.'));
      reader.onload = () => resolve(pictureToIcon(reader.result, false));
      reader.readAsDataURL(file);
    });
  }
  // Fetch an image by its address once and keep only the small copy (nothing is requested from that site when the menu is shown).
  const isImageUrl = (v) => /^https?:\/\/[^\s@]+$/i.test(v);
  const urlToIcon = (url) => (isImageUrl(url) ? pictureToIcon(normalizeImageUrl(url), true) : Promise.reject(new Error('That is not an http(s) address.')));

  // Icon field: a grid of the icons themselves (a <datalist> cannot show pictures) -- click into the field, type to filter, click an icon --
  // plus an upload button for an own image; an image address (https://...) is fetched once and kept as a small copy. A path, an address or a stored image: no grid. The grid shows at most PICKER_MAX icons.
  const PICKER_MAX = 96;
  const UPLOADED = '(stored image)';
  function iconPicker(value, onSave, notify) {
    let current = cleanIcon(value) || '';
    const input = el('input', { type: 'text', className: 'form-control', placeholder: 'Icon (optional)' });
    input.value = current.startsWith('data:') ? UPLOADED : current;
    input.title = 'A FontAwesome name such as faBolt (click to pick one), an image address (https://...: the image is fetched once and a small copy is kept), an image path inside Stash, or upload an image with the button';
    const preview = el('span', { className: 'spm-picker-preview' });
    const grid = el('div', { className: 'spm-picker-grid dropdown-menu show' });
    grid.hidden = true;
    const file = el('input', { type: 'file', accept: 'image/*' });
    file.hidden = true;
    const typed = () => (input.value.trim() === UPLOADED ? current : input.value.trim());
    const showPreview = () => { const v = cleanIcon(typed()); preview.replaceChildren(v ? iconNode(v) : el('span', { className: 'spm-icon' })); };
    const fill = () => {
      const q = input.value.trim().toLowerCase();
      if (q.startsWith('/') || q.startsWith('(') || /^https?:/.test(q)) { grid.hidden = true; return; }
      const hits = iconNameList().filter((n) => n.toLowerCase().includes(q)).slice(0, PICKER_MAX);
      grid.replaceChildren(...(hits.length ? hits.map((n) => el('button', { type: 'button', className: 'spm-pick', title: n, onMouseDown: (e) => {
        e.preventDefault();  // keep the focus in the field: no blur / change before the pick
        current = n; input.value = n; grid.hidden = true; showPreview(); onSave(n);
      } }, [iconNode(n)])) : [el('div', { className: 'spm-hint', textContent: 'No icon with that name.' })]));
      grid.hidden = false;
    };
    input.addEventListener('focus', () => { if (input.value === UPLOADED) input.select(); else fill(); });
    input.addEventListener('input', () => { showPreview(); fill(); });
    input.addEventListener('blur', () => { grid.hidden = true; });
    input.addEventListener('keydown', (e) => { if (e.key === 'Escape') grid.hidden = true; });
    input.addEventListener('change', async () => {
      const v = input.value.trim();
      if (isImageUrl(v)) {
        notify('Loading the image…');
        try { current = await urlToIcon(v); input.value = UPLOADED; showPreview(); onSave(current); } catch (e) { notify(e.message); }
        return;
      }
      current = typed();
      onSave(current);
    });
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.value = '';
      if (!f) return;
      try { current = await imageToIcon(f); input.value = UPLOADED; showPreview(); onSave(current); } catch (e) { notify(e.message); }
    });
    showPreview();
    return el('div', { className: 'spm-picker spm-icon-input' }, [preview, input,
      el('button', { type: 'button', className: 'btn btn-secondary', textContent: '⬆', title: 'Upload an image as the icon (scaled down to at most 64 px)', onClick: () => file.click() }),
      file, grid]);
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
    const pick = el('select', { className: 'form-control spm-grow' });
    const onlyPages = el('input', { type: 'checkbox', checked: 'checked', onChange: () => fillPick() });
    const iconsBox = el('input', { type: 'checkbox', onChange: () => save(list, { ...prefs, icons: iconsBox.checked }) });
    const labelInput = el('input', { type: 'text', className: 'form-control spm-grow', placeholder: 'Name in the menu' });
    const pathInput = el('input', { type: 'text', className: 'form-control spm-grow', placeholder: '/plugins/some-plugin or https://host:port/' });
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
    const iconField = (value, onSave) => iconPicker(value, onSave, say);
    const TARGET_HINT = 'The address is a path inside Stash (starts with /) or a full http:// or https:// address (no user:password@).';
    const everyEntry = () => mergeEntries(registered, list, prefs);
    function draw() {
      iconsBox.checked = prefs.icons;
      const entries = everyEntry();
      const paths = entries.map((e) => e.path);
      const setOverride = (path, key, v) => {
        const cur = { ...(prefs.overrides[path] || {}) };
        if (v) cur[key] = v; else delete cur[key];
        const overrides = { ...prefs.overrides };
        if (cur.label || cur.icon || cur.hidden) overrides[path] = cur; else delete overrides[path];
        save(list, { ...prefs, overrides });
      };
      const editUser = (path, change) => save(list.map((y) => (y.path === path ? change(y) : y)), prefs);
      const move = (i, to) => {
        if (to < 0 || to >= paths.length) return;
        const next = [...paths];
        [next[i], next[to]] = [next[to], next[i]];
        save(list, { ...prefs, order: next });
      };
      const changeTarget = (old, v) => {
        if (v === old) return;
        if (!isTarget(v)) { say(TARGET_HINT); draw(); return; }
        if (paths.includes(v)) { say('Already in the menu.'); draw(); return; }
        save(list.map((y) => (y.path === old ? { ...y, path: v } : y)), { ...prefs, order: prefs.order.map((p) => (p === old ? v : p)) });
      };
      listBox.replaceChildren(...(entries.length ? entries.map((e, i) => {
        const mine = e.source === 'user';
        const own = prefs.overrides[e.path] || {};
        return el('div', { className: `spm-row${e.hidden ? ' spm-off' : ''}` }, [
          mine ? field(e.label, 'Name in the menu', (v) => v && editUser(e.path, (y) => ({ ...y, label: v })))
            : field(own.label || '', e.defaultLabel, (v) => setOverride(e.path, 'label', v)),
          mine ? iconField(e.icon || '', (v) => editUser(e.path, (y) => { const { icon, ...rest } = y; return v ? { ...rest, icon: v } : rest; }))
            : iconField(own.icon || '', (v) => setOverride(e.path, 'icon', v)),
          mine ? field(e.path, '/plugins/x or https://host:port/', (v) => changeTarget(e.path, v), 'spm-target')
            : el('span', { className: 'spm-path', title: 'Added by a plugin: its address cannot be changed here', textContent: `${e.path} (plugin)` }),
          el('div', { className: 'spm-actions' }, [
            el('button', { className: 'btn btn-secondary', textContent: '↑', title: 'Move up', onClick: () => move(i, i - 1) }),
            el('button', { className: 'btn btn-secondary', textContent: '↓', title: 'Move down', onClick: () => move(i, i + 1) }),
            mine ? el('button', { className: 'btn btn-danger', textContent: 'Remove', onClick: () => save(list.filter((y) => y.path !== e.path), { ...prefs, order: prefs.order.filter((p) => p !== e.path) }) })
              : el('button', { className: 'btn btn-secondary', textContent: e.hidden ? 'Show' : 'Hide', title: 'A plugin adds this entry itself, so it can only be hidden', onClick: () => setOverride(e.path, 'hidden', !e.hidden) }),
          ]),
        ]);
      }) : [el('div', { className: 'spm-hint', textContent: 'No entries yet.' })]));
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
      el('div', { className: 'spm-hint', textContent: 'The icon next to Statistics opens a menu with the entries below. Change a name, icon or address in its field; it is saved when you leave the field. Entries marked (plugin) were added by a plugin: you can rename, re-icon, move and hide them (an empty name keeps the plugin\'s). Addresses outside Stash open in a new tab.' }),
      el('label', { className: 'spm-check' }, [iconsBox, el('span', { textContent: ' Show an icon in front of every entry' })]),
      el('h4', { textContent: 'Menu entries' }), listBox,
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Add an installed plugin' }),
        el('div', { className: 'spm-hint', textContent: 'Stash does not say which plugins have a page of their own. The list is made by reading each plugin\'s script for a page address: a good hint, not a guarantee.' }),
        el('div', { className: 'spm-row' }, [pick, el('button', { className: 'btn btn-primary', textContent: 'Add', onClick: () => {
          const o = pick.selectedOptions[0];
          if (!o || !o.value) return say('Pick a plugin first.');
          if (everyEntry().some((x) => x.path === o.value)) return say('Already in the menu.');
          if (list.length >= MAX_USER_ENTRIES) return say(`At most ${MAX_USER_ENTRIES} entries.`);
          return save([...list, { label: o.dataset.name, path: o.value }], prefs);
        } })]),
        el('label', { className: 'spm-check' }, [onlyPages, el('span', { textContent: ' Only plugins with a page of their own' })])]),
      el('div', { className: 'spm-section' }, [el('h4', { textContent: 'Or any address: a page of Stash, or a sidecar / another server' }),
        el('div', { className: 'spm-row' }, [labelInput, pathInput, el('button', { className: 'btn btn-primary', textContent: 'Add this address', onClick: () => {
          const label = labelInput.value.trim(); const path = pathInput.value.trim();
          if (!label || !path) return say('Enter a name and an address.');
          if (cleanPages([{ label, path }]).length !== 1) return say(TARGET_HINT);
          if (everyEntry().some((x) => x.path === path)) return say('Already in the menu.');
          if (list.length >= MAX_USER_ENTRIES) return say(`At most ${MAX_USER_ENTRIES} entries.`);
          labelInput.value = ''; pathInput.value = '';
          return save([...list, { label, path }], prefs);
        } })])]),
      message,
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
