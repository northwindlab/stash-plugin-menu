# Changelog

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
