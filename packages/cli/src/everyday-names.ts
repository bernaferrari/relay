/**
 * Everyday verbs accept the names people see (an App called "Shop", a Test
 * called "Checkout works", "ios") instead of internal ids. Ids still work.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppMap, AppMapScenarioTest } from "@relay/protocol";
import { callerCwd } from "./caller-cwd.js";
import { closestMatch } from "./cli-suggest.js";
import { CliError, ExitCode, UsageError } from "./errors.js";

export type EverydayInvoke = (
  operationId: string,
  input: Record<string, unknown>,
) => Promise<unknown>;

/** Defaults from `relay.json` in the directory where `relay` was typed. */
export type ProjectConfig = { app?: string; device?: string; url?: string };

const projectConfigFields = new Set(["app", "device", "url"]);

export function readProjectConfig(env: Record<string, string | undefined>): ProjectConfig {
  const path = join(callerCwd(env), "relay.json");
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw new UsageError(`Could not read ${path}: ${(error as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new UsageError(`${path} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new UsageError(`${path} must be a JSON object like {"app": "Shop", "device": "ios"}`);
  }
  const config: ProjectConfig = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === "$schema") continue;
    if (!projectConfigFields.has(key)) {
      throw new UsageError(`${path}: unknown field "${key}". Expected app, device, or url.`);
    }
    if (typeof value !== "string" || !value.trim()) {
      throw new UsageError(`${path}: "${key}" must be a non-empty string`);
    }
    config[key as keyof ProjectConfig] = value.trim();
  }
  return config;
}

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function notFound(message: string): CliError {
  return new CliError(message, ExitCode.notFound);
}

/** Exact id, then case-insensitive id or name, then slug. Misses suggest. */
export function pickByName<T extends { id: string; name: string }>(
  items: readonly T[],
  wanted: string,
  noun: string,
  listHint: string,
): T {
  const raw = wanted.trim();
  const lower = raw.toLowerCase();
  const byId =
    items.find((item) => item.id === raw) ?? items.find((item) => item.id.toLowerCase() === lower);
  if (byId) return byId;
  for (const matches of [
    items.filter((item) => item.name.trim().toLowerCase() === lower),
    items.filter((item) => slug(item.name) === slug(raw) || slug(item.id) === slug(raw)),
  ]) {
    if (matches.length === 1) return matches[0]!;
    if (matches.length > 1) {
      throw new UsageError(
        `${matches.length} ${noun}s match “${raw}”: ${matches.map((item) => `${item.name} (${item.id})`).join(", ")}. Use the id.`,
      );
    }
  }
  const suggestion =
    closestMatch(
      raw,
      items.map((item) => item.name),
    ) ??
    closestMatch(
      raw,
      items.map((item) => item.id),
    );
  throw notFound(
    `No ${noun} named “${raw}”.${suggestion ? ` Did you mean “${suggestion}”?` : ""} ${listHint}`,
  );
}

export async function listApps(invoke: EverydayInvoke): Promise<AppMap[]> {
  const response = (await invoke("app-map.list", {})) as { appMaps?: unknown };
  return Array.isArray(response?.appMaps)
    ? (response.appMaps.filter(
        (map) => map && typeof map === "object" && typeof (map as AppMap).id === "string",
      ) as AppMap[])
    : [];
}

export function appName(map: Pick<AppMap, "id" | "name">): string {
  return typeof map.name === "string" && map.name.trim() ? map.name : map.id;
}

export function pickApp(apps: readonly AppMap[], wanted: string): AppMap {
  return pickByName(
    apps.map((map) => Object.assign(map, { name: appName(map) })),
    wanted,
    "app",
    "Run 'relay apps' to list them.",
  );
}

/** The App named on the command line, else relay.json's, else the only one. */
export async function chooseApp(
  invoke: EverydayInvoke,
  wanted: string | undefined,
  config: ProjectConfig,
): Promise<AppMap> {
  const apps = await listApps(invoke);
  const name = wanted ?? config.app;
  if (name) return pickApp(apps, name);
  if (apps.length === 1) return apps[0]!;
  if (!apps.length) {
    throw notFound(
      `No apps yet. Create a Test with: relay new "<what should work>" --url <website>`,
    );
  }
  throw new UsageError(
    `Which app? ${apps.length} exist: ${apps
      .slice(0, 8)
      .map((map) => appName(map))
      .join(
        ", ",
      )}${apps.length > 8 ? ", …" : ""}. Pass --app <name> or add {"app": "<name>"} to relay.json.`,
  );
}

export function scenarioTests(map: AppMap): AppMapScenarioTest[] {
  return Object.values(map.tests ?? {}).filter(
    (test): test is AppMapScenarioTest =>
      Boolean(test) && typeof test === "object" && test.kind === "scenario",
  );
}

export function pickTest(map: AppMap, wanted: string): AppMapScenarioTest {
  return pickByName(
    scenarioTests(map),
    wanted,
    "Test",
    `Run 'relay tests ${shellWord(appName(map))}' to list them.`,
  );
}

/** A Test by name when no App was given: search every App. */
export function findTestInApps(
  apps: readonly AppMap[],
  wanted: string,
): { app: AppMap; test: AppMapScenarioTest } {
  const entries = apps.flatMap((app) => scenarioTests(app).map((test) => ({ app, test })));
  const byId = entries.filter(({ test }) => test.id === wanted.trim());
  if (byId.length === 1) return byId[0]!;
  const lower = wanted.trim().toLowerCase();
  const byName = entries.filter(
    ({ test }) =>
      test.id.toLowerCase() === lower ||
      test.name.trim().toLowerCase() === lower ||
      slug(test.name) === slug(wanted),
  );
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1 || byId.length > 1) {
    const listed = (byName.length ? byName : byId).slice(0, 6);
    throw new UsageError(
      `More than one Test matches “${wanted}”: ${listed
        .map(({ app, test }) => `${test.name} in ${appName(app)}`)
        .join("; ")}. Add --app <name>.`,
    );
  }
  const suggestion = closestMatch(
    wanted,
    entries.map(({ test }) => test.name),
  );
  throw notFound(
    `No Test named “${wanted}”.${suggestion ? ` Did you mean “${suggestion}”?` : ""} Run 'relay tests' to list them.`,
  );
}

const platformWords: Record<string, string> = {
  ios: "iOS",
  android: "Android",
  browser: "browser",
};

type DeviceRow = {
  id?: unknown;
  serial?: unknown;
  name?: unknown;
  platform?: unknown;
  booted?: unknown;
  connectionState?: unknown;
};

function deviceId(device: DeviceRow): string | undefined {
  return typeof device.serial === "string"
    ? device.serial
    : typeof device.id === "string"
      ? device.id
      : undefined;
}

/**
 * `ios`, `android`, or `browser` picks the single connected device of that
 * kind; a device name or id picks that device. Unknown values pass through
 * unchanged so the server can explain what it accepts.
 */
export async function resolveDevice(invoke: EverydayInvoke, wanted: string): Promise<string> {
  const response = (await invoke("target.devices.list", {})) as { devices?: unknown };
  const devices = (Array.isArray(response?.devices) ? response.devices : []).filter(
    (device): device is DeviceRow => Boolean(device) && typeof device === "object",
  );
  const lower = wanted.trim().toLowerCase();
  const platform = platformWords[lower];
  if (platform) {
    const matching = devices.filter(
      (device) =>
        device.platform === lower &&
        device.booted !== false &&
        device.connectionState !== "disconnected" &&
        deviceId(device),
    );
    if (matching.length === 1) return deviceId(matching[0]!)!;
    if (!matching.length) {
      throw notFound(`No ${platform} device is connected. Run 'relay devices' to see what is.`);
    }
    const listed = matching
      .slice(0, 10)
      .map((device) => `  ${String(device.name ?? deviceId(device))}  (${deviceId(device)})`);
    throw new UsageError(
      [
        `${matching.length} ${platform} devices are connected. Choose one with --device <name or id>:`,
        ...listed,
        ...(matching.length > 10 ? [`  …and ${matching.length - 10} more ('relay devices')`] : []),
      ].join("\n"),
    );
  }
  const exact = devices.find((device) => device.id === wanted || device.serial === wanted);
  if (exact) return deviceId(exact)!;
  const named = devices.filter(
    (device) => typeof device.name === "string" && device.name.trim().toLowerCase() === lower,
  );
  if (named.length === 1) return deviceId(named[0]!) ?? wanted;
  if (named.length > 1) {
    throw new UsageError(
      `${named.length} devices are named “${wanted}”: ${named.map((device) => deviceId(device)).join(", ")}. Use the id.`,
    );
  }
  return wanted;
}

export function shellWord(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/u.test(value)
    ? value
    : `"${value.replaceAll(/(["\\$`])/gu, "\\$1")}"`;
}
