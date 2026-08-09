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
import type { CorpusNavStep, CorpusScope } from "@relay/protocol";
import {
  createDevice,
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
import { runWithTargetContext } from "./target-context.js";
import { devicePlatformForSerial } from "./workspace.js";
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
  entryPath: CorpusNavStep[];
  /** Path from entry surface to the option list. */
  pickerPath: CorpusNavStep[];
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

export function resolveSwitcherTargets(
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

/**
 * Expand a switcher profile + option tags into a corpus scope.
 * For kind=language, option ids are locales (mapLocale / locales fields).
 */
export async function corpusScopeFromSwitcherProfile(
  profileId: string,
  optionIds: string[],
  overrides?: Partial<CorpusScope>,
): Promise<Partial<CorpusScope>> {
  const profile = await getSwitcherProfile(profileId);
  if (!profile) throw new Error(`unknown switcher profile: ${profileId}`);
  const tags = [...new Set(optionIds.map((id) => id.trim()).filter(Boolean))];
  if (!tags.length) throw new Error("at least one option is required");
  const targets = resolveSwitcherTargets(profile, tags);
  const languageOptions = Object.fromEntries(
    Object.entries(targets).map(([tag, target]) => [tag, [{ kind: "tap" as const, target }]]),
  );
  const preferred = profile.defaultOptionId ?? tags[0]!;
  const mapOption = tags.includes(preferred) ? preferred : tags[0]!;
  return {
    strategy: "map-once-replay",
    mapLocale: mapOption,
    locales: tags,
    app: profile.app,
    entryPath: structuredClone(profile.entryPath),
    languagePath: structuredClone(profile.pickerPath),
    languageOptions,
    ...overrides,
  };
}

export type SwitcherMatrixScope = {
  options: string[];
  app?: string;
  relaunch?: boolean;
  entryPath?: CorpusNavStep[];
  pickerPath?: CorpusNavStep[];
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

// ─── Row extraction (generic picker list) ────────────────────────────────────

const CHROME_NOISE =
  /^(settings|search|cancel|done|edit|back|close|general|about|ok|save|add |preferred |reorder|app language|language|appearance|account|environment|theme|suggested languages|other languages|allow grok to access|grok settings|acknowledgements|photos|microphone|camera|siri & search|notifications|live activities|background app refresh|full access|airplane mode|wi-?fi|bluetooth|vpn|sounds|focus|screen time|control center|display & brightness|apple id.*|jonathan .*|multitasking.*|accessibility|wallpaper|apple pencil|touch id.*|battery|privacy.*|app store|wallet.*|passwords|contacts|calendar|notes|reminders|freeform|voice memos|messages|safari|stocks|weather|translate|maps|measure|shortcuts|health|game center|tv provider|developer|1blocker|bible|bitwarden|chrome|documents|drive|gmail|google photos|legacy|testflight|\bx\b)$/i;

/** Left-pane / system settings rows that appear in the same AX tree on iPad split view. */
const SPLIT_VIEW_SETTINGS_NOISE =
  /^(jonathan|apple id|airplane|wi-?fi|bluetooth|vpn|notifications|sounds|focus|screen time|general|control center|display|home screen|notes|voice memos|messages|stocks|translate|books|game center|tv provider|developer|bible|bitwarden|documents|drive|google photos|testflight|photos,|microphone|camera|siri|live activities|background app refresh|preferred language|allow grok|grok settings|acknowledgements|language & region|language, english)$/i;

export function inferOptionId(label: string, subtitle?: string): string {
  const source = `${subtitle ?? ""} ${label}`.trim();
  // Language heuristics (optional enrichment — unknown labels still get a slug).
  // Prefer explicit checks for common locales so regex unicode edge-cases cannot
  // skip the English seed used throughout Corpus/locale-matrix.
  if (/\benglish\b/i.test(source) || /^en(?:[-_]|$)/i.test(label.trim())) return "en";
  const languageTable: Array<[RegExp, string]> = [
    [/portugu[eê]s\s*\(?\s*brasil\s*\)?|portuguese\s*\(?\s*brazil\s*\)?|\bpt-?br\b/i, "pt-BR"],
    [/portugu[eê]s|\bportuguese\b|\bpt-?pt\b/i, "pt"],
    [/\bitalian\b|\bitaliano\b|\bit\b/i, "it"],
    [/spanish\s*\(\s*latin|espa[nñ]ol\s*\(\s*latino|\bes-?419\b|\bes-?mx\b/i, "es-419"],
    [/\bspanish\b|\bespa[nñ]ol\b|\bes\b/i, "es"],
    [/fran[cç]ais\s*\(\s*canada\s*\)?|french\s*\(\s*canada\s*\)?|\bfr-?ca\b/i, "fr-CA"],
    [/\bfrench\b|fran[cç]ais|\bfr\b/i, "fr"],
    [/\bgerman\b|\bdeutsch\b|\bde\b/i, "de"],
    [/traditional.*chinese|繁體|\bzh-?hant\b|\bzh-?tw\b/i, "zh-Hant"],
    [/simplified.*chinese|简体|\bzh-?hans\b|\bzh-?cn\b/i, "zh-Hans"],
    [/\bchinese\b|中文/i, "zh"],
    [/\bjapanese\b|日本語|\bja\b/i, "ja"],
    [/\bkorean\b|한국어|\bko\b/i, "ko"],
    [/\bdutch\b|\bnederlands\b|\bnl\b/i, "nl"],
    [/arabic\s*\(\s*saudi|العربية|\bar-?sa\b/i, "ar-SA"],
    [/\barabic\b|\bar\b/i, "ar"],
    [/\bhindi\b|हिन्दी|हिंदी|\bhi\b/i, "hi"],
    [/\brussian\b|русский|\bru\b/i, "ru"],
    [/\bturkish\b|türkçe|\btr\b/i, "tr"],
    [/\bpolish\b|\bpolski\b|\bpl\b/i, "pl"],
    [/\bdanish\b|\bdansk\b|\bda\b/i, "da"],
    [/\bfinnish\b|\bsuomi\b|\bfi\b/i, "fi"],
    [/\bswedish\b|\bsvenska\b|\bsv\b/i, "sv"],
    [/norwegian|norsk|\bnb-?no\b|\bnb\b/i, "nb"],
    [/\bgreek\b|ελληνικά|\bel\b/i, "el"],
    [/\bhebrew\b|עברית|\bhe\b/i, "he"],
    [/\bhungarian\b|\bmagyar\b|\bhu\b/i, "hu"],
    [/bahasa indonesia|\bindonesian\b|\bid\b/i, "id"],
    [/bahasa melayu|\bmalay\b|\bms\b/i, "ms"],
    [/\bcroatian\b|\bhrvatski\b|\bhr\b/i, "hr"],
    [/\bbulgarian\b|български|\bbg\b/i, "bg"],
    [/\bromanian\b|rom[aâ]nă|\bro\b/i, "ro"],
    [/\bukrainian\b|українська|\buk\b/i, "uk"],
    [/\bvietnamese\b|tiếng việt|\bvi\b/i, "vi"],
    [/\bthai\b|ภาษาไทย|\bth\b/i, "th"],
    [/\btamil\b|தமிழ்|\bta\b/i, "ta"],
    [/\btelugu\b|తెలుగు|\bte\b/i, "te"],
    [/\bbangla\b|\bbengali\b|বাংলা|\bbn\b/i, "bn"],
    [/\bmarathi\b|मराठी|\bmr\b/i, "mr"],
    [/\burdu\b|اردو|\bur\b/i, "ur"],
    [/\bpersian\b|\bfarsi\b|فارسی|\bfa\b/i, "fa"],
    [/\bfilipino\b|\btagalog\b|\bfil\b|\btl\b/i, "fil"],
  ];
  for (const [pattern, id] of languageTable) {
    if (pattern.test(source)) return id;
  }
  // Common non-language option patterns
  if (/\bprod(uction)?\b/i.test(source)) return "production";
  if (/\bstag(e|ing)?\b/i.test(source)) return "staging";
  if (/\bdev(elopment)?\b/i.test(source)) return "development";
  if (/\bdark\b/i.test(source)) return "dark";
  if (/\blight\b/i.test(source)) return "light";
  if (/\bsystem\b/i.test(source)) return "system";

  return (
    label
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 32) || "option"
  );
}

export function extractSwitcherOptionsFromNodes(nodes: SnapshotNode[]): SwitcherOption[] {
  type Candidate = {
    label: string;
    identifier?: string;
    y: number;
    x: number;
    subtitle?: string;
    isCell: boolean;
  };
  const candidates: Candidate[] = [];
  const byParent = new Map<number, SnapshotNode[]>();
  for (const node of nodes) {
    if (node.parentIndex === undefined) continue;
    const list = byParent.get(node.parentIndex) ?? [];
    list.push(node);
    byParent.set(node.parentIndex, list);
  }

  // iPad split-view: option lists live in the right half. Prefer cells whose
  // center is on the right side when a wide landscape tree is present.
  const xs = nodes.map((node) => node.rect?.x ?? 0);
  const widths = nodes.map((node) => (node.rect?.x ?? 0) + (node.rect?.width ?? 0));
  const minX = xs.length ? Math.min(...xs) : 0;
  const maxX = widths.length ? Math.max(...widths) : 0;
  const midX = minX + (maxX - minX) * 0.45;
  const wideSplit = maxX - minX > 700;

  for (const node of nodes) {
    if (node.visibleToUser === false || node.enabled === false) continue;
    const type = (node.type ?? node.role ?? "").toLocaleLowerCase();
    const rawLabel = (node.label ?? "").trim();
    if (
      !rawLabel ||
      CHROME_NOISE.test(rawLabel) ||
      /^reorder\s+/i.test(rawLabel) ||
      rawLabel.length > 80
    ) {
      continue;
    }
    // Cell a11y often "Português (Brasil), Portuguese (Brazil)" — take primary.
    const parts = rawLabel
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    const label = parts[0] ?? rawLabel;
    if (!label || CHROME_NOISE.test(label) || SPLIT_VIEW_SETTINGS_NOISE.test(label)) continue;

    const isCell = type === "cell";
    const isRow = isCell || type === "button" || type === "statictext" || Boolean(node.hittable);
    if (!isRow) continue;
    if (!isCell && type === "statictext" && node.parentIndex !== undefined) {
      const parent = nodes[node.parentIndex];
      const parentType = (parent?.type ?? parent?.role ?? "").toLocaleLowerCase();
      if (parentType === "cell" || parentType === "button") continue;
    }
    if (!isCell && SPLIT_VIEW_SETTINGS_NOISE.test(rawLabel)) continue;

    const centerX = (node.rect?.x ?? 0) + (node.rect?.width ?? 0) / 2;
    if (
      wideSplit &&
      isCell &&
      centerX < midX &&
      !/english|portug|italiano|français|deutsch|español|中文|日本語|한국어|العربية/i.test(label)
    ) {
      // Left settings pane cells on iPad — skip unless they look like languages.
      continue;
    }

    let subtitle: string | undefined = parts.length > 1 ? parts.slice(1).join(", ") : undefined;
    if (!subtitle && node.parentIndex !== undefined) {
      const siblings = byParent.get(node.parentIndex) ?? [];
      const texts = siblings
        .map((kid) => (kid.label ?? "").trim())
        .filter(
          (text) =>
            text &&
            text !== label &&
            text !== rawLabel &&
            !CHROME_NOISE.test(text) &&
            text.length < 60 &&
            !/^reorder/i.test(text),
        );
      subtitle =
        texts.find((text) => /^[A-Za-z][A-Za-z\s'(),-]+$/.test(text) && text !== label) ?? texts[0];
    }
    candidates.push({
      label,
      y: node.rect?.y ?? 0,
      x: centerX,
      isCell,
      ...(node.identifier ? { identifier: node.identifier } : {}),
      ...(subtitle ? { subtitle } : {}),
    });
  }

  // Prefer cells over loose static texts when both exist.
  const hasCells = candidates.some((candidate) => candidate.isCell);
  const filtered = hasCells ? candidates.filter((candidate) => candidate.isCell) : candidates;
  filtered.sort((left, right) => left.y - right.y || left.x - right.x);

  const seenLabel = new Set<string>();
  const options: SwitcherOption[] = [];
  for (const candidate of filtered) {
    const key = candidate.label.toLocaleLowerCase();
    if (seenLabel.has(key)) continue;
    seenLabel.add(key);
    const id = inferOptionId(candidate.label, candidate.subtitle);
    const aliases = new Set<string>();
    if (candidate.subtitle) aliases.add(candidate.subtitle);
    aliases.add(`Reorder ${candidate.label}`);
    options.push({
      id,
      label: candidate.label,
      ...(aliases.size ? { aliases: [...aliases] } : {}),
      ...(candidate.identifier ? { identifier: candidate.identifier } : {}),
    });
  }

  const byId = new Map<string, SwitcherOption>();
  for (const option of options) {
    const existing = byId.get(option.id);
    if (!existing) {
      byId.set(option.id, option);
      continue;
    }
    const aliases = new Set([...(existing.aliases ?? []), option.label, ...(option.aliases ?? [])]);
    aliases.delete(existing.label);
    byId.set(option.id, {
      ...existing,
      aliases: [...aliases],
      ...((existing.identifier ?? option.identifier)
        ? { identifier: existing.identifier ?? option.identifier }
        : {}),
    });
  }
  return [...byId.values()];
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
  entryPath: CorpusNavStep[],
  pickerPath: CorpusNavStep[],
  kind: SwitcherKind,
): Promise<void> {
  if (looksLikeOptionList(await snapshot(device), kind)) return;

  // Recovery for OS deep-links (Grok App Language → Preferences):
  // Preferences may already be foregrounded on the app page.
  if (kind === "language") {
    try {
      await openApp(device, "com.apple.Preferences", { relaunch: false });
      await sleep(800, device);
    } catch {
      /* ignore */
    }
    for (const label of ["Language", "Preferred Language", "App Language", "Grok"]) {
      try {
        await pressMatchingText(device, label);
        await sleep(700, device);
        if (looksLikeOptionList(await snapshot(device), kind)) return;
      } catch {
        /* try next */
      }
    }
  }

  // Full path retry from the target app.
  try {
    await openApp(device, app, { relaunch: false });
  } catch {
    await openApp(device, app, { relaunch: true });
  }
  await sleep(900, device);
  await runNavSteps(device, entryPath);
  await runNavSteps(device, pickerPath);
}

async function runNavSteps(device: Device, steps: CorpusNavStep[] | undefined): Promise<void> {
  if (!steps?.length) return;
  for (const step of steps) {
    if (step.kind === "wait") {
      await sleep(step.ms ?? 500, device);
      continue;
    }
    if (step.kind === "back") {
      await pressKey(device, "back").catch(() => undefined);
      await sleep(400, device);
      continue;
    }
    if (step.kind === "relaunch") continue;
    if (step.kind === "openApp") {
      const targetApp = step.app?.trim();
      if (!targetApp) continue;
      try {
        await openApp(device, targetApp, { relaunch: step.relaunch === true });
      } catch {
        if (step.relaunch !== false) {
          await openApp(device, targetApp, { relaunch: true });
        } else {
          // Deep-link handoff: Preferences may already be foreground; still bind session.
          await openApp(device, targetApp, { relaunch: false }).catch(() => undefined);
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
        } catch {
          await pressMatchingText(device, step.target.label);
        }
      }
    } catch (error) {
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
  } catch {
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
    } catch {
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
  entryPath?: CorpusNavStep[];
  pickerPath?: CorpusNavStep[];
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

  return runWithTargetContext({ kind: "device", platform, serial }, async () => {
    const device = createDevice();
    const ensureApp = async (force: boolean) => {
      if (!force && input.openApp === false) {
        await sleep(300, device);
        return;
      }
      try {
        await openApp(device, app, { relaunch: false });
      } catch {
        await openApp(device, app, { relaunch: true });
      }
      await sleep(800, device);
    };
    // Prefer leaving the app open (iOS runner health), but open when asked or as retry.
    await ensureApp(input.openApp === true);
    await runNavSteps(device, entryPath);
    await runNavSteps(device, pickerPath);
    await ensureOptionList(device, app, entryPath, pickerPath, input.kind);

    const maxScrolls = Math.max(1, Math.min(30, input.maxScrolls ?? 12));
    const collected = new Map<string, SwitcherOption>();
    let stableRounds = 0;
    let scrolls = 0;

    for (let page = 0; page <= maxScrolls; page += 1) {
      const nodes = await snapshot(device);
      const rows = extractSwitcherOptionsFromNodes(nodes);
      let added = 0;
      for (const row of rows) {
        const key = row.label.toLocaleLowerCase();
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
      await ensureApp(true);
      await runNavSteps(device, entryPath);
      await runNavSteps(device, pickerPath);
      collected.clear();
      stableRounds = 0;
      for (let page = 0; page <= maxScrolls; page += 1) {
        const nodes = await snapshot(device);
        const rows = extractSwitcherOptionsFromNodes(nodes);
        let added = 0;
        for (const row of rows) {
          const key = row.label.toLocaleLowerCase();
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
