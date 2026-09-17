const SAFE_LANE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export function assertSafeBrowserLaneId(laneId: string): string {
  const id = laneId.trim();
  if (!SAFE_LANE_ID.test(id)) {
    throw new Error("Lane identifier is not a safe browser session key");
  }
  return id;
}

/** In-app tab identity. Same Lane → same jar. A Sign-in without a Lane
 * still isolates on target + fixture. Do not invent a second profile object. */
export function browserLaneTabSessionKey(input: {
  laneId?: string;
  targetId: string;
  authenticationFixtureId?: string;
}): string {
  const lane = input.laneId?.trim();
  if (lane) return `lane:${assertSafeBrowserLaneId(lane)}`;
  const fixture = input.authenticationFixtureId?.trim();
  const target = input.targetId.trim();
  if (fixture) return `signin:${target}:${fixture}`;
  return `lane:${target}:signed-out`;
}

export const BROWSER_LANE_SESSION_STORES = ["playwright-user-data", "electron-partition"] as const;
export type BrowserLaneSessionStoreKind = (typeof BROWSER_LANE_SESSION_STORES)[number];

/** Playwright headed Chrome user-data folder name. Not an Electron partition. */
export function browserLanePlaywrightUserDataName(targetId: string, laneId: string): string {
  return `${assertSafeBrowserLaneId(targetId)}__lane_${assertSafeBrowserLaneId(laneId)}`;
}

export type BrowserLaneCookieStore =
  | {
      kind: "playwright-user-data";
      laneId: string;
      targetId: string;
      name: string;
    }
  | {
      kind: "electron-partition";
      laneId: string;
      partition: string;
    };

/** Electron `session.fromPartition` key. Same Lane shares cookies across tabs.
 * This is not Playwright user-data (`id__lane_<lane>`). Naming both stores
 * after the Lane id is not cookie synchronization. */
export function browserLaneElectronPartition(laneId: string): string {
  const id = assertSafeBrowserLaneId(laneId);
  if (id.includes("__lane_")) {
    throw new Error("Electron partition cannot reuse Playwright user-data");
  }
  return `persist:lane:${id}`;
}

export function browserLaneCookieStore(
  input:
    | { kind: "playwright-user-data"; laneId: string; targetId: string }
    | { kind: "electron-partition"; laneId: string },
): BrowserLaneCookieStore {
  if (input.kind === "playwright-user-data") {
    return {
      kind: "playwright-user-data",
      laneId: assertSafeBrowserLaneId(input.laneId),
      targetId: assertSafeBrowserLaneId(input.targetId),
      name: browserLanePlaywrightUserDataName(input.targetId, input.laneId),
    };
  }
  return {
    kind: "electron-partition",
    laneId: assertSafeBrowserLaneId(input.laneId),
    partition: browserLaneElectronPartition(input.laneId),
  };
}

/** Mixing Playwright user-data with an Electron partition is not cookie reuse. */
export function bindBrowserLaneCookieStore(
  requested: BrowserLaneCookieStore,
  existing?: BrowserLaneCookieStore,
): BrowserLaneCookieStore {
  if (!existing) return requested;
  if (existing.kind !== requested.kind || existing.laneId !== requested.laneId) {
    throw new Error(
      `Lane ${requested.laneId} Playwright user-data and Electron persist:lane:${requested.laneId} are separate cookie stores`,
    );
  }
  if (existing.kind === "playwright-user-data" && requested.kind === "playwright-user-data") {
    if (existing.name !== requested.name || existing.targetId !== requested.targetId) {
      throw new Error("Playwright user-data does not match the requested Lane profile");
    }
  }
  if (existing.kind === "electron-partition" && requested.kind === "electron-partition") {
    if (existing.partition !== requested.partition) {
      throw new Error("Electron partition does not match the requested Lane");
    }
  }
  return requested;
}

export function browserLaneHostIdentity(input: {
  laneId: string;
  targetId: string;
  authenticationFixtureId?: string;
}): {
  laneId: string;
  tabSessionKey: string;
  electronPartition: string;
} {
  const laneId = assertSafeBrowserLaneId(input.laneId);
  return {
    laneId,
    tabSessionKey: browserLaneTabSessionKey({
      laneId,
      targetId: input.targetId,
      authenticationFixtureId: input.authenticationFixtureId,
    }),
    electronPartition: browserLaneElectronPartition(laneId),
  };
}

export const GROK_LAB_LANE_ID = "grok-lab";
export const GROK_LAB_ELECTRON_PARTITION = "persist:lane:grok-lab";
/** Chromium encodes `persist:lane:grok-lab` as this Partitions directory. */
export const GROK_LAB_ELECTRON_PARTITION_DIR = "lane%3Agrok-lab";

export function isGrokLabLaneId(laneId?: string): boolean {
  const lane = laneId?.trim() ?? "";
  return lane === GROK_LAB_LANE_ID || lane === GROK_LAB_ELECTRON_PARTITION;
}

/** In-app / Electron SuperGrok claim. Playwright `--lane grok-lab` is not this. */
export function claimsElectronGrokLabSuperGrok(input: {
  laneId?: string;
  sessionStore?: BrowserLaneSessionStoreKind;
  presentation?: "embedded" | "external";
}): boolean {
  const lane = input.laneId?.trim() ?? "";
  if (!isGrokLabLaneId(lane)) return false;
  if (lane === GROK_LAB_ELECTRON_PARTITION) return true;
  if (input.sessionStore === "electron-partition") return true;
  return input.presentation === "embedded";
}

export function electronGrokLabHealthReason(present: boolean): string {
  if (present) return "Electron persist:lane:grok-lab is present.";
  return "Electron persist:lane:grok-lab is absent. Playwright SuperGrok fixture is not Electron coverage.";
}

export const ELECTRON_GROK_LAB_ABSENT_REASON =
  "Electron persist:lane:grok-lab is absent. Playwright SuperGrok fixture is not that store. Blocked in the denominator, not a pass. Do not invent the partition.";

export const PLAYWRIGHT_NOT_ELECTRON_GROK_LAB_REASON =
  "Playwright grok-lab SuperGrok is not Electron persist:lane:grok-lab coverage. Separate cookie stores.";

/** Product-path preflight. Playwright `--lane grok-lab` stays allowed. */
export function electronGrokLabProductPathBlocker(input: {
  laneId?: string;
  sessionStore?: BrowserLaneSessionStoreKind;
  presentation?: "embedded" | "external";
  electronGrokLabPartitionPresent?: boolean;
}): string | undefined {
  if (!claimsElectronGrokLabSuperGrok(input)) return undefined;
  if (input.sessionStore === "playwright-user-data") {
    return PLAYWRIGHT_NOT_ELECTRON_GROK_LAB_REASON;
  }
  if (input.electronGrokLabPartitionPresent !== true) {
    return ELECTRON_GROK_LAB_ABSENT_REASON;
  }
  return undefined;
}
