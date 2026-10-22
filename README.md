# Plugin Menu for Stash

One icon in Stash's top bar (right of *Statistics*) with a floating menu of your plugin pages -- instead of one top-bar entry per plugin.

* The icon opens a floating panel with the entries and "Edit menu…" at the bottom (with no entries that is all there is).
* A dot on the icon while a plugin reports activity (for example a running download).
* No server, no sidecar: the list is stored in this plugin's own Stash setting.

## Install

1. Copy the files of this folder into a folder `stash-plugin-menu` inside Stash's plugin directory (`<Stash config>/plugins/stash-plugin-menu/`).
2. Stash > *Settings > Plugins > Reload plugins*, then reload the page (Ctrl+F5).
3. Open `/plugins/stash-plugin-menu` (the puzzle icon > *Edit menu…*, or type the address) and add your plugin pages.

Stash does not tell which plugins have a page of their own, so the editor reads each enabled plugin's script and lists those that register a page (`register.route(...)`) or live at `/plugins/<plugin id>` -- a good hint, not a guarantee; a checkbox shows all plugins. You can also enter any address by hand: a path inside Stash (starts with `/`, no `//`) or a full `http://` / `https://` address, for example a sidecar or a container on another machine. Such an address opens in a new tab and is marked with an arrow in the menu; it may not contain `user:password@`. At most 12 entries of your own.

**One list:** all entries are in one list on the editor page, in the order of the menu. Your own entries can be renamed, re-iconed, moved, have their address changed and be removed. Entries that a plugin adds by itself (for example the Release Manager) are edited the same way (an empty name keeps the plugin's), except that they can only be hidden, not removed (the plugin would add them again), and their address is fixed. The plugin works the same without any plugin adding itself: add the pages you want by hand.

**Names and icons:** every entry can be renamed on the editor page, your own ones and those added by plugins (an empty name keeps the plugin's own). Tick *Show an icon in front of every entry* to show icons; each entry can have one: a [FontAwesome](https://fontawesome.com/icons) solid icon name such as `faBolt`, an image path inside Stash, or an image of your own: paste an image address (`https://...`) into the icon field, or use the ⬆ button for a file. Either way the image is scaled to a small PNG and a copy is stored in the setting; nothing is loaded from the other site when the menu is shown. An address only works when that site allows other sites to read its images (CORS); otherwise download the file and upload it. Without an icon a puzzle piece is shown.

## For plugin authors

Let your plugin put itself into the menu -- it works whichever plugin loads first, and does nothing when this plugin is not installed:

```js
window.__stashPluginMenuQueue = window.__stashPluginMenuQueue || [];
window.__stashPluginMenuQueue.push({
  id: 'my-plugin',            // optional, to replace an entry later
  label: 'My Plugin',
  path: '/plugins/my-plugin', // a path inside Stash (or a full http(s) address, opened in a new tab)
  order: 10,                  // optional, smaller first (default 100)
  icon: 'faBolt',             // optional: FontAwesome solid icon name, an image path inside Stash or a small data:image/png;base64 address (shown when the user turns icons on)
  badge: () => isBusy(),      // optional: true puts a dot on the icon; call window.StashPluginMenu?.refresh() when it changes
});
```

If a plugin of yours also draws its own top-bar entry, check `window.StashPluginMenu` at render time and skip your entry when it exists.

## Tests

`node tests/test_menu.js` (list cleaning, merging, placement of the icon; no browser needed).

## License

GNU AGPL-3.0, see [LICENSE](LICENSE). Copyright (c) 2026 northwindlab.
