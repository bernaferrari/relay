/**
 * Generic app switcher profiles.
 *
 * A switcher is any screen that offers a list of mutually exclusive options
 * (language, account, environment, theme, workspace, …). Capture the path to
 * that list and the option rows once; corpus/map-once-replay and recipe
 * matrices expand option tags without re-authoring navigation.
 *
 * Language is one kind — not a special-case product.
 */
import type { ProfileNavStep } from "./profile-nav.js";
import {
  openApp,
  pressIdentifier,
  pressKey,
  pressLabel,
  pressMatchingText,
  scrollDown,
  sleep,
  snapshot,
  swipeGesture,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { createDeviceForTarget } from "./device-factory.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";
import { extractSwitcherOptionsFromNodes } from "./variable-option-inference.js";
import {
  attachSwitcherScanOutcomeUnknownDiagnostic,
  createSwitcherScanProgress,
  type SwitcherScanProgress,
} from "./switcher-scan-outcome.js";
import { runWithTargetContext } from "./target-context.js";
import { devicePlatformForSerial } from "./workspace.js";

export {
  switcherScanOutcomeUnknownDiagnostic,
  type SwitcherScanOutcomeUnknownDiagnostic,
} from "./switcher-scan-outcome.js";
import { readWorkspaceSetting, writeWorkspaceSetting } from "./workspace-settings.js";

export type SwitcherKind =
  | "language"
  | "account"
  | "environment"
  | "theme"
  | "workspace"
  | "build"
  | "custom";

export type SwitcherOption = {
  /** Stable tag used in packs/matrices (e.g. en, staging, dark). */
  id: string;
  /** Primary row label as shown in the picker. */
  label: string;
  aliases?: string[];
  identifier?: string;
};

export type SwitcherProfile = {
  id: string;
  name: string;
  kind: SwitcherKind;
  /** Bundle id / package / launch name. */
  app: string;
  platform?: "ios" | "android" | "any";
  /** Path from cold open to the surface that contains the switcher entry. */
  entryPath: ProfileNavStep[];
  /** Path from entry surface to the option list. */
  pickerPath: ProfileNavStep[];
  options: SwitcherOption[];
  defaultOptionId?: string;
  notes?: string;
  verifiedAt?: string;
  scanned?: boolean;
};

const PROFILE_FILE = "switcher-profiles.json";

/** Seed: Grok iOS App Language — one concrete switcher, not the product model. */
const GROK_IOS_LANGUAGE: SwitcherProfile = {
  id: "grok-ios-language",
  name: "Grok · App Language (iOS)",
  kind: "language",
  app: "ai.x.GrokApp",
  platform: "ios",
  entryPath: [
    // Settings gear lives on the Ask tab sidebar; Imagine/Build hide it.
    { kind: "tap", target: { identifier: "navigation.tab.ask" } },
    { kind: "wait", ms: 400 },
    { kind: "tap", target: { identifier: "sidebar.open.button" } },
    { kind: "wait", ms: 500 },
    // Gear is the real control; a "Settings" label is the sheet title only.
    { kind: "tap", target: { identifier: "sidebar.settings.button" } },
    { kind: "wait", ms: 700 },
  ],
  pickerPath: [
    // Deep-links into iOS Settings → Grok → Preferred Language → Language.
    { kind: "tap", target: { text: "App Language" } },
    { kind: "wait", ms: 1200 },
    // Bind XCTest to Preferences without relaunch (keeps the deep-linked page).
    { kind: "openApp", app: "com.apple.Preferences", relaunch: false },
    { kind: "wait", ms: 900 },
    { kind: "tap", target: { text: "Language" } },
    { kind: "wait", ms: 700 },
  ],
  options: [
    { id: "en", label: "English", aliases: ["ENGLISH", "Default", "Reorder English"] },
    {
      id: "pt-BR",
      label: "Português (Brasil)",
      aliases: ["Portuguese (Brazil)", "Português", "Reorder Português (Brasil)"],
    },
    { id: "it", label: "Italiano", aliases: ["Italian", "Reorder Italiano"] },
  ],
  defaultOptionId: "en",
  notes:
    "Grok App Language opens iOS Settings preferred-language list. Scan options on device replaces the seed list. Works as a generic switcher profile (same model as account/env pickers).",
  verifiedAt: "2026-08-05",
  scanned: false,
};

const PROFILE_ALIASES: Record<string, string> = {
  "grok-ios": "grok-ios-language",
};

type StoredProfiles = {
  version: 1;
  profiles: SwitcherProfile[];
};

async function readStored(): Promise<SwitcherProfile[]> {
  const raw = await readWorkspaceSetting(PROFILE_FILE);
  if (!raw || typeof raw !== "object") return [];
  const record = raw as StoredProfiles;
  if (record.version !== 1 || !Array.isArray(record.profiles)) return [];
  return record.profiles.filter(
    (profile) =>
      profile &&
      typeof profile.id === "string" &&
      Array.isArray(profile.options) &&
      Array.isArray(profile.entryPath) &&
      Array.isArray(profile.pickerPath),
  );
}

async function writeStored(profiles: SwitcherProfile[]): Promise<void> {
  await writeWorkspaceSetting(PROFILE_FILE, {
    version: 1,
    profiles,
  } satisfies StoredProfiles);
}

function builtins(): SwitcherProfile[] {
  return [structuredClone(GROK_IOS_LANGUAGE)];
}

function resolveId(id: string): string {
  return PROFILE_ALIASES[id] ?? id;
}

export async function listSwitcherProfiles(filter?: {
  kind?: SwitcherKind;
  app?: string;
}): Promise<SwitcherProfile[]> {
  const stored = await readStored();
  const byId = new Map<string, SwitcherProfile>();
  for (const profile of builtins()) byId.set(profile.id, profile);
  for (const profile of stored) byId.set(profile.id, structuredClone(profile));
  let list = [...byId.values()];
  if (filter?.kind) list = list.filter((profile) => profile.kind === filter.kind);
  if (filter?.app) {
    const needle = filter.app.trim().toLocaleLowerCase();
    list = list.filter((profile) => profile.app.toLocaleLowerCase() === needle);
  }
  return list.sort((left, right) => left.name.localeCompare(right.name));
}

export async function getSwitcherProfile(id: string): Promise<SwitcherProfile | undefined> {
  const resolved = resolveId(id.trim());
  const profiles = await listSwitcherProfiles();
  return profiles.find((profile) => profile.id === resolved);
}

export async function saveSwitcherProfile(profile: SwitcherProfile): Promise<SwitcherProfile> {
  if (!profile.id?.trim()) throw new Error("profile id is required");
  if (!profile.app?.trim()) throw new Error("profile app is required");
  if (!profile.kind) throw new Error("profile kind is required");
  if (!profile.options?.length) throw new Error("profile needs at least one option");
  if (!profile.entryPath?.length || !profile.pickerPath?.length) {
    throw new Error("profile needs entryPath and pickerPath");
  }
  const next = structuredClone(profile);
  next.id = next.id.trim();
  next.verifiedAt = next.verifiedAt ?? new Date().toISOString().slice(0, 10);
  const stored = await readStored();
  const index = stored.findIndex((item) => item.id === next.id);
  if (index >= 0) {
    // Keep a one-shot backup so a bad live scan can be recovered without git.
    try {
      const root = process.env.RELAY_WORKSPACE_ROOT?.trim();
      if (root) {
        const { writeFile } = await import("node:fs/promises");
        const { join } = await import("node:path");
        await writeFile(
          join(root, ".relay", "switcher-profiles.json.bak"),
          `${JSON.stringify({ version: 1, profiles: stored }, null, 2)}\n`,
          "utf8",
        );
      }
    } catch {
      // best-effort backup
    }
    stored[index] = next;
  } else {
    stored.push(next);
  }
  await writeStored(stored);
  return structuredClone(next);
}

/** Union scanned options into a previous profile so a partial scan cannot wipe seeds. */
export function mergeSwitcherOptions(
  previous: SwitcherOption[],
  scanned: SwitcherOption[],
): SwitcherOption[] {
  const byId = new Map<string, SwitcherOption>();
  for (const option of previous) byId.set(option.id, structuredClone(option));
  for (const option of scanned) {
    const existing = byId.get(option.id);
    if (!existing) {
      byId.set(option.id, structuredClone(option));
      continue;
    }
    const aliases = new Set([...(existing.aliases ?? []), option.label, ...(option.aliases ?? [])]);
    aliases.delete(existing.label);
    byId.set(option.id, {
      ...existing,
      // Prefer freshly scanned accessibility identifiers when present.
      ...(option.identifier ? { identifier: option.identifier } : {}),
      aliases: [...aliases],
    });
  }
  return [...byId.values()].sort((left, right) =>
    left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
  );
}

function optionForId(profile: SwitcherProfile, id: string): SwitcherOption | undefined {
  const needle = id.trim().toLocaleLowerCase();
  return profile.options.find(
    (option) =>
      option.id.toLocaleLowerCase() === needle ||
      option.label.toLocaleLowerCase() === needle ||
      option.aliases?.some((alias) => alias.toLocaleLowerCase() === needle),
  );
}

function resolveSwitcherTargets(
  profile: SwitcherProfile,
  optionIds: string[],
): Record<string, { label?: string; identifier?: string; text?: string }> {
  const out: Record<string, { label?: string; identifier?: string; text?: string }> = {};
  for (const id of optionIds) {
    const option = optionForId(profile, id);
    if (!option) {
      out[id] = { label: id };
      continue;
    }
    out[id] = option.identifier ? { identifier: option.identifier } : { label: option.label };
  }
  return out;
}


export type SwitcherMatrixScope = {
  options: string[];
  app?: string;
  relaunch?: boolean;
  entryPath?: ProfileNavStep[];
  pickerPath?: ProfileNavStep[];
  optionTargets?: Record<string, { label?: string; identifier?: string; text?: string }>;
  restoreOptionId?: string;
  restoreAtEnd?: boolean;
  screenshotEach?: boolean;
};

export async function matrixScopeFromSwitcherProfile(
  profileId: string,
  optionIds: string[],
  overrides?: Partial<SwitcherMatrixScope>,
): Promise<SwitcherMatrixScope> {
  const profile = await getSwitcherProfile(profileId);
  if (!profile) throw new Error(`unknown switcher profile: ${profileId}`);
  const tags = [...new Set(optionIds.map((id) => id.trim()).filter(Boolean))];
  if (!tags.length) throw new Error("at least one option is required");
  return {
    options: tags,
    app: profile.app,
    relaunch: true,
    entryPath: structuredClone(profile.entryPath),
    pickerPath: structuredClone(profile.pickerPath),
    optionTargets: resolveSwitcherTargets(profile, tags),
    restoreOptionId: profile.defaultOptionId ?? tags[0],
    restoreAtEnd: true,
    screenshotEach: true,
    ...overrides,
  };
}

function looksLikeOptionList(nodes: SnapshotNode[], kind: SwitcherKind): boolean {
  const options = extractSwitcherOptionsFromNodes(nodes);
  if (options.length >= 3) return true;
  if (kind !== "language") return options.length >= 1;
  // Language lists almost always include English or a non-Latin script row.
  return options.some((option) =>
    /english|portug|fran[cç]ais|deutsch|español|italiano|中文|日本語|한국어|العربية|русский/i.test(
      option.label,
    ),
  );
}

async function ensureOptionList(
  device: Device,
  app: string,
  entryPath: ProfileNavStep[],
  pickerPath: ProfileNavStep[],
  kind: SwitcherKind,
  progress: SwitcherScanProgress,
): Promise<void> {
  const observePicker = async (): Promise<boolean> => {
    const nodes = await snapshot(device);
    const proven = looksLikeOptionList(nodes, kind);
    if (proven) progress.pickerProven = true;
    return proven;
  };

  progress.phase = "ensure-picker";
  if (await observePicker()) return;

  // Recovery for OS deep-links (Grok App Language → Preferences):
  // Preferences may already be foregrounded on the app page.
  if (kind === "language") {
    try {
      await openApp(device, "com.apple.Preferences", { relaunch: false });
      await sleep(800, device);
    } catch (error) {
      rethrowIosMutationOutcomeUnknown(error);
      /* ignore */
    }
    for (const label of ["Language", "Preferred Language", "App Language", "Grok"]) {
      try {
        await pressMatchingText(device, label);
        await sleep(700, device);
        if (await observePicker()) return;
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
        /* try next */
      }
    }
  }

  // Full path retry from the target app.
  progress.phase = "open-app";
  try {
    await openApp(device, app, { relaunch: false });
  } catch (error) {
    rethrowIosMutationOutcomeUnknown(error);
    await openApp(device, app, { relaunch: true });
  }
  await sleep(900, device);
  await runNavSteps(device, entryPath, progress, "entry-path");
  await runNavSteps(device, pickerPath, progress, "picker-path");
}

async function runNavSteps(
  device: Device,
  steps: ProfileNavStep[] | undefined,
  progress?: SwitcherScanProgress,
  phase?: SwitcherScanProgress["phase"],
): Promise<void> {
  if (!steps?.length) return;
  if (progress && phase) progress.phase = phase;
  for (const step of steps) {
    if (step.kind === "wait") {
      await sleep(step.ms ?? 500, device);
      continue;
    }
    if (step.kind === "back") {
      try {
        await pressKey(device, "back");
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
      }
      await sleep(400, device);
      continue;
    }
    if (step.kind === "relaunch") continue;
    if (step.kind === "openApp") {
      const targetApp = step.app?.trim();
      if (!targetApp) continue;
      try {
        await openApp(device, targetApp, { relaunch: step.relaunch === true });
      } catch (error) {
        rethrowIosMutationOutcomeUnknown(error);
        if (step.relaunch !== false) {
          await openApp(device, targetApp, { relaunch: true });
        } else {
          // Deep-link handoff: Preferences may already be foreground; still bind session.
          try {
            await openApp(device, targetApp, { relaunch: false });
          } catch (fallbackError) {
            rethrowIosMutationOutcomeUnknown(fallbackError);
          }
        }
      }
      await sleep(700, device);
      continue;
    }
    if (step.kind === "scroll") {
      if (step.direction === "up") {
        await scrollPicker(device, "up");
      } else {
        await scrollPicker(device, "down");
      }
      await sleep(350, device);
      continue;
    }
    if (!step.target) continue;
    const soft = Boolean(step.target.identifier) && !step.target.label && !step.target.text;
    try {
      if (step.target.identifier) await pressIdentifier(device, step.target.identifier);
      else if (step.target.text) await pressMatchingText(device, step.target.text);
      else if (step.target.label) {
        try {
          await pressLabel(device, step.target.label);
        } catch (error) {
          rethrowIosMutationOutcomeUnknown(error);
          await pressMatchingText(device, step.target.label);
        }
      }
    } catch (error) {
      rethrowIosMutationOutcomeUnknown(error);
      // Identifier-only chrome (sidebar/gear) may already be open.
      if (!soft) throw error;
    }
    await sleep(500, device);
  }
}

/**
 * Scroll an option list. On wide iPad split-views, swipe the right pane so the
 * left Settings chrome does not steal the gesture (generic — supermarket lists
 * in a trailing column get the same treatment).
 */
async function scrollPicker(device: Device, direction: "up" | "down"): Promise<void> {
  try {
    const nodes = await snapshot(device);
    const app = nodes.find((node) => node.depth === 0 && node.rect);
    const width = app?.rect?.width ?? 0;
    const height = app?.rect?.height ?? 0;
    if (width >= 700 && height >= 500) {
      const x = Math.round(width * 0.75);
      const fromY = Math.round(height * (direction === "up" ? 0.72 : 0.32));
      const toY = Math.round(height * (direction === "up" ? 0.28 : 0.68));
      await swipeGesture(device, { x, y: fromY }, { x, y: toY }, 280);
      return;
    }
  } catch (error) {
    rethrowIosMutationOutcomeUnknown(error);
    /* fall through */
  }
  if (direction === "down") await scrollDown(device, 0.85);
  else {
    // approximate up scroll
    try {
      const nodes = await snapshot(device);
      const app = nodes.find((node) => node.depth === 0 && node.rect);
      const width = app?.rect?.width ?? 390;
      const height = app?.rect?.height ?? 844;
      const x = Math.round(width * 0.5);
      await swipeGesture(
        device,
        { x, y: Math.round(height * 0.3) },
        { x, y: Math.round(height * 0.7) },
        280,
      );
    } catch (error) {
      rethrowIosMutationOutcomeUnknown(error);
      await scrollDown(device, 0.5);
    }
  }
}

export type ScanSwitcherInput = {
  serial: string;
  app: string;
  kind: SwitcherKind;
  profileId?: string;
  name?: string;
  entryPath?: ProfileNavStep[];
  pickerPath?: ProfileNavStep[];
  platform?: "ios" | "android";
  maxScrolls?: number;
  save?: boolean;
  /**
   * When true, force open/relaunch before navigating. Default false — physical
   * iOS devices often hang on XCTest launch; Corpus tells users to leave the
   * app open and Scan just walks entry → picker.
   */
  openApp?: boolean;
};

export type ScanSwitcherResult = {
  profile: SwitcherProfile;
  optionsFound: number;
  scrolls: number;
};

/**
 * Live-scan any option list: open app → entry → picker → scroll-collect rows → save.
 */
export async function scanSwitcherPicker(input: ScanSwitcherInput): Promise<ScanSwitcherResult> {
  const app = input.app.trim();
  if (!app) throw new Error("app is required");
  const serial = input.serial.trim();
  if (!serial) throw new Error("serial is required");
  const existing = input.profileId ? await getSwitcherProfile(input.profileId) : undefined;
  const entryPath = input.entryPath ?? existing?.entryPath ?? [];
  const pickerPath = input.pickerPath ?? existing?.pickerPath ?? [];
  if (!entryPath.length || !pickerPath.length) {
    throw new Error(
      "entryPath and pickerPath are required to reach the option list (or pass a known profileId)",
    );
  }

  const platform =
    input.platform ?? existing?.platform ?? (await devicePlatformForSerial(serial)) ?? "ios";
  if (platform === "any") {
    throw new Error("switcher scan needs a concrete ios or android platform");
  }

  const target = { kind: "device" as const, platform, serial };
  const progress = createSwitcherScanProgress();

  try {
    return await runWithTargetContext(target, async () => {
      // Use the target factory instead of constructing a global local client so
      // switcher navigation has the same controlled adapter seam as other live
      // device work (and never crosses target contexts while recovering).
      const device = createDeviceForTarget(target);
      const ensureApp = async (force: boolean) => {
        if (!force && input.openApp === false) {
          await sleep(300, device);
          return;
        }
        try {
          await openApp(device, app, { relaunch: false });
        } catch (error) {
          rethrowIosMutationOutcomeUnknown(error);
          await openApp(device, app, { relaunch: true });
        }
        await sleep(800, device);
      };
      // Prefer leaving the app open (iOS runner health), but open when asked or as retry.
      progress.phase = "open-app";
      await ensureApp(input.openApp === true);
      await runNavSteps(device, entryPath, progress, "entry-path");
      await runNavSteps(device, pickerPath, progress, "picker-path");
      await ensureOptionList(device, app, entryPath, pickerPath, input.kind, progress);

      const maxScrolls = Math.max(1, Math.min(30, input.maxScrolls ?? 12));
      const collected = new Map<string, SwitcherOption>();
      let stableRounds = 0;
      let scrolls = 0;

      for (let page = 0; page <= maxScrolls; page += 1) {
        progress.phase = "scan";
        const nodes = await snapshot(device);
        if (looksLikeOptionList(nodes, input.kind)) progress.pickerProven = true;
        const rows = extractSwitcherOptionsFromNodes(nodes);
        let added = 0;
        for (const row of rows) {
          const key = row.label.toLocaleLowerCase();
          if (!progress.partialRows.has(key)) progress.partialRows.set(key, structuredClone(row));
          if (collected.has(key)) continue;
          collected.set(key, row);
          added += 1;
        }
        if (added === 0) {
          stableRounds += 1;
          if (stableRounds >= 2) break;
        } else {
          stableRounds = 0;
        }
        if (page === maxScrolls) break;
        await scrollPicker(device, "up");
        await sleep(450, device);
        scrolls += 1;
        progress.scrollsCompleted = scrolls;
      }

      const byId = new Map<string, SwitcherOption>();
      for (const row of collected.values()) {
        const existingOption = byId.get(row.id);
        if (!existingOption) {
          byId.set(row.id, row);
          continue;
        }
        const aliases = new Set([
          ...(existingOption.aliases ?? []),
          row.label,
          ...(row.aliases ?? []),
        ]);
        aliases.delete(existingOption.label);
        byId.set(row.id, {
          ...existingOption,
          aliases: [...aliases],
          ...((existingOption.identifier ?? row.identifier)
            ? { identifier: existingOption.identifier ?? row.identifier }
            : {}),
        });
      }

      let options = [...byId.values()].sort((left, right) =>
        left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
      );
      if (!options.length && input.openApp !== true) {
        // One recovery pass: open the app and walk the path again.
        progress.scanPass = 2;
        progress.phase = "open-app";
        await ensureApp(true);
        await runNavSteps(device, entryPath, progress, "entry-path");
        await runNavSteps(device, pickerPath, progress, "picker-path");
        collected.clear();
        stableRounds = 0;
        for (let page = 0; page <= maxScrolls; page += 1) {
          progress.phase = "scan";
          const nodes = await snapshot(device);
          if (looksLikeOptionList(nodes, input.kind)) progress.pickerProven = true;
          const rows = extractSwitcherOptionsFromNodes(nodes);
          let added = 0;
          for (const row of rows) {
            const key = row.label.toLocaleLowerCase();
            if (!progress.partialRows.has(key)) progress.partialRows.set(key, structuredClone(row));
            if (collected.has(key)) continue;
            collected.set(key, row);
            added += 1;
          }
          if (added === 0) {
            stableRounds += 1;
            if (stableRounds >= 2) break;
          } else {
            stableRounds = 0;
          }
          if (page === maxScrolls) break;
          await scrollPicker(device, "up");
          await sleep(450, device);
          scrolls += 1;
          progress.scrollsCompleted = scrolls;
        }
        byId.clear();
        for (const row of collected.values()) {
          const existingOption = byId.get(row.id);
          if (!existingOption) {
            byId.set(row.id, row);
            continue;
          }
          const aliases = new Set([
            ...(existingOption.aliases ?? []),
            row.label,
            ...(row.aliases ?? []),
          ]);
          aliases.delete(existingOption.label);
          byId.set(row.id, {
            ...existingOption,
            aliases: [...aliases],
            ...((existingOption.identifier ?? row.identifier)
              ? { identifier: existingOption.identifier ?? row.identifier }
              : {}),
          });
        }
        options = [...byId.values()].sort((left, right) =>
          left.label.localeCompare(right.label, undefined, { sensitivity: "base" }),
        );
      }
      if (!options.length) {
        throw new Error(
          "No option rows found. Open the picker on the device and try Scan again, or check entry/picker paths.",
        );
      }

      const previousOptions = existing?.options ?? [];
      // A partial/wrong-screen scan must never erase a richer seed list (e.g. only
      // capturing a stray "Grok" cell while the language picker never opened).
      const minAccept =
        previousOptions.length > 0 ? Math.max(2, Math.ceil(previousOptions.length * 0.5)) : 1;
      if (previousOptions.length && options.length < minAccept) {
        throw new Error(
          `Scan found only ${options.length} option(s), but this profile already has ${previousOptions.length}. ` +
            "Kept the previous list. Open the real option picker (for Grok: Ask tab → Settings → App Language) and scan again.",
        );
      }
      if (previousOptions.length) {
        options = mergeSwitcherOptions(previousOptions, options);
      }

      const defaultOptionId =
        options.find((option) => option.id === existing?.defaultOptionId)?.id ??
        options.find((option) => option.id === "en")?.id ??
        options[0]!.id;

      const profile: SwitcherProfile = {
        id: input.profileId?.trim() || existing?.id || slugProfileId(app, input.kind),
        name: input.name?.trim() || existing?.name || `${app} · ${input.kind}`,
        kind: input.kind,
        app,
        platform,
        entryPath: structuredClone(entryPath),
        pickerPath: structuredClone(pickerPath),
        options,
        defaultOptionId,
        notes: `Live-scanned ${options.length} ${input.kind} options on device ${serial}.`,
        verifiedAt: new Date().toISOString().slice(0, 10),
        scanned: true,
      };

      if (input.save !== false) await saveSwitcherProfile(profile);
      return { profile, optionsFound: options.length, scrolls };
    });
  } catch (error) {
    attachSwitcherScanOutcomeUnknownDiagnostic(error, { app, kind: input.kind, serial }, progress);
    throw error;
  }
}

function slugProfileId(app: string, kind: string): string {
  const base = app
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return `${base || "app"}-${kind}`;
}

/** Sync seed list for fallbacks/tests (no disk). */
export function listSwitcherProfilesSync(): SwitcherProfile[] {
  return builtins();
}
