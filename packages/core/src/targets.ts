import { BROWSER_TARGET_CAPABILITIES } from "./browser-target-capabilities.js";
import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetDefinition, TargetKind, TargetPreflight } from "@relay/protocol";
import {
  browserLanePlaywrightUserDataName,
  compileBrowserEnvironment,
  validateBrowserEnvironment,
} from "@relay/protocol";
import type { BrowserEnvironmentInput, BrowserViewport } from "@relay/protocol";
import { chromium, firefox, webkit } from "playwright-core";
import type { BrowserType } from "playwright-core";
import { unsupportedBrowserCaseProfileFields } from "./browser-profile-support.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { MACOS_CHROME, resolveBrowserExecutable } from "./browser-executable.js";

export function browserExecutable(target?: TargetDefinition): string {
  const configured = process.env.RELAY_BROWSER_EXECUTABLE?.trim();
  const resolved = resolveBrowserExecutable();
  const allowed = new Set([
    MACOS_CHROME,
    ...resolved.candidates,
    ...(configured ? [configured] : []),
  ]);
  const requested = target?.browser?.executablePath || configured || resolved.path;
  if (!requested) {
    throw new Error(
      "No supported Chromium browser found. Install Chrome or Chromium, or set RELAY_BROWSER_EXECUTABLE to an absolute executable path before starting Relay.",
    );
  }
  if (!allowed.has(requested)) {
    throw new Error("Browser target references an executable outside the server allowlist");
  }
  return requested;
}

function targetFile(): string {
  return join(targetRoot(), ".relay", "targets.json");
}

/** Authoring user-data. Unsigned Lanes are siblings (`id__lane_<lane>`), never
 * nested inside another Chrome profile. Proof stays a fresh host-pool context. */
export function browserProfileDir(targetId: string, unsignedLaneId?: string): string {
  const root = join(targetRoot(), ".relay", "browser-profiles");
  const lane = unsignedLaneId?.trim();
  if (!lane) return join(root, targetId);
  if (lane.includes("persist:lane:")) {
    throw new Error("Playwright user-data cannot reuse an Electron partition");
  }
  return join(root, browserLanePlaywrightUserDataName(targetId, lane));
}

async function removeBrowserProfileDirs(targetId: string): Promise<void> {
  const root = join(targetRoot(), ".relay", "browser-profiles");
  await rm(join(root, targetId), { recursive: true, force: true });
  let entries: string[] = [];
  try {
    entries = await readdir(root);
  } catch {
    return;
  }
  const prefix = `${targetId}__lane_`;
  await Promise.all(
    entries
      .filter((name) => name.startsWith(prefix))
      .map((name) => rm(join(root, name), { recursive: true, force: true })),
  );
}

function targetRoot(): string {
  return process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot();
}

const VALID_TARGET_KINDS: Record<TargetKind, true> = { android: true, ios: true, browser: true };
const SAFE_TARGET_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

/** Returns why `value` is not a usable TargetDefinition, or null when it validates. */
function targetDefinitionProblem(value: unknown): string | null {
  if (typeof value !== "object" || value === null) return "entry is not an object";
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string" || !SAFE_TARGET_ID.test(entry.id)) {
    return "id must use letters, numbers, hyphens, and underscores only";
  }
  if (typeof entry.name !== "string" || entry.name === "") return "name must be a non-empty string";
  if (typeof entry.kind !== "string" || !(entry.kind in VALID_TARGET_KINDS)) {
    return "kind must be one of android, ios, browser";
  }
  if (typeof entry.createdAt !== "number") return "createdAt must be a number";
  if (typeof entry.updatedAt !== "number") return "updatedAt must be a number";
  if (entry.browser !== undefined) {
    if (typeof entry.browser !== "object" || entry.browser === null) {
      return "browser must be an object";
    }
    const browser = entry.browser as Record<string, unknown>;
    if (typeof browser.startUrl !== "string") return "browser.startUrl must be a string";
    if (browser.environment !== undefined) {
      const validation = validateBrowserEnvironment(browser.environment);
      if (!validation.ok) return `browser.environment is invalid: ${validation.errors.join("; ")}`;
    }
  }
  return null;
}

export async function listTargets(): Promise<TargetDefinition[]> {
  let raw: string;
  try {
    raw = await readFile(targetFile(), "utf8");
  } catch {
    // A missing or unreadable store simply means no targets yet.
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(
      `targets: ${targetFile()} contains malformed JSON (${reason}); ignoring file contents`,
    );
    return [];
  }
  if (!Array.isArray(parsed)) {
    console.warn(`targets: ${targetFile()} does not contain a JSON array; ignoring file contents`);
    return [];
  }
  const targets: TargetDefinition[] = [];
  parsed.forEach((entry, index) => {
    const problem = targetDefinitionProblem(entry);
    if (problem === null) targets.push(entry as TargetDefinition);
    else console.warn(`targets: ${targetFile()} entry at index ${index} skipped (${problem})`);
  });
  return targets;
}

async function writeTargets(targets: TargetDefinition[]): Promise<void> {
  await mkdir(join(targetRoot(), ".relay"), { recursive: true });
  await writeFile(targetFile(), JSON.stringify(targets, null, 2), "utf8");
}

export async function readTarget(id: string): Promise<TargetDefinition | null> {
  return (await listTargets()).find((target) => target.id === id) ?? null;
}

export async function saveBrowserTarget(input: {
  id?: string;
  name: string;
  startUrl: string;
  /** @deprecated Host executable selection is server-owned and this value is ignored. */
  executablePath?: string;
  headless?: boolean;
  viewport?: BrowserViewport;
  environment?: BrowserEnvironmentInput;
  profileRetention?: "retain" | "ephemeral";
}): Promise<TargetDefinition> {
  if (!input.name.trim()) throw new Error("target name is required");
  const requestedId = input.id?.trim();
  // Target ids become isolated-browser-profile directory names. Keep them
  // portable and path-safe when callers need a stable ID for YAML or schedules.
  if (requestedId && !SAFE_TARGET_ID.test(requestedId)) {
    throw new Error("target id must use letters, numbers, hyphens, and underscores only");
  }
  let url: URL;
  try {
    url = new URL(input.startUrl);
  } catch {
    throw new Error("start URL must be a valid http or https URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:")
    throw new Error("start URL must use http or https");
  const targets = await listTargets();
  const existing = requestedId ? targets.find((target) => target.id === requestedId) : undefined;
  const environment =
    input.environment === undefined ? undefined : compileBrowserEnvironment(input.environment);
  const executablePath =
    process.env.RELAY_BROWSER_EXECUTABLE?.trim() || resolveBrowserExecutable().path;
  const now = Date.now();
  const target: TargetDefinition = {
    id: requestedId ?? existing?.id ?? `browser-${randomUUID()}`,
    name: input.name.trim(),
    kind: "browser",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    browser: {
      startUrl: url.toString(),
      ...(executablePath ? { executablePath } : {}),
      // Visible by default: browser targets are black-box environments where
      // people often need to complete login or MFA before recording a test.
      headless: input.headless ?? false,
      viewport: input.viewport ?? { width: 1280, height: 800 },
      profileRetention: input.profileRetention ?? existing?.browser?.profileRetention ?? "retain",
      ...(environment ? { environment } : {}),
    },
  };
  await writeTargets([...targets.filter((item) => item.id !== target.id), target]);
  return target;
}

export async function deleteTarget(id: string): Promise<void> {
  const targets = await listTargets();
  const target = targets.find((item) => item.id === id);
  // A normal authoring target deletion only removes its registry entry. An
  // explicitly ephemeral target owns its isolated browser profile, including
  // recordings, so deleting that target also removes only that safe path.
  if (
    target?.kind === "browser" &&
    target.browser?.profileRetention === "ephemeral" &&
    SAFE_TARGET_ID.test(target.id)
  ) {
    await removeBrowserProfileDirs(target.id);
  }
  await writeTargets(targets.filter((item) => item.id !== id));
}

/** Capabilities implemented by the managed Playwright adapter. */
export { BROWSER_TARGET_CAPABILITIES } from "./browser-target-capabilities.js";

const PREFLIGHT_PASS_TTL_MS = 5 * 60_000;
const PREFLIGHT_FAIL_TTL_MS = 30_000;
const preflightCache = new Map<
  string,
  { key: string; expiresAt: number; result: Promise<TargetPreflight> }
>();

/**
 * Readiness for pickers. A real browser launch per target per listing made the
 * device picker take ~30s with a handful of saved browsers, so recent results
 * are reused. Concurrent callers share one in-flight check. Runs still call
 * `preflightTarget` directly before they take control.
 */
export function preflightTargetCached(
  target: TargetDefinition,
  options: { fresh?: boolean; now?: number } = {},
): Promise<TargetPreflight> {
  const now = options.now ?? Date.now();
  const key = `${target.updatedAt}:${JSON.stringify(target.browser ?? null)}`;
  const cached = preflightCache.get(target.id);
  if (!options.fresh && cached && cached.key === key && cached.expiresAt > now) {
    return cached.result;
  }
  const result = preflightTarget(target);
  const entry = { key, expiresAt: now + PREFLIGHT_FAIL_TTL_MS, result };
  preflightCache.set(target.id, entry);
  result.then(
    (preflight) => {
      if (preflightCache.get(target.id) !== entry) return;
      entry.expiresAt = Date.now() + (preflight.ok ? PREFLIGHT_PASS_TTL_MS : PREFLIGHT_FAIL_TTL_MS);
    },
    () => {
      if (preflightCache.get(target.id) === entry) preflightCache.delete(target.id);
    },
  );
  return result;
}

export async function preflightTarget(target: TargetDefinition): Promise<TargetPreflight> {
  if (target.kind !== "browser" || !target.browser)
    throw new Error("only managed browser targets use this preflight");
  const environment = compileBrowserEnvironment(target.browser.environment ?? {});
  const browserType: BrowserType =
    environment.engine === "chromium"
      ? chromium
      : environment.engine === "firefox"
        ? firefox
        : webkit;
  let executablePath: string;
  const checks: TargetPreflight["checks"] = [];
  const unsupportedProfileFields = unsupportedBrowserCaseProfileFields(environment);
  if (unsupportedProfileFields.length > 0) {
    checks.push({
      id: "environment-fixtures",
      label: "Browser environment fixtures",
      status: "fail",
      message: `Fixture resolvers are unavailable for: ${unsupportedProfileFields.join(", ")}`,
    });
  }
  if (environment.engine === "chromium" && environment.channel === undefined) {
    try {
      executablePath = browserExecutable(target);
    } catch (error) {
      checks.push({
        id: "executable-policy",
        label: "Browser executable policy",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
      return {
        targetId: target.id,
        ok: false,
        checkedAt: Date.now(),
        capabilities: [...BROWSER_TARGET_CAPABILITIES],
        checks,
      };
    }
  } else {
    // Non-Chromium engines use their own Playwright browser binary. Do not
    // inspect or substitute the Chromium executable for these profiles.
    executablePath = "";
    checks.push({
      id: "engine",
      label: "Browser engine",
      status: "pass",
      message: `Playwright ${environment.engine} selected without Chromium fallback`,
    });
  }
  if (environment.engine === "chromium" && environment.channel === undefined) {
    try {
      await access(executablePath);
      checks.push({
        id: "executable",
        label: "Browser executable",
        status: "pass",
        message: executablePath,
      });
    } catch {
      checks.push({
        id: "executable",
        label: "Browser executable",
        status: "fail",
        message: `Chrome was not found at ${executablePath}`,
      });
    }
  }
  try {
    await mkdir(browserProfileDir(target.id), { recursive: true });
    checks.push({
      id: "profile",
      label: "Isolated profile",
      status: "pass",
      message: "Profile storage is writable and isolated from personal browsing.",
    });
  } catch (error) {
    checks.push({
      id: "profile",
      label: "Isolated profile",
      status: "fail",
      message: error instanceof Error ? error.message : String(error),
    });
  }
  if (!checks.some((check) => check.status === "fail")) {
    let browser;
    try {
      browser = await browserType.launch({
        ...(executablePath ? { executablePath } : {}),
        ...(environment.channel ? { channel: environment.channel } : {}),
        headless: true,
      });
      const context = await browser.newContext({
        viewport: environment.viewport,
        locale: environment.locale,
        timezoneId: environment.timezoneId,
        colorScheme: environment.colorScheme,
        reducedMotion: environment.reducedMotion,
        offline: environment.offline,
      });
      const page = await context.newPage();
      await page.goto(target.browser.startUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
      checks.push({
        id: "navigation",
        label: "Start page",
        status: "pass",
        message: `Reached ${new URL(page.url()).origin}`,
      });
    } catch (error) {
      checks.push({
        id: "navigation",
        label: "Start page",
        status: "fail",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      await browser?.close().catch(() => undefined);
    }
  }
  return {
    targetId: target.id,
    ok: !checks.some((check) => check.status === "fail"),
    checkedAt: Date.now(),
    capabilities: [...BROWSER_TARGET_CAPABILITIES],
    checks,
  };
}

/**
 * Check saved browsers once in the background so the first device picker a
 * person opens is already warm. One at a time, so startup stays quiet.
 */
export async function warmBrowserPreflights(): Promise<void> {
  for (const target of await listTargets()) {
    if (target.kind !== "browser" || !target.browser || /^goal-/u.test(target.id)) continue;
    await preflightTargetCached(target).catch(() => undefined);
  }
}
