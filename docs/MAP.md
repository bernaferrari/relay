# The Map

Every Run grows its App's Map. Screens a Run reaches that the Map does not know are added with
the Run's screenshot and UI tree, and the moves between screens are added as draft paths. Draft
paths record what happened; saved Tests never replay them, so the Map can grow without review.

Each screen shows how recent Runs went: passing, failing, reached but untested, or not reached.
Screens added since you last opened the Map are marked new. Fix mistakes in the screen inspector
with rename or **Merge with another screen**.

Relay avoids duplicates by matching the Map against itself: an exact identity match first, then
a semantic comparison of the visible UI, then a name that matches exactly one existing screen.
With a model key configured, new screens are named from their screenshot.

The `app-map.observed` operation (also over MCP) returns the same per-screen status for agents.

## Keeping screen identity consistent

Keyboard and input focus states belong to the same logical screen. Capture automatically reuses a screen when current semantic evidence matches one saved app structure uniquely; it retains the new identity alias and capture. A shared title or sparse tree is insufficient to merge screens.

For existing duplicates, compare their captures in the App Map and use **Merge with another screen**. Agents can use `relay map screen consolidate <appMapId> <targetScreenId>` with `mode:"same-screen"`, `sourceScreenIds`, the current `expectedRevision`, and `dryRun:true` in `--input`. Inspect the preview before applying without dry run. The merge retains evidence and executable actions, rewires saved Tests, and keeps input states selectable as captures. Replay an affected Test after merging.

The map places saved Test origins first and groups parallel paths into one wire. Click a grouped wire and use **Choose path** to inspect its individual actions. Return paths stay beside their screen until inspected so they do not obscure forward navigation.
