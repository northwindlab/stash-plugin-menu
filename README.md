# Plugin Menu for Stash

One icon in Stash's top bar (right of *Statistics*) with a floating menu of your plugin pages -- instead of one top-bar entry per plugin.

* No entries: the icon links to the editor page. Otherwise it opens a floating panel with the entries and "Edit menu…" at the bottom.
* A dot on the icon while a plugin reports activity (for example a running download).
* No server, no sidecar: the list is stored in this plugin's own Stash setting.

## Install

1. Copy the files of this folder into a folder `stash-plugin-menu` inside Stash's plugin directory (`<Stash config>/plugins/stash-plugin-menu/`).
2. Stash > *Settings > Plugins > Reload plugins*, then reload the page (Ctrl+F5).
3. Open `/plugins/stash-plugin-menu` (the puzzle icon > *Edit menu…*, or type the address) and add your plugin pages.

Stash does not tell which plugins have a page of their own, so the editor reads each enabled plugin's script and lists those that register a page (`register.route(...)`) or live at `/plugins/<plugin id>` -- a good hint, not a guarantee; a checkbox shows all plugins. You can also enter any address inside Stash by hand. Addresses must start with `/` (no host, no `//`); at most 12 entries of your own.

**Names and icons:** every entry can be renamed on the editor page, your own ones and those added by plugins (an empty name keeps the plugin's own). Tick *Show an icon in front of every entry* to show icons; each entry can have one: a [FontAwesome](https://fontawesome.com/icons) solid icon name such as `faBolt`, or an image path inside Stash. Without an icon a puzzle piece is shown.

## For plugin authors

Let your plugin put itself into the menu -- it works whichever plugin loads first, and does nothing when this plugin is not installed:

```js
window.__stashPluginMenuQueue = window.__stashPluginMenuQueue || [];
window.__stashPluginMenuQueue.push({
  id: 'my-plugin',            // optional, to replace an entry later
  label: 'My Plugin',
  path: '/plugins/my-plugin', // a path inside Stash
  order: 10,                  // optional, smaller first (default 100)
  icon: 'faBolt',             // optional: FontAwesome solid icon name or an image path inside Stash (shown when the user turns icons on)
  badge: () => isBusy(),      // optional: true puts a dot on the icon; call window.StashPluginMenu?.refresh() when it changes
});
```

If a plugin of yours also draws its own top-bar entry, check `window.StashPluginMenu` at render time and skip your entry when it exists.

## Tests

`node tests/test_menu.js` (list cleaning, merging, placement of the icon; no browser needed).

## License

GNU AGPL-3.0, see [LICENSE](LICENSE). Copyright (c) 2026 northwindlab.
