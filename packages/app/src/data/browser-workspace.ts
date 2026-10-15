import type { LiveBrowserOpenIdentity } from "./live-target-session";
import { admitLiveOpenPlan, type PairedConfigurationWorkspace } from "./paired-configuration";

export const BROWSER_WORKSPACE_KEY = "relay:browser-workspace:v1";
export const MAX_BROWSER_TILES = 4;
export class BrowserWorkspaceError extends Error {}
export type BrowserTile = {
  id: string;
  browserId: string;
  name: string;
  accountName: string;
  identity?: Pick<LiveBrowserOpenIdentity, "authenticationFixtureId" | "signedOut">;
};

/** One target owns one live page. Never apply two accounts to that same page. */
export function admitBrowserTile(tiles: readonly BrowserTile[], tile: BrowserTile): BrowserTile[] {
  if (tiles.length >= MAX_BROWSER_TILES)
    throw new BrowserWorkspaceError("A workspace holds up to four browsers.");
  if (tiles.some((current) => current.id === tile.id))
    throw new BrowserWorkspaceError("This browser tile is already open.");
  if (tiles.some((current) => current.browserId === tile.browserId)) {
    throw new BrowserWorkspaceError(
      "This profile is already open. Create another profile for a different account.",
    );
  }
  return [...tiles, tile];
}

export function parseBrowserTiles(raw: string | null | undefined): BrowserTile[] {
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new BrowserWorkspaceError("The saved browser workspace could not be read.");
  }
  if (!Array.isArray(value))
    throw new BrowserWorkspaceError("The saved browser workspace could not be read.");
  let tiles: BrowserTile[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object")
      throw new BrowserWorkspaceError("A saved browser tile is invalid.");
    const row = entry as Record<string, unknown>;
    if (
      ![row.id, row.browserId, row.name, row.accountName].every(
        (field) => typeof field === "string" && field.trim().length > 0,
      )
    ) {
      throw new BrowserWorkspaceError("A saved browser tile is incomplete.");
    }
    const identity = row.identity as Record<string, unknown> | undefined;
    if (
      row.identity !== undefined &&
      (!identity || typeof identity !== "object" || Array.isArray(identity))
    )
      throw new BrowserWorkspaceError("A saved account is invalid.");
    if (
      identity?.authenticationFixtureId !== undefined &&
      (typeof identity.authenticationFixtureId !== "string" ||
        !identity.authenticationFixtureId.trim())
    )
      throw new BrowserWorkspaceError("A saved account is invalid.");
    if (identity?.signedOut !== undefined && identity.signedOut !== true)
      throw new BrowserWorkspaceError("A saved account is invalid.");
    if (identity?.signedOut && identity.authenticationFixtureId)
      throw new BrowserWorkspaceError("A browser tile has conflicting accounts.");
    tiles = admitBrowserTile(tiles, {
      id: row.id as string,
      browserId: row.browserId as string,
      name: row.name as string,
      accountName: row.accountName as string,
      ...(identity
        ? {
            identity: {
              ...(typeof identity.authenticationFixtureId === "string"
                ? { authenticationFixtureId: identity.authenticationFixtureId }
                : {}),
              ...(identity.signedOut === true ? { signedOut: true as const } : {}),
            },
          }
        : {}),
    });
  }
  return tiles;
}

export function pairedBrowserTiles(workspace: PairedConfigurationWorkspace): BrowserTile[] {
  let tiles: BrowserTile[] = [];
  for (const row of admitLiveOpenPlan(workspace)) {
    tiles = admitBrowserTile(tiles, {
      id: row.browserId,
      browserId: row.browserId,
      name: row.name,
      accountName: row.accountName ?? "Signed out",
      identity: row.signedOut
        ? { signedOut: true }
        : {
            authenticationFixtureId:
              row.accountReference ?? `authfx:${row.accountId}:${row.accountRevision}`,
          },
    });
  }
  return tiles;
}

/** Moving tiles changes presentation only; browser and account identities stay attached. */
export function moveBrowserTile(
  tiles: readonly BrowserTile[],
  sourceId: string,
  targetId: string,
): BrowserTile[] {
  const source = tiles.findIndex((tile) => tile.id === sourceId);
  const target = tiles.findIndex((tile) => tile.id === targetId);
  if (source < 0 || target < 0 || source === target) return [...tiles];
  const next = [...tiles];
  const [tile] = next.splice(source, 1);
  next.splice(target, 0, tile!);
  return next;
}
