// Tests for the pure parts of stash-plugin-menu.js (list cleaning, merging registered + user entries, inserting next to Statistics).
// Run:  node tests/test_menu.js
const { cleanPages, cleanPrefs, cleanIcon, mergeEntries, detectPages, normalizeImageUrl, isUrl, isTarget, insertUtilityItem, panelPlacement } = require('../stash-plugin-menu.js');
let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fails += 1; };

check('keeps a good entry, trims the label', JSON.stringify(cleanPages([{ label: ' Sense ', path: '/plugins/stash-sense2' }])) === '[{"label":"Sense","path":"/plugins/stash-sense2"}]');
check('drops protocol-relative, relative, script and other schemes', cleanPages([{ label: 'x', path: '//evil.example' }, { label: 'x', path: 'plugins/a' }, { label: 'x', path: 'javascript:alert(1)' }, { label: 'x', path: 'ftp://h/x' }, { label: 'x', path: 'data:text/html,x' }]).length === 0);
check('drops empty labels and non-objects', cleanPages([{ label: ' ', path: '/a' }, null, 5, 'x']).length === 0);
check('not a list -> empty', cleanPages('x').length === 0 && cleanPages(null).length === 0);
check('at most 12', cleanPages(Array.from({ length: 20 }, (_, i) => ({ label: `p${i}`, path: `/p${i}` }))).length === 12);

const reg = [{ id: 'b', label: 'Beta', path: '/plugins/b' }, { id: 'a', label: 'Alpha', path: '/plugins/a', order: 1 }, { id: 'c', label: 'Gamma', path: '/plugins/c' }];
const merged = mergeEntries(reg, [{ label: 'Mine', path: '/mine' }, { label: 'Dup of Beta', path: '/plugins/b' }]);
check('registered first: by order, then label', merged.map((e) => e.label).join(',') === 'Alpha,Beta,Gamma,Mine');
check('a path is listed once (the plugin wins)', merged.filter((e) => e.path === '/plugins/b').length === 1 && merged.find((e) => e.path === '/plugins/b').source === 'plugin');
check('sources marked', merged.find((e) => e.label === 'Mine').source === 'user');

check('icon: FontAwesome name or Stash path accepted, rest dropped', cleanIcon('faBolt') === 'faBolt' && cleanIcon('/plugin/x/assets/i.png') === '/plugin/x/assets/i.png'
  && cleanIcon('https://evil.example/i.png') === undefined && cleanIcon('//evil.example/i.png') === undefined && cleanIcon('bolt') === undefined && cleanIcon(5) === undefined);
check('icon: small uploaded PNG accepted; other data types, other encodings, oversize and script dropped', cleanIcon('data:image/png;base64,iVBORw0KGgo=') === 'data:image/png;base64,iVBORw0KGgo='
  && cleanIcon('data:image/svg+xml;base64,PHN2Zz4=') === undefined && cleanIcon('data:text/html;base64,PGI+') === undefined && cleanIcon('data:image/png,abc') === undefined
  && cleanIcon('data:image/png;base64,<script>') === undefined && cleanIcon(`data:image/png;base64,${'A'.repeat(8000)}`) === undefined);
check('github.com raw / blob addresses go to raw.githubusercontent.com', normalizeImageUrl('https://github.com/u/r/raw/main/assets/i.png') === 'https://raw.githubusercontent.com/u/r/main/assets/i.png'
  && normalizeImageUrl('https://github.com/u/r/blob/main/a/i.png?raw=true') === 'https://raw.githubusercontent.com/u/r/main/a/i.png');
check('other addresses stay as they are', normalizeImageUrl('https://example.com/github.com/u/r/raw/x.png') === 'https://example.com/github.com/u/r/raw/x.png'
  && normalizeImageUrl('https://github.com/u/r') === 'https://github.com/u/r' && normalizeImageUrl('https://github.com.evil.example/u/r/raw/m/i.png') === 'https://github.com.evil.example/u/r/raw/m/i.png');
check('entry keeps a valid icon, drops a bad one', cleanPages([{ label: 'a', path: '/a', icon: 'faBolt' }, { label: 'b', path: '/b', icon: 'javascript:1' }]).map((e) => e.icon).join(',') === 'faBolt,');
check('prefs: defaults', JSON.stringify(cleanPrefs(null)) === '{"icons":false,"overrides":{},"order":[]}' && cleanPrefs('x').icons === false);
check('prefs: icons only when exactly true', cleanPrefs({ icons: true }).icons === true && cleanPrefs({ icons: 'yes' }).icons === false);
check('prefs: overrides cleaned (bad path / empty entries dropped, label trimmed)', JSON.stringify(cleanPrefs({ overrides: { '/a': { label: ' New ', icon: 'faBolt' }, 'ftp://x': { label: 'x' }, '/b': {}, '/c': null, '/d': { icon: 'nope' } } }).overrides) === '{"/a":{"label":"New","icon":"faBolt"}}');
const renamed = mergeEntries(reg, [{ label: 'Mine', path: '/mine' }], { overrides: { '/plugins/c': { label: 'Aardvark', icon: 'faBolt' } } });
check('rename: the shown label wins, sorting follows it, default kept', renamed.map((e) => e.label).join(',') === 'Alpha,Aardvark,Beta,Mine' && renamed.find((e) => e.path === '/plugins/c').defaultLabel === 'Gamma' && renamed.find((e) => e.path === '/plugins/c').icon === 'faBolt');
check('no overrides: as before', mergeEntries(reg, []).map((e) => e.label).join(',') === 'Alpha,Beta,Gamma');
check('detect: register.route path', detectPages('x', 'PluginApi.register.route("/my-page", Comp)').join() === '/my-page' && detectPages('x', "register . route('/a/b', C)").join() === '/a/b');
check('detect: own /plugins/<id> address', detectPages('stash-sense2', "path = '/plugins/stash-sense2'").join() === '/plugins/stash-sense2');
check('detect: another plugin\'s address with the same prefix is not a hit', detectPages('stash-sense', "/plugins/stash-sense2").length === 0);
check('detect: nothing, dynamic or foreign paths -> none', detectPages('a', 'console.log(1)').length === 0 && detectPages('a', 'register.route(`/x/${id}`, C)').length === 0 && detectPages('a', 'register.route("https://evil.example", C)').length === 0);
check('detect: regex characters in an id are harmless', detectPages('a.b', '/plugins/aXb').length === 0 && detectPages('a.b', '/plugins/a.b').length === 1);

// targets outside Stash (a sidecar, another machine)
check('isUrl: http(s) with host, port, path, query', ['http://sidecar.local:8080', 'https://side.example/menu?x=1#top', 'http://[2001:db8::1]:9000/a', 'http://nas.local/a%20b'].every(isUrl));
check('isUrl: no other scheme, no credentials, no spaces/quotes/backslash, no host-less', ['ftp://h/x', 'javascript:alert(1)', 'https://user:pw@h/x', 'http://', 'https://h/a b', 'https://h"x', 'https://h\\x', '//h/x', 'https://h/<x>'].every((u) => !isUrl(u)));
check('isUrl: too long is refused', !isUrl(`https://h/${'a'.repeat(300)}`));
check('isTarget: path or URL', isTarget('/plugins/a') && isTarget('https://h:1/x') && !isTarget('plugins/a') && !isTarget(null));
check('entries may have a URL as target; a URL is kept unchanged', JSON.stringify(cleanPages([{ label: ' Side ', path: 'https://side.example:8443/menu?a=1' }])) === '[{"label":"Side","path":"https://side.example:8443/menu?a=1"}]');
check('prefs: override for a URL target and hidden flag kept; hidden only when exactly true', JSON.stringify(cleanPrefs({ overrides: { 'https://h/x': { label: 'N' }, '/a': { hidden: true }, '/b': { hidden: 'yes' } } }).overrides) === '{"https://h/x":{"label":"N"},"/a":{"hidden":true}}');
check('prefs: order cleaned (bad targets and duplicates dropped, capped)', JSON.stringify(cleanPrefs({ order: ['/a', 'x', '/a', 'https://h/x', 5] }).order) === '["/a","https://h/x"]' && cleanPrefs({ order: Array.from({ length: 300 }, (_, i) => `/p${i}`) }).order.length === 100 && cleanPrefs({ order: 'x' }).order.length === 0);
const hid = mergeEntries(reg, [{ label: 'Mine', path: '/mine' }], { overrides: { '/plugins/b': { hidden: true } } });
check('hidden: flagged, still listed (the caller filters), user entries never hidden', hid.find((e) => e.path === '/plugins/b').hidden === true && hid.length === 4 && hid.find((e) => e.path === '/mine').hidden === false);
const ordered = mergeEntries(reg, [{ label: 'Mine', path: '/mine' }, { label: 'Side', path: 'https://h/x' }], { order: ['/mine', '/plugins/c'] });
check('order: listed targets first in that order, the rest in the default order', ordered.map((e) => e.label).join(',') === 'Mine,Gamma,Alpha,Beta,Side');
check('order: unknown targets are ignored', mergeEntries(reg, [], { order: ['/nope'] }).map((e) => e.label).join(',') === 'Alpha,Beta,Gamma');
check('order and rename work together', mergeEntries(reg, [], { order: ['/plugins/c'], overrides: { '/plugins/c': { label: 'Zed' } } })[0].label === 'Zed');

const Fragment = Symbol('Fragment');
const React = {
  Fragment,
  createElement: (type, props, ...children) => ({ type, key: props && props.key, props: { ...(props || {}), children: children.length === 1 ? children[0] : children } }),
  Children: { toArray: (c) => (c == null ? [] : [].concat(c).flat(Infinity).filter(Boolean)) },
};
const icons = ['donate', 'stats', 'settings', 'help'].map((k) => React.createElement('a', { key: k, to: k === 'stats' ? '/stats' : `/${k}` }));
const out = insertUtilityItem(React, [React.createElement(Fragment, { key: 'f' }, ...icons)], React.createElement('mine', { key: 'spm-menu' }));
check('inserted right after Statistics', React.Children.toArray(out[0].props.children).map((c) => c.key).join(',') === 'donate,stats,spm-menu,settings,help');
check('no Statistics icon -> first', React.Children.toArray(insertUtilityItem(React, [React.createElement(Fragment, { key: 'f' }, React.createElement('a', { key: 'x', to: '/x' }))], React.createElement('mine', { key: 'spm-menu' }))[0].props.children)[0].key === 'spm-menu');
check('no fragment -> in front', insertUtilityItem(React, [React.createElement('b', { key: 'b' })], React.createElement('mine', { key: 'spm-menu' }))[0].key === 'spm-menu');

const wide = panelPlacement({ bottom: 40, right: 1500 }, 1568, 610);
check('wide screen: under the icon, right edges aligned, fixed width', wide.top === 44 && wide.right === 68 && wide.left === 'auto' && wide.width === 288 && wide.maxHeight === 558);
const narrow = panelPlacement({ bottom: 56, right: 300 }, 360, 640);
check('narrow screen: spans the width with 8px gutters', narrow.left === 8 && narrow.right === 8 && narrow.width === 'auto' && narrow.maxHeight === 572);
const edge = panelPlacement({ bottom: 40, right: 1568 }, 1568, 610);
check('icon at the very edge: keeps the 8px gutter', edge.right === 8);
check('very small height: still at least 120px', panelPlacement({ bottom: 40, right: 800 }, 1000, 100).maxHeight === 120);
const lowIcon = panelPlacement({ top: 575, bottom: 605, left: 200, right: 240 }, 500, 657);
check('icon at the bottom of a small window: panel above the icon, inside the window', lowIcon.top === 'auto' && lowIcon.bottom === 86 && lowIcon.maxHeight === 563);
check('icon far left: panel does not leave the window on the left', lowIcon.right === 500 - 8 - 288 && 500 - lowIcon.right - lowIcon.width >= 8);
check('normal case: below the icon, bottom stays auto', wide.bottom === 'auto' && narrow.bottom === 'auto');
const lowNarrow = panelPlacement({ top: 580, bottom: 610, left: 100, right: 140 }, 360, 650);
check('narrow and low: above the icon, full width', lowNarrow.top === 'auto' && lowNarrow.bottom === 74 && lowNarrow.left === 8 && lowNarrow.right === 8);
console.log(fails ?`\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
