// Tests for the pure parts of stash-plugin-menu.js (list cleaning, merging registered + user entries, inserting next to Statistics).
// Run:  node tests/test_menu.js
const { cleanPages, mergeEntries, insertUtilityItem, panelPlacement } = require('../stash-plugin-menu.js');
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
console.log(fails ? `\n${fails} FAILED` : '\nALL OK');
process.exit(fails ? 1 : 0);
