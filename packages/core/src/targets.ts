import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TargetCapability, TargetDefinition, TargetPreflight } from "@relay/protocol";
import { chromium } from "playwright-core";
import { findWorkspaceRoot } from "./workspace-root.js";

const DEFAULT_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function browserExecutable(target?: TargetDefinition): string {
  const configured = process.env.RELAY_BROWSER_EXECUTABLE?.trim();
  const allowed = new Set([DEFAULT_CHROME, ...(configured ? [configured] : [])]);
  const requested = target?.browser?.executablePath || configured || DEFAULT_CHROME;
  if (!allowed.has(requested)) {
    throw new Error("Browser target references an executable outside the server allowlist");
  }
  return requested;
}

function targetFile(): string {
  return join(targetRoot(), ".relay", "targets.json");
}

export function browserProfileDir(targetId: string): string {
  return join(targetRoot(), ".relay", "browser-profiles", targetId);
}

function targetRoot(): string {
  return process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot();
}

export async function listTargets(): Promise<TargetDefinition[]> {
  try {
    const parsed = JSON.parse(await readFile(targetFile(), "utf8")) as unknown;
    return Array.isArray(parsed) ? (parsed as TargetDefinition[]) : [];
  } catch {
    return [];
  }
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
  viewport?: { width: number; height: number };
}): Promise<TargetDefinition> {
  if (!input.name.trim()) throw new Error("target name is required");
  const requestedId = input.id?.trim();
  // Target ids become isolated-browser-profile directory names. Keep them
  // portable and path-safe when callers need a stable ID for YAML or schedules.
  if (requestedId && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(requestedId)) {
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
  const now = Date.now();
  const target: TargetDefinition = {
    id: requestedId ?? existing?.id ?? `browser-${randomUUID()}`,
    name: input.name.trim(),
    kind: "browser",
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    browser: {
      startUrl: url.toString(),
      executablePath: process.env.RELAY_BROWSER_EXECUTABLE?.trim() || DEFAULT_CHROME,
      // Visible by default: browser targets are black-box environments where
      // people often need to complete login or MFA before recording a test.
      headless: input.headless ?? false,
      viewport: input.viewport ?? { width: 1280, height: 800 },
    },
  };
  await writeTargets([...targets.filter((item) => item.id !== target.id), target]);
  return target;
}

export async function deleteTarget(id: string): Promise<void> {
  await writeTargets((await listTargets()).filter((target) => target.id !== id));
}

/** Capabilities implemented by the managed Playwright adapter. */
export const BROWSER_TARGET_CAPABILITIES: readonly TargetCapability[] = [
  "snapshot",
  "screenshot",
  "recording",
  "tap",
  "type",
  "scroll",
  "clipboard",
  "network",
  "logs",
];

export async function preflightTarget(target: TargetDefinition): Promise<TargetPreflight> {
  if (target.kind !== "browser" || !target.browser)
    throw new Error("only managed browser targets use this preflight");
  let executablePath: string;
  const checks: TargetPreflight["checks"] = [];
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
      browser = await chromium.launch({ executablePath, headless: true });
      const page = await browser.newPage();
      await page.goto(target.browser.startUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
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
