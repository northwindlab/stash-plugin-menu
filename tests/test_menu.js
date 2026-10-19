// Tests for the pure parts of stash-plugin-menu.js (list cleaning, merging registered + user entries, inserting next to Statistics).
// Run:  node tests/test_menu.js
const { cleanPages, cleanPrefs, cleanIcon, mergeEntries, detectPages, insertUtilityItem, panelPlacement } = require('../stash-plugin-menu.js');
let fails = 0;
const check = (name, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}`); if (!ok) fails += 1; };

check('keeps a good entry, trims the label', JSON.stringify(cleanPages([{ label: ' Sense ', path: '/plugins/stash-sense2' }])) === '[{"label":"Sense","path":"/plugins/stash-sense2"}]');
check('drops host, scheme, protocol-relative, relative paths', cleanPages([{ label: 'x', path: 'https://evil.example/' }, { label: 'x', path: '//evil.example' }, { label: 'x', path: 'plugins/a' }, { label: 'x', path: 'javascript:alert(1)' }]).length === 0);
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
check('entry keeps a valid icon, drops a bad one', cleanPages([{ label: 'a', path: '/a', icon: 'faBolt' }, { label: 'b', path: '/b', icon: 'javascript:1' }]).map((e) => e.icon).join(',') === 'faBolt,');
check('prefs: defaults', JSON.stringify(cleanPrefs(null)) === '{"icons":false,"overrides":{}}' && cleanPrefs('x').icons === false);
check('prefs: icons only when exactly true', cleanPrefs({ icons: true }).icons === true && cleanPrefs({ icons: 'yes' }).icons === false);
check('prefs: overrides cleaned (bad path / empty entries dropped, label trimmed)', JSON.stringify(cleanPrefs({ overrides: { '/a': { label: ' New ', icon: 'faBolt' }, 'https://x': { label: 'x' }, '/b': {}, '/c': null, '/d': { icon: 'nope' } } }).overrides) === '{"/a":{"label":"New","icon":"faBolt"}}');
const renamed = mergeEntries(reg, [{ label: 'Mine', path: '/mine' }], { '/plugins/c': { label: 'Aardvark', icon: 'faBolt' } });
check('rename: the shown label wins, sorting follows it, default kept', renamed.map((e) => e.label).join(',') === 'Alpha,Aardvark,Beta,Mine' && renamed.find((e) => e.path === '/plugins/c').defaultLabel === 'Gamma' && renamed.find((e) => e.path === '/plugins/c').icon === 'faBolt');
check('no overrides: as before', mergeEntries(reg, []).map((e) => e.label).join(',') === 'Alpha,Beta,Gamma');
check('detect: register.route path', detectPages('x', 'PluginApi.register.route("/my-page", Comp)').join() === '/my-page' && detectPages('x', "register . route('/a/b', C)").join() === '/a/b');
check('detect: own /plugins/<id> address', detectPages('stash-sense2', "path = '/plugins/stash-sense2'").join() === '/plugins/stash-sense2');
check('detect: another plugin\'s address with the same prefix is not a hit', detectPages('stash-sense', "/plugins/stash-sense2").length === 0);
check('detect: nothing, dynamic or foreign paths -> none', detectPages('a', 'console.log(1)').length === 0 && detectPages('a', 'register.route(`/x/${id}`, C)').length === 0 && detectPages('a', 'register.route("https://evil.example", C)').length === 0);
check('detect: regex characters in an id are harmless', detectPages('a.b', '/plugins/aXb').length === 0 && detectPages('a.b', '/plugins/a.b').length === 1);

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
