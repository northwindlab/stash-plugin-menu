# Changelog

## 0.5.1
- Image addresses of the form `github.com/<user>/<repo>/raw/...` (or `/blob/...`) are loaded from `raw.githubusercontent.com`: the github.com address redirects without a CORS header, so the browser could not read it.

## 0.5.0
- Icon from an image address: paste an `https://` address into the icon field; the image is fetched once and only a small copy (PNG, at most 64 px) is kept in the setting, so nothing is requested from that site when the menu is shown. Works when the site lets other sites read its images (CORS); otherwise a message says so and the upload button is the way.

## 0.4.0
- Own images as icons: the upload button (⬆) next to the icon field scales an image down to a small PNG (at most 64 px, under 8 KB) and stores it in the setting; no external image addresses. A path inside Stash typed into the field still works.

## 0.3.1
- Icon field: clicking into it opens a grid of the icons themselves (filter by typing), instead of a plain list of names; the chosen icon is previewed next to the field.

## 0.3.0
- Rename every entry: your own ones in their name field, entries added by plugins in the second list (an empty field keeps the plugin's name).
- Optional icon in front of every entry (setting "Show an icon in front of every entry"); an icon is a FontAwesome name (`faBolt`) or an image path inside Stash, set per entry in the editor or passed by a plugin as `icon`.
- "Add an installed plugin" lists only plugins that have a page of their own, found by reading each plugin's script (a `register.route(...)` call or its `/plugins/<id>` address); a checkbox shows all plugins again. A hint, not a guarantee.
- New setting `prefs` (JSON) next to `pages`; both are always saved together.

## 0.2.1
- Fix: in a small window (collapsed top bar, icon far left and low) the panel is no longer cut off at the left or bottom edge: it is kept inside the window and opens above the icon when there is little room below; the window width is measured without the scrollbar.

## 0.2.0
- The menu is a floating panel (fixed under the icon, drawn on the page, not inside the top bar): it is no longer clipped or misplaced by themes or by the collapsed top bar of a narrow window; on narrow screens it spans the width. Closes on outside click, Escape, resize and navigation.

## 0.1.2
- The editor page is removed when Stash navigates away inside the app.

## 0.1.1
- A drop-down whenever there is at least one entry, so "Edit menu…" is always reachable.

## 0.1.0
- First version: one icon next to Statistics, a drop-down of plugin pages, an editor page, a small registry for other plugins.
