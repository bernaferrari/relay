import { BrowserWorkspaceError, parseBrowserTiles, type BrowserTile } from "./browser-workspace";
import { restoreBrowserLayout, type BrowserLayout } from "./browser-workspace-layout";

export type BrowserWorkspaceState = { version: 2; tiles: BrowserTile[]; layout?: BrowserLayout };

/** Upgrade the original tile array without discarding any saved account identity. */
export function parseBrowserWorkspace(raw: string | null | undefined): BrowserWorkspaceState {
  if (!raw) return { version: 2, tiles: [] };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BrowserWorkspaceError("The saved browser workspace could not be read.");
  }
  if (Array.isArray(value)) {
    const tiles = parseBrowserTiles(raw);
    return {
      version: 2,
      tiles,
      layout: restoreBrowserLayout(
        undefined,
        tiles.map((tile) => tile.id),
      ),
    };
  }
  if (!value || typeof value !== "object" || (value as Record<string, unknown>).version !== 2)
    throw new BrowserWorkspaceError("The saved browser workspace could not be read.");
  const row = value as Record<string, unknown>;
  if (!Array.isArray(row.tiles))
    throw new BrowserWorkspaceError("The saved browser workspace could not be read.");
  const tiles = parseBrowserTiles(JSON.stringify(row.tiles));
  return {
    version: 2,
    tiles,
    layout: restoreBrowserLayout(
      row.layout,
      tiles.map((tile) => tile.id),
    ),
  };
}
