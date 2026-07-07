import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Device, SnapshotNode } from "./device.js";
import {
  GROK_PACKAGE,
  PLAY_PACKAGE,
  WORK_ACCOUNT_MATCH,
  exists,
  findClick,
  openApp,
  openUrl,
  pressLabel,
  pressMatchingText,
  pressPoint,
  sleep,
  snapshot,
  waitFor,
} from "./device.js";

const execFileAsync = promisify(execFile);

/** Personal/home Play account to restore after alpha work (substring). Default: gmail.com */
export const HOME_ACCOUNT_MATCH =
  process.env.HOME_ACCOUNT_MATCH?.trim() ||
  process.env.RESTORE_ACCOUNT_MATCH?.trim() ||
  "gmail.com";

export type GrokListingAction = "updated" | "installed" | "already-latest";

/** Reserved for future alpha-flow knobs. Account switch is always enforced. */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AccountFlowOptions = {};

function blobOf(n: SnapshotNode): string {
  return `${n.label ?? ""} ${n.value ?? ""} ${n.identifier ?? ""}`;
}

export function accountMatchInNodes(nodes: SnapshotNode[], match: string): boolean {
  const q = match.toLowerCase();
  return nodes.some((n) => blobOf(n).toLowerCase().includes(q));
}

/**
 * Is Play already on this account? Works from any starting account.
 * Opens Play, checks UI; may open the account sheet (email often only there).
 */
export async function isPlayAccountActive(device: Device, match: string): Promise<boolean> {
  await openApp(device, PLAY_PACKAGE, { relaunch: true });
  await sleep(1500, device);

  try {
    await pressLabel(device, "Search");
    await sleep(800, device);
  } catch {
    /* ok */
  }

  let nodes = await snapshot(device);
  if (accountMatchInNodes(nodes, match)) return true;

  // Account sheet header / list often has the active email.
  try {
    await tapAccountAvatar(device);
    await sleep(1500, device);
    nodes = await snapshot(device);
    const active = accountMatchInNodes(nodes, match);
    await dismissAccountSheet(device);
    return active;
  } catch {
    return false;
  }
}

async function dismissAccountSheet(device: Device): Promise<void> {
  if (await exists(device, "Close")) {
    await findClick(device, "Close").catch(() => undefined);
  } else {
    // tap outside / top area
    await pressPoint(device, 540, 120).catch(() => undefined);
  }
  await sleep(800, device);
}

/**
 * Ensure Play is on `match` no matter which account was active before.
 * Skips the switch UI when already correct.
 */
export async function ensurePlayAccount(
  device: Device,
  match: string,
): Promise<"already" | "switched"> {
  console.log(`==> ensure Play account matching: ${match}`);
  if (await isPlayAccountActive(device, match)) {
    console.log(`==> already on account matching "${match}" — no switch needed`);
    return "already";
  }
  console.log(`==> currently not on "${match}" — switching`);
  await switchPlayAccount(device, match);

  // Verify once
  if (!(await isPlayAccountActive(device, match))) {
    throw new Error(
      `Failed to switch Play account to match "${match}". Check the account is on the device.`,
    );
  }
  return "switched";
}

/** Unconditional switch flow (always opens avatar → Switch account → row). */
export async function switchPlayAccount(device: Device, match: string): Promise<void> {
  await openApp(device, PLAY_PACKAGE, { relaunch: true });

  try {
    await pressLabel(device, "Search");
  } catch {
    await findClick(device, "Search").catch(() => undefined);
  }
  await sleep(1000, device);

  await tapAccountAvatar(device);
  await sleep(1500, device);

  // If already expanded list without "Switch account", still try matching row.
  const hasSwitch = await exists(device, "Switch account");
  if (hasSwitch) {
    try {
      await pressLabel(device, "Switch account");
    } catch {
      await findClick(device, "Switch account");
    }
    await sleep(2000, device);
  }

  await pressMatchingText(device, match);
  await sleep(2500, device);
}

async function tapAccountAvatar(device: Device): Promise<void> {
  const nodes = await snapshot(device);
  const candidates = nodes.filter((n) => {
    if (!n.hittable || !n.rect) return false;
    const { x, y, width, height } = n.rect;
    return (
      y >= 80 &&
      y <= 200 &&
      x >= 800 &&
      width >= 100 &&
      width <= 180 &&
      height >= 100 &&
      height <= 180
    );
  });

  if (candidates.length > 0) {
    const rightmost = candidates.sort((a, b) => (b.rect?.x ?? 0) - (a.rect?.x ?? 0))[0]!;
    const { x, y, width, height } = rightmost.rect!;
    await pressPoint(device, Math.round(x + width / 2), Math.round(y + height / 2));
    return;
  }

  await pressPoint(device, 944, 182);
}

async function listingHas(device: Device, label: string): Promise<boolean> {
  const nodes = await snapshot(device);
  const q = label.toLowerCase();
  return nodes.some((n) => {
    const lab = (n.label ?? n.value ?? "").trim().toLowerCase();
    return lab === q || lab.includes(q);
  });
}

export async function openGrokListing(device: Device): Promise<void> {
  try {
    await openUrl(device, `market://details?id=${GROK_PACKAGE}`);
  } catch {
    await execFileAsync("adb", [
      "shell",
      "am",
      "start",
      "-a",
      "android.intent.action.VIEW",
      "-d",
      `market://details?id=${GROK_PACKAGE}`,
    ]);
    await sleep(2500, device);
  }

  if (await exists(device, "Google Play Store")) {
    await pressLabel(device, "Google Play Store").catch(() =>
      findClick(device, "Google Play Store"),
    );
    await sleep(500, device);
    try {
      await pressLabel(device, "Just once");
    } catch {
      await pressLabel(device, "Always").catch(() => undefined);
    }
    await sleep(2000, device);
  }

  const end = Date.now() + 30_000;
  while (Date.now() < end) {
    if (
      (await listingHas(device, "Update")) ||
      (await listingHas(device, "Install")) ||
      (await listingHas(device, "Open")) ||
      (await listingHas(device, "Uninstall")) ||
      (await listingHas(device, "xAI"))
    ) {
      return;
    }
    await sleep(1500, device);
  }
}

async function waitOpenEnabled(device: Device, timeoutMs: number): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const nodes = await snapshot(device);
    const open = nodes.find((n) => {
      const lab = (n.label ?? n.value ?? "").trim();
      return lab === "Open" && n.enabled === true;
    });
    if (open) return;
    await sleep(3000, device);
  }
  throw new Error("Timed out waiting for enabled Open (install/update finished)");
}

const defaultTimeout = () => Number(process.env.INSTALL_TIMEOUT_MS ?? 300_000);

/**
 * UPDATE ONLY — never Uninstall, never first-time Install.
 * - Update → tap Update, wait until done
 * - Open (no Update) → already-latest
 * - Install only → not installed on this account (throw: use install-*)
 */
export async function updateGrokOnly(
  device: Device,
  timeoutMs = defaultTimeout(),
): Promise<GrokListingAction> {
  await openGrokListing(device);

  if (await listingHas(device, "Update")) {
    console.log("==> Update available — tapping Update (no reinstall)");
    await findClick(device, "Update").catch(() => pressLabel(device, "Update"));
    await waitOpenEnabled(device, timeoutMs);
    return "updated";
  }

  if (await listingHas(device, "Open")) {
    console.log("==> Already on latest for this Play account (Open visible, no Update).");
    return "already-latest";
  }

  if (await listingHas(device, "Install")) {
    throw new Error(
      'Grok is not installed on this Play account (only "Install" shown). Use install-last-alpha / install-last-prod, not update.',
    );
  }

  throw new Error("Grok listing has neither Update, Open, nor Install");
}

/**
 * Update if present, else first-time Install. Never Uninstall.
 * Open-only → already-latest.
 */
export async function updateOrInstallGrok(
  device: Device,
  timeoutMs = defaultTimeout(),
): Promise<GrokListingAction> {
  await openGrokListing(device);

  if (await listingHas(device, "Update")) {
    console.log("==> Update available — tapping Update");
    await findClick(device, "Update").catch(() => pressLabel(device, "Update"));
    await waitOpenEnabled(device, timeoutMs);
    return "updated";
  }
  if (await listingHas(device, "Install")) {
    console.log("==> Not installed on this account — tapping Install");
    await findClick(device, "Install").catch(() => pressLabel(device, "Install"));
    await waitOpenEnabled(device, timeoutMs);
    return "installed";
  }
  if (await listingHas(device, "Open")) {
    console.log("==> Already on latest for this Play account (Open visible, no Update).");
    return "already-latest";
  }
  throw new Error("Grok listing has neither Update, Install, nor Open");
}

/** Uninstall → Install (true reinstall). Never used by update-* actions. */
export async function reinstallGrok(device: Device, timeoutMs = defaultTimeout()): Promise<void> {
  await openGrokListing(device);

  if (await listingHas(device, "Uninstall")) {
    await findClick(device, "Uninstall").catch(() => pressLabel(device, "Uninstall"));
    await sleep(1000, device);
    for (const c of ["Uninstall", "OK", "Delete", "Yes"] as const) {
      if ((await listingHas(device, c)) || (await exists(device, c))) {
        await findClick(device, c).catch(() => undefined);
        break;
      }
    }
    await waitFor(device, { query: "Install" }, 120_000);
  } else if (!(await listingHas(device, "Install"))) {
    throw new Error("Neither Uninstall nor Install on Grok listing");
  }

  await findClick(device, "Install").catch(() => pressLabel(device, "Install"));
  await waitOpenEnabled(device, timeoutMs);
}

async function restoreHome(device: Device): Promise<void> {
  console.log(`==> restore home Play account matching: ${HOME_ACCOUNT_MATCH}`);
  await ensurePlayAccount(device, HOME_ACCOUNT_MATCH);
}

/**
 * UPDATE alpha only (no reinstall, no first install):
 * any account → ensure teachx → Update or already-latest → restore gmail
 */
export async function updateLastAlpha(
  device: Device,
  _opts?: AccountFlowOptions,
): Promise<GrokListingAction> {
  await ensurePlayAccount(device, WORK_ACCOUNT_MATCH);
  const result = await updateGrokOnly(device);
  if (result === "already-latest") {
    console.log(`==> User note: already on latest for ${WORK_ACCOUNT_MATCH} (no update needed).`);
  }
  await restoreHome(device);
  return result;
}

/**
 * Install/update alpha (Update or first Install, never Uninstall):
 * any account → ensure teachx → Update|Install|already-latest → restore gmail
 */
export async function installLastAlpha(
  device: Device,
  _opts?: AccountFlowOptions,
): Promise<GrokListingAction> {
  await ensurePlayAccount(device, WORK_ACCOUNT_MATCH);
  const result = await updateOrInstallGrok(device);
  if (result === "already-latest") {
    console.log(`==> User note: already on latest for ${WORK_ACCOUNT_MATCH}.`);
  }
  await restoreHome(device);
  return result;
}

/**
 * True reinstall on alpha/work account (Uninstall → Install) → restore gmail.
 */
export async function reinstallLastAlpha(
  device: Device,
  _opts?: AccountFlowOptions,
): Promise<void> {
  await ensurePlayAccount(device, WORK_ACCOUNT_MATCH);
  await reinstallGrok(device);
  await restoreHome(device);
}

/** UPDATE only on prod/personal account (no reinstall). Requires PROD_ACCOUNT_MATCH. */
export async function updateLastProd(
  device: Device,
  _opts?: AccountFlowOptions,
): Promise<GrokListingAction> {
  const match = process.env.PROD_ACCOUNT_MATCH?.trim();
  if (!match) {
    throw new Error("PROD_ACCOUNT_MATCH is required for update-last-prod (e.g. gmail.com).");
  }
  await ensurePlayAccount(device, match);
  return updateGrokOnly(device);
}

/** Reinstall on prod account (Uninstall → Install). Requires PROD_ACCOUNT_MATCH. */
export async function installLastProd(device: Device, _opts?: AccountFlowOptions): Promise<void> {
  const match = process.env.PROD_ACCOUNT_MATCH?.trim();
  if (!match) {
    throw new Error("PROD_ACCOUNT_MATCH is required for install-last-prod (e.g. gmail.com).");
  }
  await ensurePlayAccount(device, match);
  await reinstallGrok(device);
}
