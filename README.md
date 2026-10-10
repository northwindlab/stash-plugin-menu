# Plugin Menu for Stash

One icon in Stash's top bar (right of *Statistics*) with a drop-down of your plugin pages -- instead of one top-bar entry per plugin.

* No entries: the icon links to the editor page. One entry: a plain link. Several: a drop-down, "Edit menu…" at the bottom.
* A dot on the icon while a plugin reports activity (for example a running download).
* No server, no sidecar: the list is stored in this plugin's own Stash setting.

## Install

1. Copy the files of this folder into a folder `stash-plugin-menu` inside Stash's plugin directory (`<Stash config>/plugins/stash-plugin-menu/`).
2. Stash > *Settings > Plugins > Reload plugins*, then reload the page (Ctrl+F5).
3. Open `/plugins/stash-plugin-menu` (the puzzle icon > *Edit menu…*, or type the address) and add your plugin pages.

Stash does not tell which plugins have a page of their own, so you pick the installed plugins that do (a page lives at `/plugins/<plugin id>`, e.g. `/plugins/stash-sense2`), or enter any address inside Stash by hand. Addresses must start with `/` (no host, no `//`); at most 12 entries of your own.

## For plugin authors

Let your plugin put itself into the menu -- it works whichever plugin loads first, and does nothing when this plugin is not installed:

```js
window.__stashPluginMenuQueue = window.__stashPluginMenuQueue || [];
window.__stashPluginMenuQueue.push({
  id: 'my-plugin',            // optional, to replace an entry later
  label: 'My Plugin',
  path: '/plugins/my-plugin', // a path inside Stash
  order: 10,                  // optional, smaller first (default 100)
  badge: () => isBusy(),      // optional: true puts a dot on the icon; call window.StashPluginMenu?.refresh() when it changes
});
```

If a plugin of yours also draws its own top-bar entry, check `window.StashPluginMenu` at render time and skip your entry when it exists.

## Tests

`node tests/test_menu.js` (list cleaning, merging, placement of the icon; no browser needed).

## License

GNU AGPL-3.0, see [LICENSE](LICENSE). Copyright (c) 2026 northwindlab.
