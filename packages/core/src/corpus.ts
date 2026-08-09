/**
 * Tree crawl / screen corpus engine.
 *
 * Depth-bounded autonomous crawl with locale-stable identity and a labeled
 * screenshot pack. Navigation primitives live in explore.ts — this module is
 * the job orchestrator (map-once-replay + pack export), not a separate device mode.
 *
 * Sibling to discovery: discovery is interactive graph recording; this is an
 * unattended crawl policy that collapses the same page across languages.
 */
import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import type {
  CorpusControl,
  CorpusCoverageReport,
  CorpusMapAction,
  CorpusMapPlan,
  CorpusNavStep,
  CorpusPackManifest,
  CorpusProgress,
  CorpusScope,
  CorpusSession,
  CorpusStatus,
  CorpusTransition,
  CorpusScreen,
  TargetProfile,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import {
  createDevice,
  exists,
  openApp,
  pressIdentifier,
  pressKey,
  pressLabel,
  pressMatchingText,
  resetDeviceClient,
  scrollDown,
  sleep,
  type Device,
} from "./device.js";
import {
  dismissTowardParent,
  isExploreChromeLabel,
  isUnsafeExploreControlText,
  scrollCollectControls,
} from "./explore.js";
import { hardStopDeviceSession } from "./control.js";
import { currentTargetContext, runWithTargetContext } from "./target-context.js";
import { publish } from "./events.js";
import { currentOperationContext } from "./operation-context.js";
import {
  corpusControlStableKey,
  observeLocaleStableIdentity,
  observeScreenIdentity,
  slugCorpusPathSegment,
  stableLabelKey,
} from "./screen-identity.js";
import {
  captureScreenshot,
  captureSnapshot,
  cleanupScreenshot,
  devicePlatformForSerial,
  interact,
  type InteractInput,
} from "./workspace.js";
import { findWorkspaceRoot } from "./workspace-root.js";

const DEFAULT_SCOPE: CorpusScope = {
  maxDepth: 3,
  maxScreens: 400,
  maxTransitions: 1_200,
  maxDurationMs: 45 * 60_000,
  locales: ["en"],
  strategy: "map-once-replay",
  allowSensitiveControls: false,
};

const activeCorpusCrawls = new Map<string, { cancel: boolean; promise?: Promise<void> }>();

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return requiredText(value, label, maxLength);
}
function corpusRoot(): string {
  const base = process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot();
  const next = join(base, ".relay", "corpus");
  const legacy = join(base, ".relay", "harvest");
  // One-shot break from the old harvest disk layout.
  if (!existsSync(next) && existsSync(legacy)) {
    try {
      renameSync(legacy, next);
    } catch {
      /* concurrent first-access — fall through */
    }
  }
  return next;
}

function sessionPath(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(id)) throw new Error("invalid corpus session id");
  return join(corpusRoot(), `${id}.json`);
}

function sessionDir(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(id)) throw new Error("invalid corpus session id");
  return join(corpusRoot(), id);
}

function screenAssetPath(sessionId: string, screenId: string): string {
  if (!/^screen-[A-Za-z0-9-]+$/.test(screenId)) throw new Error("invalid corpus screen id");
  return join(sessionDir(sessionId), "screens", `${screenId}.png`);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function emitCorpus(session: CorpusSession, created = false): void {
  publish({
    type: created ? "resource.created" : "resource.updated",
    at: session.updatedAt,
    projectId: currentOperationContext()?.projectId ?? session.projectId ?? "default",
    resource: "corpus-session",
    resourceId: session.id,
    revision: session.updatedAt,
  });
}

function normalizeNavSteps(value: unknown, label: string): CorpusNavStep[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value.map((step, index) => {
    if (!step || typeof step !== "object") throw new Error(`${label}[${index}] is invalid`);
    const record = step as Record<string, unknown>;
    const kind = record.kind;
    if (kind === "back") return { kind: "back" };
    if (kind === "relaunch") return { kind: "relaunch" };
    if (kind === "openApp") {
      const appName = optionalText(record.app, `${label}[${index}].app`, 240);
      if (!appName) throw new Error(`${label}[${index}].app is required`);
      const relaunch = record.relaunch === undefined ? undefined : Boolean(record.relaunch);
      return { kind: "openApp", app: appName, ...(relaunch !== undefined ? { relaunch } : {}) };
    }
    if (kind === "wait") {
      const ms = Number(record.ms);
      if (!Number.isFinite(ms) || ms < 0 || ms > 120_000) {
        throw new Error(`${label}[${index}].ms is invalid`);
      }
      return { kind: "wait", ms: Math.round(ms) };
    }
    if (kind === "scroll") {
      const direction = record.direction === "up" ? "up" : "down";
      const amount =
        record.amount === undefined
          ? undefined
          : Math.max(1, Math.min(8, Number(record.amount) || 1));
      return { kind: "scroll", direction, ...(amount ? { amount } : {}) };
    }
    if (kind === "tap") {
      const target = (record.target ?? {}) as Record<string, unknown>;
      const identifier = optionalText(
        target.identifier,
        `${label}[${index}].target.identifier`,
        240,
      );
      const tapLabel = optionalText(target.label, `${label}[${index}].target.label`, 240);
      const text = optionalText(target.text, `${label}[${index}].target.text`, 240);
      if (!identifier && !tapLabel && !text) {
        throw new Error(`${label}[${index}] tap target requires identifier, label, or text`);
      }
      return {
        kind: "tap",
        target: {
          ...(identifier ? { identifier } : {}),
          ...(tapLabel ? { label: tapLabel } : {}),
          ...(text ? { text } : {}),
        },
      };
    }
    throw new Error(`${label}[${index}].kind is unsupported`);
  });
}

function normalizeScope(scope?: Partial<CorpusScope>): CorpusScope {
  const bounded = (
    value: number | undefined,
    fallback: number,
    min: number,
    max: number,
    name: string,
  ) => {
    const next = value ?? fallback;
    if (!Number.isInteger(next) || next < min || next > max) {
      throw new Error(`invalid corpus scope: ${name}`);
    }
    return next;
  };
  const locales = [
    ...new Set(
      (scope?.locales?.length ? scope.locales : DEFAULT_SCOPE.locales)
        .map((locale) => locale.trim())
        .filter(Boolean),
    ),
  ];
  if (!locales.length) throw new Error("corpus requires at least one locale");
  if (locales.length > 32) throw new Error("corpus supports at most 32 locales");
  const languageOptions = scope?.languageOptions
    ? Object.fromEntries(
        Object.entries(scope.languageOptions).map(([locale, steps]) => [
          locale,
          normalizeNavSteps(steps, `languageOptions.${locale}`) ?? [],
        ]),
      )
    : undefined;
  const strategy =
    scope?.strategy === "crawl-each" || scope?.strategy === "map-once-replay"
      ? scope.strategy
      : (DEFAULT_SCOPE.strategy ?? "map-once-replay");
  const mapLocale = optionalText(scope?.mapLocale, "mapLocale", 40) ?? locales[0]!;
  if (!locales.includes(mapLocale)) {
    locales.unshift(mapLocale);
  }
  // Map locale first so UI/coverage order is natural.
  const orderedLocales = [mapLocale, ...locales.filter((locale) => locale !== mapLocale)];
  return {
    maxDepth: bounded(scope?.maxDepth, DEFAULT_SCOPE.maxDepth, 0, 6, "maxDepth"),
    maxScreens: bounded(scope?.maxScreens, DEFAULT_SCOPE.maxScreens, 1, 2_000, "maxScreens"),
    maxTransitions: bounded(
      scope?.maxTransitions,
      DEFAULT_SCOPE.maxTransitions,
      1,
      8_000,
      "maxTransitions",
    ),
    maxDurationMs: bounded(
      scope?.maxDurationMs,
      DEFAULT_SCOPE.maxDurationMs,
      30_000,
      8 * 60 * 60_000,
      "maxDurationMs",
    ),
    locales: orderedLocales,
    strategy,
    mapLocale,
    ...(optionalText(scope?.app, "app", 240) ? { app: optionalText(scope?.app, "app", 240) } : {}),
    ...(normalizeNavSteps(scope?.entryPath, "entryPath")
      ? { entryPath: normalizeNavSteps(scope?.entryPath, "entryPath") }
      : {}),
    ...(normalizeNavSteps(scope?.languagePath, "languagePath")
      ? { languagePath: normalizeNavSteps(scope?.languagePath, "languagePath") }
      : {}),
    ...(languageOptions && Object.keys(languageOptions).length ? { languageOptions } : {}),
    allowSensitiveControls: scope?.allowSensitiveControls ?? false,
  };
}

function idleProgress(): CorpusProgress {
  return {
    phase: "idle",
    screensCaptured: 0,
    transitionsCaptured: 0,
    updatedAt: Date.now(),
  };
}

async function writeSession(session: CorpusSession): Promise<void> {
  await mkdir(corpusRoot(), { recursive: true });
  const destination = sessionPath(session.id);
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await rename(temp, destination);
}

function corpusBelongsToProject(
  session: Pick<CorpusSession, "projectId">,
  projectId: string | undefined,
): boolean {
  if (!projectId) return true;
  return (session.projectId ?? "default") === projectId;
}

function assertCorpusAccess(session: CorpusSession): void {
  const projectId = currentOperationContext()?.projectId;
  if (!corpusBelongsToProject(session, projectId)) {
    throw new Error("corpus session is outside this project");
  }
}

function assertMutable(session: CorpusSession): void {
  if (session.status !== "draft" && session.status !== "running" && session.status !== "paused") {
    throw new Error(`corpus session is ${session.status}`);
  }
  if (Date.now() - session.createdAt > session.scope.maxDurationMs) {
    throw new Error("corpus time budget is exhausted");
  }
}

function unsafeControlText(value: string): boolean {
  return isUnsafeExploreControlText(value);
}

function isCorpusChromeLabel(value: string): boolean {
  if (isExploreChromeLabel(value, { excludeLanguageSwitcher: true })) return true;
  const label = value.trim();
  // Grok app chrome that leaks under the Settings sheet.
  if (/^grok[-_]/i.test(label)) return true;
  if (
    /^(Grok|Ask|Imagine|Build|Open sidebar|New Message|Ask Anything|Speak|Attach|Auto)$/i.test(
      label,
    )
  )
    return true;
  if (/^Profile picture,/i.test(label)) return true;
  if (/^supergrok-branding/i.test(label)) return true;
  if (/scroll bar|scrollbar|page indicator/i.test(label)) return true;
  if (/^forward$/i.test(label)) return true;
  return false;
}

function isToggleControl(node: SnapshotNode, label: string): boolean {
  const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
  if (/\bswitch\b|\btoggle\b/.test(role)) return true;
  if (/^(on|off|1|0)$/i.test((node.value ?? "").trim())) return true;
  if (/^enable\b|^disable\b|^lock\b/i.test(label) && /\bswitch\b/.test(role)) return true;
  return false;
}

function isNestedSettingsPage(nodes: SnapshotNode[]): boolean {
  return nodes.some((node) => {
    const id = (node.identifier ?? "").toLocaleLowerCase();
    const label = (node.label ?? "").toLocaleLowerCase();
    return (
      id === "toolbar.back.button" ||
      label === "grok-arrow-left" ||
      (label === "back" &&
        /button|nav/.test(`${node.type ?? ""} ${node.role ?? ""}`.toLocaleLowerCase()))
    );
  });
}

function isSettingsRoot(nodes: SnapshotNode[]): boolean {
  const labels = new Set(nodes.map((node) => (node.label ?? "").trim()).filter(Boolean));
  if (!labels.has("Settings") && ![...labels].some((label) => /settings/i.test(label))) {
    return false;
  }
  return (
    labels.has("Appearance") ||
    labels.has("SuperGrok") ||
    labels.has("Haptics") ||
    labels.has("Usage") ||
    [...labels].some((label) => /appearance|supergrok|haptics/i.test(label))
  );
}

/** Interactive candidates for the corpus crawl. Prefer stable identifiers. */
export function corpusControls(
  nodes: SnapshotNode[],
  options?: { allowSensitive?: boolean },
): CorpusControl[] {
  const seen = new Set<string>();
  const nested = isNestedSettingsPage(nodes);
  return nodes
    .filter(
      (node) =>
        node.visibleToUser !== false &&
        node.enabled !== false &&
        (node.hittable || node.identifier || node.ref || node.type === "Cell"),
    )
    .flatMap((node, index) => {
      const label = (node.label ?? node.value ?? node.identifier ?? "").trim();
      if (!label) return [];
      if (isCorpusChromeLabel(label)) return [];
      if (isToggleControl(node, label)) return [];
      if (!options?.allowSensitive && unsafeControlText(label)) return [];
      // Nested pages often still expose the parent settings list in the AX tree.
      if (nested && node.hittable === false && !node.identifier) return [];
      const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
      if (
        /statictext|header|heading/.test(role) &&
        node.type !== "Cell" &&
        node.type !== "Button"
      ) {
        return [];
      }
      const stableKey = corpusControlStableKey(node);
      const target = node.identifier
        ? { identifier: node.identifier }
        : node.ref
          ? { ref: node.ref }
          : stableLabelKey(node.label)
            ? { label: node.label! }
            : node.label
              ? { label: node.label }
              : undefined;
      if (!target) return [];
      const key = `${stableKey}:${JSON.stringify(target)}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          id: `${index}-${digest(key).slice(0, 8)}`,
          label,
          stableKey,
          role: node.role ?? node.type,
          target,
        },
      ];
    })
    .slice(0, 60);
}

/** Prefer real nav/page titles; never toolbar chrome. */
export function titleFromNodes(nodes: SnapshotNode[], path: string[]): string | undefined {
  const chrome = (label: string) => isCorpusChromeLabel(label) || isExploreChromeLabel(label);

  // NavigationBar.identifier is often the page title on Grok (e.g. "Kids Mode").
  for (const node of nodes) {
    const type = `${node.type ?? ""} ${node.role ?? ""}`.toLocaleLowerCase();
    if (!/navigationbar/.test(type)) continue;
    const id = (node.identifier ?? "").trim();
    if (id && !chrome(id) && !/^toolbar\./i.test(id) && id.length < 80) return id;
    const label = (node.label ?? "").trim();
    if (label && !chrome(label) && label.length < 80) return label;
  }

  // Centered header-ish static text near the top of the sheet.
  const headerCandidates = nodes
    .filter((node) => node.visibleToUser !== false)
    .map((node) => {
      const label = (stableLabelKey(node.label) ?? node.label ?? "").trim();
      if (!label || label.length >= 80 || chrome(label)) return null;
      const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
      if (!/header|heading|statictext|text/.test(role)) return null;
      if (/button|cell|switch/.test(role)) return null;
      const rect = node.rect;
      const y = rect?.y ?? 999;
      const x = rect?.x ?? 0;
      const width = rect?.width ?? 0;
      if (y < 40 || y > 140) return null;
      const centerBonus = width > 40 && x > 120 ? 0 : 20;
      return { label, score: y + centerBonus };
    })
    .filter((item): item is { label: string; score: number } => item !== null)
    .sort((left, right) => left.score - right.score);
  if (headerCandidates[0]) return headerCandidates[0].label;

  if (path.length) return path.at(-1);
  if (isSettingsRoot(nodes)) return "Settings";
  return undefined;
}

/**
 * Locale-stable key for the root; path-scoped key for nested pages so parent
 * AX leakage cannot collapse every settings subpage into one node.
 */
export function fingerprintCorpusScreen(
  nodes: SnapshotNode[],
  pathKeys: string[] = [],
): {
  fingerprint: string;
  canonicalKey: string;
} {
  const localeStable = observeLocaleStableIdentity(nodes).fingerprint;
  const visualFingerprint = observeScreenIdentity(nodes).fingerprint;
  const canonicalKey =
    pathKeys.length > 0
      ? digest(`relay-corpus-path:v1:${localeStable}:${pathKeys.join(">")}`)
      : localeStable;
  return {
    fingerprint: visualFingerprint,
    canonicalKey,
  };
}

export async function createCorpusSession(input: {
  id?: string;
  name: string;
  targetId: string;
  targetProfile?: TargetProfile;
  scope?: Partial<CorpusScope>;
  projectId?: string;
  organizationId?: string;
}): Promise<CorpusSession> {
  const name = requiredText(input.name, "corpus session name", 160);
  const targetId = requiredText(input.targetId, "corpus target", 240);
  const operation = currentOperationContext();
  const at = Date.now();
  const session: CorpusSession = {
    id: input.id ?? `corpus-${randomUUID()}`,
    name,
    projectId: input.projectId?.trim() || operation?.projectId?.trim() || "default",
    organizationId: input.organizationId?.trim() || operation?.organizationId?.trim() || "local",
    targetId,
    ...(input.targetProfile ? { targetProfile: { ...input.targetProfile } } : {}),
    scope: normalizeScope(input.scope),
    status: "draft",
    createdAt: at,
    updatedAt: at,
    progress: idleProgress(),
    screens: [],
    transitions: [],
  };
  await writeSession(session);
  emitCorpus(session, true);
  return session;
}

export async function readCorpusSession(
  id: string,
  filter?: { projectId?: string },
): Promise<CorpusSession | null> {
  try {
    const raw = JSON.parse(await readFile(sessionPath(id), "utf8")) as CorpusSession;
    if (!corpusBelongsToProject(raw, filter?.projectId)) return null;
    return raw;
  } catch {
    return null;
  }
}

export async function listCorpusSessions(filter?: {
  projectId?: string;
}): Promise<CorpusSession[]> {
  try {
    const entries = await readdir(corpusRoot());
    const sessions: CorpusSession[] = [];
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue;
      const session = await readCorpusSession(entry.replace(/\.json$/, ""), filter);
      if (session) sessions.push(session);
    }
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

export async function renameCorpusSession(id: string, name: string): Promise<CorpusSession> {
  const session = await readCorpusSession(id);
  if (!session) throw new Error("corpus session not found");
  assertCorpusAccess(session);
  session.name = requiredText(name, "corpus session name", 160);
  session.updatedAt = Date.now();
  await writeSession(session);
  emitCorpus(session);
  return session;
}

const STATUS_TRANSITIONS: Record<CorpusStatus, CorpusStatus[]> = {
  draft: ["running", "stopped"],
  running: ["paused", "complete", "stopped", "failed"],
  paused: ["running", "stopped"],
  complete: [],
  stopped: [],
  failed: ["running", "stopped"],
};

export async function setCorpusStatus(id: string, status: CorpusStatus): Promise<CorpusSession> {
  const session = await readCorpusSession(id);
  if (!session) throw new Error("corpus session not found");
  assertCorpusAccess(session);
  if (session.status === status) return session;
  if (!STATUS_TRANSITIONS[session.status].includes(status)) {
    throw new Error(`cannot move corpus from ${session.status} to ${status}`);
  }
  if (status === "stopped" || status === "paused") {
    const active = activeCorpusCrawls.get(id);
    if (active) active.cancel = true;
  }
  session.status = status;
  session.updatedAt = Date.now();
  if (status === "stopped") {
    session.progress = {
      ...session.progress,
      phase: "failed",
      message: "Stopped",
      updatedAt: session.updatedAt,
    };
  }
  await writeSession(session);
  emitCorpus(session);
  return session;
}

async function updateProgress(
  session: CorpusSession,
  patch: Partial<CorpusProgress>,
): Promise<CorpusSession> {
  session.progress = {
    ...session.progress,
    ...patch,
    screensCaptured: session.screens.length,
    transitionsCaptured: session.transitions.length,
    updatedAt: Date.now(),
  };
  session.updatedAt = session.progress.updatedAt;
  await writeSession(session);
  emitCorpus(session);
  return session;
}

export async function recordCorpusScreen(input: {
  sessionId: string;
  nodes: SnapshotNode[];
  locale: string;
  depth: number;
  path: string[];
  pathKeys: string[];
  title?: string;
  screenshotPath?: string;
  makeCurrent?: boolean;
}): Promise<{ session: CorpusSession; screen: CorpusScreen; isNew: boolean }> {
  const session = await readCorpusSession(input.sessionId);
  if (!session) throw new Error("corpus session not found");
  assertCorpusAccess(session);
  assertMutable(session);
  const { fingerprint, canonicalKey } = fingerprintCorpusScreen(input.nodes, input.pathKeys);
  // Nested path with unchanged pixels/AX identity = dead open (toggle, no-op, missed tap).
  // Reuse the current screen instead of inventing a fake node.
  if (input.pathKeys.length > 0 && session.currentScreenId) {
    const current = session.screens.find((screen) => screen.id === session.currentScreenId);
    if (current && current.locale === input.locale && current.fingerprint === fingerprint) {
      return { session, screen: current, isNew: false };
    }
  }
  const existing = session.screens.find(
    (screen) => screen.locale === input.locale && screen.canonicalKey === canonicalKey,
  );
  if (existing) {
    if (input.makeCurrent && session.currentScreenId !== existing.id) {
      session.currentScreenId = existing.id;
      session.currentLocale = input.locale;
      session.updatedAt = Date.now();
      await writeSession(session);
      emitCorpus(session);
    }
    return { session, screen: existing, isNew: false };
  }
  if (session.screens.length >= session.scope.maxScreens) {
    throw new Error("corpus screen budget is exhausted");
  }
  const controls = corpusControls(input.nodes, {
    allowSensitive: session.scope.allowSensitiveControls,
  });
  const localizedLabels = Object.fromEntries(
    controls.map((control) => [control.stableKey, control.label]),
  );
  const screen: CorpusScreen = {
    id: `screen-${randomUUID()}`,
    canonicalKey,
    fingerprint,
    locale: input.locale,
    depth: input.depth,
    path: [...input.path],
    pathKeys: [...input.pathKeys],
    ...(input.title?.trim()
      ? { title: input.title.trim() }
      : (() => {
          const title = titleFromNodes(input.nodes, input.path);
          return title ? { title } : {};
        })()),
    capturedAt: Date.now(),
    controls,
    localizedLabels,
  };
  if (input.screenshotPath) {
    await mkdir(join(sessionDir(session.id), "screens"), { recursive: true });
    const destination = screenAssetPath(session.id, screen.id);
    await copyFile(input.screenshotPath, destination);
    screen.screenshotPath = `screens/${screen.id}.png`;
  }
  session.screens.push(screen);
  if (input.makeCurrent) {
    session.currentScreenId = screen.id;
    session.currentLocale = input.locale;
  }
  session.updatedAt = screen.capturedAt;
  await writeSession(session);
  emitCorpus(session);
  return { session, screen, isNew: true };
}

async function recordCorpusTransition(
  input: Omit<CorpusTransition, "id" | "capturedAt"> & { sessionId: string },
): Promise<CorpusTransition> {
  const session = await readCorpusSession(input.sessionId);
  if (!session) throw new Error("corpus session not found");
  assertCorpusAccess(session);
  assertMutable(session);
  if (session.transitions.length >= session.scope.maxTransitions) {
    throw new Error("corpus transition budget is exhausted");
  }
  const transition: CorpusTransition = {
    id: `transition-${randomUUID()}`,
    fromScreenId: input.fromScreenId,
    ...(input.toScreenId ? { toScreenId: input.toScreenId } : {}),
    locale: input.locale,
    kind: input.kind,
    ...(input.label?.trim() ? { label: input.label.trim() } : {}),
    ...(input.stableKey ? { stableKey: input.stableKey } : {}),
    ...(input.target ? { target: input.target } : {}),
    depth: input.depth,
    capturedAt: Date.now(),
    changedScreen: input.changedScreen,
  };
  session.transitions.push(transition);
  session.currentScreenId = input.toScreenId ?? input.fromScreenId;
  session.updatedAt = transition.capturedAt;
  await writeSession(session);
  emitCorpus(session);
  return transition;
}

export async function readCorpusScreenAsset(
  sessionId: string,
  screenId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(screenAssetPath(sessionId, screenId));
  } catch {
    return null;
  }
}

export function buildCorpusCoverage(session: CorpusSession): CorpusCoverageReport {
  const locales = session.scope.locales;
  const byKey = new Map<string, CorpusScreen[]>();
  for (const screen of session.screens) {
    const group = byKey.get(screen.canonicalKey) ?? [];
    group.push(screen);
    byKey.set(screen.canonicalKey, group);
  }
  const screens = [...byKey.entries()].map(([canonicalKey, group]) => {
    const observedLocales = [...new Set(group.map((screen) => screen.locale))];
    const missingLocales = locales.filter((locale) => !observedLocales.includes(locale));
    const label =
      group.find((screen) => screen.title)?.title ??
      group[0]?.path.at(-1) ??
      canonicalKey.slice(0, 12);
    return {
      id: canonicalKey.slice(0, 16),
      label,
      canonicalKey,
      observedLocales,
      missingLocales,
      screenIds: group.map((screen) => screen.id),
    };
  });
  screens.sort((left, right) => left.label.localeCompare(right.label));
  const complete = screens.filter((item) => item.missingLocales.length === 0).length;
  const missing = screens.filter((item) => item.observedLocales.length === 0).length;
  const partial = screens.length - complete - missing;
  return {
    sessionId: session.id,
    name: session.name,
    generatedAt: Date.now(),
    locales: [...locales],
    screens,
    complete,
    partial,
    missing,
  };
}

function packRelativePath(screen: CorpusScreen): string {
  const segments = [
    slugCorpusPathSegment(screen.locale),
    ...screen.pathKeys.map(slugCorpusPathSegment),
  ];
  if (!screen.pathKeys.length && screen.path.length) {
    segments.push(...screen.path.map(slugCorpusPathSegment));
  }
  if (segments.length === 1) segments.push("root");
  // Avoid collisions when two screens share a path label.
  const base = segments.join("/");
  return `${base}__${screen.canonicalKey.slice(0, 10)}.png`;
}

export async function exportCorpusPack(sessionId: string): Promise<{
  session: CorpusSession;
  manifest: CorpusPackManifest;
  rootDir: string;
}> {
  const session = await readCorpusSession(sessionId);
  if (!session) throw new Error("corpus session not found");
  assertCorpusAccess(session);
  const rootDir = join(sessionDir(session.id), "pack");
  await rm(rootDir, { recursive: true, force: true });
  await mkdir(rootDir, { recursive: true });

  const screens: CorpusPackManifest["screens"] = [];
  const byCanonicalKey: CorpusPackManifest["byCanonicalKey"] = {};

  for (const screen of session.screens) {
    if (!screen.screenshotPath) continue;
    const relative = packRelativePath(screen);
    const absolute = join(rootDir, relative);
    await mkdir(join(absolute, ".."), { recursive: true });
    await copyFile(screenAssetPath(session.id, screen.id), absolute);
    screen.artifactPath = `pack/${relative}`;
    screens.push({
      id: screen.id,
      locale: screen.locale,
      canonicalKey: screen.canonicalKey,
      depth: screen.depth,
      path: screen.path,
      pathKeys: screen.pathKeys,
      ...(screen.title ? { title: screen.title } : {}),
      file: relative,
    });
    const bucket = byCanonicalKey[screen.canonicalKey] ?? {};
    bucket[screen.locale] = relative;
    byCanonicalKey[screen.canonicalKey] = bucket;
  }

  const manifest: CorpusPackManifest = {
    schemaVersion: 1,
    sessionId: session.id,
    name: session.name,
    generatedAt: Date.now(),
    locales: [...session.scope.locales],
    rootDir: `pack`,
    screens,
    byCanonicalKey,
  };
  await writeFile(join(rootDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(
    join(rootDir, "README.md"),
    [
      `# ${session.name}`,
      "",
      `Locales: ${session.scope.locales.join(", ")}`,
      `Screens: ${screens.length}`,
      "",
      "Each PNG path is `<locale>/<path>__<canonicalKey>.png`.",
      "`manifest.json` groups the same logical screen across languages under `byCanonicalKey`.",
      "",
    ].join("\n"),
    "utf8",
  );

  session.packRoot = "pack";
  session.updatedAt = Date.now();
  await writeSession(session);
  emitCorpus(session);
  return { session, manifest, rootDir };
}

export function formatCorpusExport(session: CorpusSession, format: "json" | "markdown"): string {
  if (format === "json") return `${JSON.stringify(session, null, 2)}\n`;
  const coverage = buildCorpusCoverage(session);
  const lines = [
    `# ${session.name}`,
    "",
    `- Status: ${session.status}`,
    `- Target: ${session.targetProfile?.name ?? session.targetId}`,
    `- Locales: ${session.scope.locales.join(", ")}`,
    `- Screens: ${session.screens.length}`,
    `- Transitions: ${session.transitions.length}`,
    `- Coverage: ${coverage.complete} complete · ${coverage.partial} partial`,
    "",
    "## Screens by locale",
  ];
  for (const locale of session.scope.locales) {
    lines.push("", `### ${locale}`);
    for (const screen of session.screens.filter((item) => item.locale === locale)) {
      const path = screen.path.length ? screen.path.join(" › ") : "Root";
      lines.push(
        `- d${screen.depth} ${path}${screen.title ? ` — ${screen.title}` : ""} (\`${screen.artifactPath ?? screen.screenshotPath ?? screen.id}\`)`,
      );
    }
  }
  return `${lines.join("\n")}\n`;
}

async function runNavSteps(
  device: Device,
  steps: CorpusNavStep[] | undefined,
  app: string | undefined,
): Promise<void> {
  if (!steps?.length) return;
  for (const step of steps) {
    if (step.kind === "wait") {
      await sleep(step.ms, device);
      continue;
    }
    if (step.kind === "back") {
      const context = currentTargetContext();
      const serial = context.kind === "device" ? context.serial : undefined;
      if (serial) await backtrack(serial, device, app);
      else {
        await pressKey(device, "back");
        await sleep(450, device);
      }
      continue;
    }
    if (step.kind === "relaunch") {
      if (!app) throw new Error("relaunch requires scope.app");
      await openApp(device, app, { relaunch: true });
      continue;
    }
    if (step.kind === "openApp") {
      const target = step.app?.trim() || app;
      if (!target) throw new Error("openApp requires step.app or scope.app");
      await openApp(device, target, { relaunch: step.relaunch === true });
      await sleep(700, device);
      continue;
    }
    if (step.kind === "scroll") {
      if (step.direction === "down") await scrollDown(device, step.amount ?? 1);
      else {
        // scrollDown only — approximate up with a reverse swipe via interact
        await interact(
          {
            kind: "swipe",
            from: { x: 0.5, y: 0.35 },
            to: { x: 0.5, y: 0.75 },
            durationMs: 280,
          },
          undefined,
        );
      }
      await sleep(350, device);
      continue;
    }
    // Identifier-only chrome (tabs/sidebar/gear) is soft: already on Settings
    // must not abort the whole crawl when Ask/sidebar is not on screen.
    const softIdentifier =
      Boolean(step.target.identifier) && !step.target.label && !step.target.text;
    try {
      if (step.target.identifier) {
        await pressIdentifier(device, step.target.identifier);
      } else if (step.target.text) {
        await pressMatchingText(device, step.target.text);
      } else if (step.target.label) {
        try {
          await pressLabel(device, step.target.label);
        } catch {
          await pressMatchingText(device, step.target.label);
        }
      }
    } catch (error) {
      if (!softIdentifier) throw error;
    }
    await sleep(500, device);
  }
}

function controlToInteract(control: CorpusControl): InteractInput {
  if (control.target.identifier)
    return { kind: "identifier", identifier: control.target.identifier };
  if (control.target.ref) return { kind: "ref", ref: control.target.ref };
  if (control.target.label) return { kind: "label", label: control.target.label };
  if (control.target.text) return { kind: "text-match", match: control.target.text };
  if (control.target.point) {
    return { kind: "point", x: control.target.point.x, y: control.target.point.y };
  }
  throw new Error(`control ${control.label} has no actionable target`);
}

async function captureCurrent(input: {
  sessionId: string;
  serial: string;
  locale: string;
  depth: number;
  path: string[];
  pathKeys: string[];
}): Promise<{ session: CorpusSession; screen: CorpusScreen; isNew: boolean }> {
  const snap = await captureSnapshot({ serial: input.serial });
  const shot = await captureScreenshot({ serial: input.serial, ephemeral: true });
  try {
    return await recordCorpusScreen({
      sessionId: input.sessionId,
      nodes: snap.nodes,
      locale: input.locale,
      depth: input.depth,
      path: input.path,
      pathKeys: input.pathKeys,
      screenshotPath: shot.path,
      makeCurrent: true,
    });
  } finally {
    await cleanupScreenshot(shot.path);
  }
}

function isCancelled(sessionId: string): boolean {
  return activeCorpusCrawls.get(sessionId)?.cancel === true;
}

async function backtrack(serial: string, device: Device, app?: string): Promise<void> {
  await dismissTowardParent({ serial, device, parentTitles: ["Settings"] });
  // External browsers / App Store are dead ends — return to the product app.
  if (app) {
    try {
      const snap = await captureSnapshot({ serial });
      const root = snap.nodes.find((node) => node.depth === 0) ?? snap.nodes[0];
      const bundle = (root?.bundleId ?? root?.label ?? "").toLocaleLowerCase();
      if (bundle && !bundle.includes("grok") && !bundle.includes(app.toLocaleLowerCase())) {
        await openApp(device, app, { relaunch: false });
        await sleep(700, device);
      }
    } catch {
      try {
        await openApp(device, app, { relaunch: false });
        await sleep(700, device);
      } catch {
        /* keep going */
      }
    }
  }
}

async function collectControlsWithScroll(
  device: Device,
  serial: string,
  options?: { allowSensitive?: boolean; maxScrolls?: number },
): Promise<{ nodes: SnapshotNode[]; controls: CorpusControl[] }> {
  const allowSensitive = options?.allowSensitive === true;
  const result = await scrollCollectControls({
    serial,
    device,
    maxScrolls: options?.maxScrolls,
    extract: (nodes) => corpusControls(nodes, { allowSensitive }),
    keyOf: (control) => control.stableKey,
  });
  return { nodes: result.nodes, controls: result.controls };
}

async function crawlLocale(input: {
  session: CorpusSession;
  locale: string;
  serial: string;
  device: Device;
  /** When set, record open/back actions into this plan (map phase). */
  recordPlan?: CorpusMapAction[];
}): Promise<CorpusSession> {
  let session = input.session;
  const { locale, serial, device } = input;
  const app = session.scope.app;
  const visitedKeys = new Set(
    session.screens
      .filter((screen) => screen.locale === locale)
      .map((screen) => screen.canonicalKey),
  );
  const exploredEdges = new Set(
    session.transitions
      .filter((transition) => transition.locale === locale && transition.stableKey)
      .map((transition) => `${transition.fromScreenId}:${transition.stableKey}`),
  );

  const root = await captureCurrent({
    sessionId: session.id,
    serial,
    locale,
    depth: 0,
    path: [],
    pathKeys: [],
  });
  session = root.session;
  visitedKeys.add(root.screen.canonicalKey);

  // Long settings lists only expose visible rows in one snapshot — scroll-merge
  // before DFS so off-screen cells enter the map plan.
  let rootQueue = [...(root.screen.controls ?? [])];
  try {
    const scrolled = await collectControlsWithScroll(device, serial, {
      allowSensitive: session.scope.allowSensitiveControls,
      maxScrolls: 5,
    });
    if (scrolled.controls.length > rootQueue.length) {
      rootQueue = scrolled.controls;
      // Keep the recorded root screen's control list in sync for exports.
      const live = session.screens.find((screen) => screen.id === root.screen.id);
      if (live) {
        live.controls = scrolled.controls;
        live.localizedLabels = Object.fromEntries(
          scrolled.controls.map((control) => [control.stableKey, control.label]),
        );
        session.updatedAt = Date.now();
        await writeSession(session);
      }
    }
  } catch {
    /* keep single-snapshot queue */
  }

  type Frame = {
    screenId: string;
    canonicalKey: string;
    depth: number;
    path: string[];
    pathKeys: string[];
    queue: CorpusControl[];
  };

  const stack: Frame[] = [
    {
      screenId: root.screen.id,
      canonicalKey: root.screen.canonicalKey,
      depth: 0,
      path: [],
      pathKeys: [],
      queue: rootQueue,
    },
  ];

  while (stack.length) {
    if (isCancelled(session.id)) throw new Error("corpus cancelled");
    if (Date.now() - session.createdAt > session.scope.maxDurationMs) {
      throw new Error("corpus time budget is exhausted");
    }
    const frame = stack[stack.length - 1]!;
    if (frame.depth >= session.scope.maxDepth || frame.queue.length === 0) {
      stack.pop();
      if (stack.length) {
        if (input.recordPlan) {
          input.recordPlan.push({
            kind: "back",
            depth: frame.depth,
            fromCanonicalKey: frame.canonicalKey,
          });
        }
        await backtrack(serial, device, app);
        await updateProgress(session, {
          phase: input.recordPlan ? "mapping" : "crawling",
          locale,
          depth: stack[stack.length - 1]?.depth,
          path: stack[stack.length - 1]?.path,
          message: "Backtracking",
        });
      }
      continue;
    }

    const control = frame.queue.shift()!;
    const edgeKey = `${frame.screenId}:${control.stableKey}`;
    if (exploredEdges.has(edgeKey)) continue;
    exploredEdges.add(edgeKey);

    await updateProgress(session, {
      phase: input.recordPlan ? "mapping" : "crawling",
      locale,
      depth: frame.depth,
      path: [...frame.path, control.label],
      message: `Open “${control.label}”`,
    });

    const beforeId = frame.screenId;
    const beforeKey = frame.canonicalKey;
    try {
      await interact(controlToInteract(control), { serial });
      await sleep(550, device);
    } catch (error) {
      await updateProgress(session, {
        phase: input.recordPlan ? "mapping" : "crawling",
        locale,
        message: `Skipped “${control.label}”: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const nextPath = [...frame.path, control.label];
    const nextPathKeys = [...frame.pathKeys, control.stableKey];
    const after = await captureCurrent({
      sessionId: session.id,
      serial,
      locale,
      depth: frame.depth + 1,
      path: nextPath,
      pathKeys: nextPathKeys,
    });
    session = after.session;

    await recordCorpusTransition({
      sessionId: session.id,
      fromScreenId: beforeId,
      ...(after.screen.id !== beforeId ? { toScreenId: after.screen.id } : {}),
      locale,
      kind: "tap",
      label: control.label,
      stableKey: control.stableKey,
      target: control.target,
      depth: frame.depth,
      changedScreen: after.screen.id !== beforeId,
    });
    session = (await readCorpusSession(session.id))!;

    if (input.recordPlan && after.screen.id !== beforeId) {
      input.recordPlan.push({
        kind: "open",
        stableKey: control.stableKey,
        label: control.label,
        target: control.target,
        depth: frame.depth,
        pathKeys: nextPathKeys,
        path: nextPath,
        fromCanonicalKey: beforeKey,
        toCanonicalKey: after.screen.canonicalKey,
      });
    }

    if (after.screen.id === beforeId || visitedKeys.has(after.screen.canonicalKey)) {
      if (after.screen.id !== beforeId) {
        if (input.recordPlan) {
          input.recordPlan.push({
            kind: "back",
            depth: frame.depth + 1,
            fromCanonicalKey: after.screen.canonicalKey,
          });
        }
        await backtrack(serial, device, app);
      }
      continue;
    }

    visitedKeys.add(after.screen.canonicalKey);
    if (frame.depth + 1 < session.scope.maxDepth) {
      let childQueue = [...(after.screen.controls ?? [])];
      try {
        const scrolled = await collectControlsWithScroll(device, serial, {
          allowSensitive: session.scope.allowSensitiveControls,
          maxScrolls: 3,
        });
        if (scrolled.controls.length > childQueue.length) {
          childQueue = scrolled.controls;
          const live = session.screens.find((screen) => screen.id === after.screen.id);
          if (live) {
            live.controls = scrolled.controls;
            live.localizedLabels = Object.fromEntries(
              scrolled.controls.map((control) => [control.stableKey, control.label]),
            );
            session.updatedAt = Date.now();
            await writeSession(session);
          }
        }
      } catch {
        /* keep single-snapshot queue */
      }
      stack.push({
        screenId: after.screen.id,
        canonicalKey: after.screen.canonicalKey,
        depth: frame.depth + 1,
        path: nextPath,
        pathKeys: nextPathKeys,
        queue: childQueue,
      });
    } else {
      if (input.recordPlan) {
        input.recordPlan.push({
          kind: "back",
          depth: frame.depth + 1,
          fromCanonicalKey: after.screen.canonicalKey,
        });
      }
      await backtrack(serial, device, app);
    }
  }

  return (await readCorpusSession(session.id))!;
}

/**
 * Replay the map-locale plan in another language: same open/back sequence,
 * resolved by stableKey on the live screen (identifiers / LocalizedStringKey).
 */
async function replayLocalePlan(input: {
  session: CorpusSession;
  locale: string;
  serial: string;
  device: Device;
  plan: CorpusMapPlan;
}): Promise<CorpusSession> {
  let session = input.session;
  const { locale, serial, device, plan } = input;

  await updateProgress(session, {
    phase: "replaying",
    locale,
    depth: 0,
    path: [],
    message: `Replaying map in ${locale}`,
  });

  let path: string[] = [];
  let pathKeys: string[] = [];
  let depth = 0;

  const root = await captureCurrent({
    sessionId: session.id,
    serial,
    locale,
    depth: 0,
    path: [],
    pathKeys: [],
  });
  session = root.session;
  let currentScreenId = root.screen.id;

  for (const action of plan.actions) {
    if (isCancelled(session.id)) throw new Error("corpus cancelled");
    if (Date.now() - session.createdAt > session.scope.maxDurationMs) {
      throw new Error("corpus time budget is exhausted");
    }

    if (action.kind === "back") {
      await backtrack(serial, device, session.scope.app);
      depth = Math.max(0, action.depth - 1);
      path = path.slice(0, -1);
      pathKeys = pathKeys.slice(0, -1);
      const after = await captureCurrent({
        sessionId: session.id,
        serial,
        locale,
        depth,
        path,
        pathKeys,
      });
      session = after.session;
      await recordCorpusTransition({
        sessionId: session.id,
        fromScreenId: currentScreenId,
        ...(after.screen.id !== currentScreenId ? { toScreenId: after.screen.id } : {}),
        locale,
        kind: "back",
        depth,
        changedScreen: after.screen.id !== currentScreenId,
      });
      session = (await readCorpusSession(session.id))!;
      currentScreenId = after.screen.id;
      await updateProgress(session, {
        phase: "replaying",
        locale,
        depth,
        path,
        message: "Backtracking",
      });
      continue;
    }

    const live = session.screens.find((screen) => screen.id === currentScreenId);
    const control =
      live?.controls?.find((item) => item.stableKey === action.stableKey) ??
      ({
        id: action.stableKey,
        label: action.label,
        stableKey: action.stableKey,
        target: action.target,
      } satisfies CorpusControl);

    await updateProgress(session, {
      phase: "replaying",
      locale,
      depth: action.depth,
      path: action.path,
      message: `Open “${control.label}”`,
    });

    const beforeId = currentScreenId;
    try {
      await interact(controlToInteract(control), { serial });
      await sleep(550, device);
    } catch (error) {
      await updateProgress(session, {
        phase: "replaying",
        locale,
        message: `Skipped “${control.label}”: ${error instanceof Error ? error.message : String(error)}`,
      });
      path = action.path;
      pathKeys = action.pathKeys;
      depth = action.depth + 1;
      continue;
    }

    path = action.path;
    pathKeys = action.pathKeys;
    depth = action.depth + 1;

    const after = await captureCurrent({
      sessionId: session.id,
      serial,
      locale,
      depth,
      path,
      pathKeys,
    });
    session = after.session;

    await recordCorpusTransition({
      sessionId: session.id,
      fromScreenId: beforeId,
      ...(after.screen.id !== beforeId ? { toScreenId: after.screen.id } : {}),
      locale,
      kind: "tap",
      label: control.label,
      stableKey: control.stableKey,
      target: control.target,
      depth: action.depth,
      changedScreen: after.screen.id !== beforeId,
    });
    session = (await readCorpusSession(session.id))!;
    currentScreenId = after.screen.id;
  }

  return (await readCorpusSession(session.id))!;
}

async function switchToLocale(input: {
  session: CorpusSession;
  locale: string;
  device: Device;
  app?: string;
}): Promise<void> {
  const { session, locale, device, app } = input;
  const languageSteps = session.scope.languageOptions?.[locale];
  await updateProgress(session, {
    phase: "switching-language",
    locale,
    message: `Switching language to ${locale}`,
  });
  if (app) await openApp(device, app, { relaunch: true });
  if (session.scope.entryPath?.length) {
    await runNavSteps(device, session.scope.entryPath, app);
  }
  if (session.scope.languagePath?.length || languageSteps?.length) {
    await runNavSteps(device, session.scope.languagePath, app);
    await runNavSteps(device, languageSteps, app);
  }
  if (app) await openApp(device, app, { relaunch: true });
  if (session.scope.entryPath?.length) {
    await runNavSteps(device, session.scope.entryPath, app);
  }
}

async function runCorpusCrawl(sessionId: string): Promise<void> {
  const initial = await readCorpusSession(sessionId);
  if (!initial) throw new Error("corpus session not found");
  let session: CorpusSession = initial;
  const serial = session.targetId;
  const platform = (await devicePlatformForSerial(serial)) ?? "ios";

  await runWithTargetContext({ kind: "device", platform, serial }, async () => {
    const device = createDevice();

    try {
      session.status = "running";
      session.error = undefined;
      session.updatedAt = Date.now();
      await writeSession(session);
      emitCorpus(session);

      const app = session.scope.app;
      const strategy = session.scope.strategy ?? "map-once-replay";
      const mapLocale = session.scope.mapLocale ?? session.scope.locales[0]!;
      const otherLocales = session.scope.locales.filter((locale) => locale !== mapLocale);

      const alreadyInSettingsBeforeOpen =
        (await exists(device, "Settings")) &&
        ((await exists(device, "Appearance")) ||
          (await exists(device, "SuperGrok")) ||
          (await exists(device, "Haptics")));

      if (app && !alreadyInSettingsBeforeOpen) {
        await updateProgress(session, { phase: "opening", message: `Opening ${app}` });
        // Prefer attaching to a warm session. Hard relaunch trips CoreDevice
        // "list apps" flakes on physical iPads that already have the app open.
        try {
          await openApp(device, app, { relaunch: false });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (
            /already in use by session|CoreDevice\.ActionError|Failed to list iOS apps/i.test(
              message,
            )
          ) {
            // Foreign agent-device sessions block XCTest. Reclaim once, then continue.
            await updateProgress(session, {
              phase: "opening",
              message: `Reclaiming device session (${message.slice(0, 100)})`,
            });
            const target = currentTargetContext();
            await hardStopDeviceSession(target).catch(() => undefined);
            resetDeviceClient(target);
            await sleep(800, device);
            try {
              await openApp(device, app, { relaunch: false });
            } catch (reclaimError) {
              const reclaimMessage =
                reclaimError instanceof Error ? reclaimError.message : String(reclaimError);
              await updateProgress(session, {
                phase: "opening",
                message: `App open skipped (${reclaimMessage.slice(0, 120)}); using current foreground`,
              });
            }
          } else {
            try {
              await openApp(device, app, { relaunch: true });
            } catch (retryError) {
              const retryMessage =
                retryError instanceof Error ? retryError.message : String(retryError);
              if (
                /already in use by session|CoreDevice\.ActionError|Failed to list iOS apps/i.test(
                  retryMessage,
                )
              ) {
                await updateProgress(session, {
                  phase: "opening",
                  message: `Relaunch failed (${retryMessage.slice(0, 120)}); continuing on current UI`,
                });
              } else {
                throw retryError;
              }
            }
          }
        }
      }

      if (alreadyInSettingsBeforeOpen) {
        await updateProgress(session, {
          phase: "opening",
          message: "Already on Settings — skipping app open and entry path",
        });
      } else if (session.scope.entryPath?.length) {
        const alreadyInSettings =
          (await exists(device, "Settings")) &&
          ((await exists(device, "Appearance")) || (await exists(device, "SuperGrok")));
        if (alreadyInSettings) {
          await updateProgress(session, {
            phase: "opening",
            message: "Already on Settings — skipping entry path",
          });
        } else {
          await updateProgress(session, { phase: "opening", message: "Walking entry path" });
          await runNavSteps(device, session.scope.entryPath, app);
        }
      }

      // Ensure map locale is active before discovery when a switch path exists.
      if (session.scope.languageOptions?.[mapLocale]?.length) {
        await switchToLocale({ session, locale: mapLocale, device, app });
        session = (await readCorpusSession(sessionId))!;
      }

      if (strategy === "map-once-replay") {
        const actions: CorpusMapAction[] = [];
        session = await crawlLocale({
          session,
          locale: mapLocale,
          serial,
          device,
          recordPlan: actions,
        });
        const rootScreen = session.screens.find(
          (screen) => screen.locale === mapLocale && screen.depth === 0,
        );
        const plan: CorpusMapPlan = {
          mappedLocale: mapLocale,
          ...(rootScreen ? { rootCanonicalKey: rootScreen.canonicalKey } : {}),
          actions,
          mappedAt: Date.now(),
        };
        session.mapPlan = plan;
        session.updatedAt = Date.now();
        await writeSession(session);
        emitCorpus(session);

        for (const locale of otherLocales) {
          if (isCancelled(sessionId)) throw new Error("corpus cancelled");
          session = (await readCorpusSession(sessionId))!;
          await switchToLocale({ session, locale, device, app });
          session = (await readCorpusSession(sessionId))!;
          session = await replayLocalePlan({
            session,
            locale,
            serial,
            device,
            plan,
          });
        }
      } else {
        for (const locale of session.scope.locales) {
          if (isCancelled(sessionId)) throw new Error("corpus cancelled");
          session = (await readCorpusSession(sessionId))!;
          if (
            locale !== session.scope.locales[0] ||
            session.scope.languageOptions?.[locale]?.length
          ) {
            await switchToLocale({ session, locale, device, app });
            session = (await readCorpusSession(sessionId))!;
          }
          session = await crawlLocale({ session, locale, serial, device });
        }
      }

      session = (await readCorpusSession(sessionId))!;
      await updateProgress(session, { phase: "exporting", message: "Writing labeled pack" });
      const exported = await exportCorpusPack(sessionId);
      session = exported.session;
      session.status = "complete";
      const openCount =
        session.mapPlan?.actions.filter((action) => action.kind === "open").length ?? 0;
      const planNote = session.mapPlan ? ` · map ${openCount} opens` : "";
      session.progress = {
        phase: "complete",
        screensCaptured: session.screens.length,
        transitionsCaptured: session.transitions.length,
        message: `Captured ${session.screens.length} screens across ${session.scope.locales.length} locales${planNote}`,
        updatedAt: Date.now(),
      };
      session.updatedAt = session.progress.updatedAt;
      await writeSession(session);
      emitCorpus(session);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      session = (await readCorpusSession(sessionId)) ?? session;
      if (!session) return;
      const cancelled = /cancelled/i.test(message) || isCancelled(sessionId);
      session.status = cancelled ? "stopped" : "failed";
      session.error = message;
      session.progress = {
        ...session.progress,
        phase: "failed",
        message,
        screensCaptured: session.screens.length,
        transitionsCaptured: session.transitions.length,
        updatedAt: Date.now(),
      };
      session.updatedAt = session.progress.updatedAt;
      try {
        await exportCorpusPack(sessionId);
        session = (await readCorpusSession(sessionId)) ?? session;
        session.status = cancelled ? "stopped" : "failed";
        session.error = message;
      } catch {
        // ignore export failures during error handling
      }
      await writeSession(session);
      emitCorpus(session);
      if (!cancelled) throw error;
    } finally {
      activeCorpusCrawls.delete(sessionId);
    }
  });
}

/** Start an exclusive crawl. Returns the session immediately; work continues in-process. */
export async function startCorpusSession(id: string): Promise<CorpusSession> {
  const session = await readCorpusSession(id);
  if (!session) throw new Error("corpus session not found");
  assertCorpusAccess(session);
  if (session.status === "running") return session;
  if (!STATUS_TRANSITIONS[session.status].includes("running")) {
    throw new Error(`cannot start corpus from ${session.status}`);
  }
  if (activeCorpusCrawls.has(id)) throw new Error("corpus crawl is already active");

  activeCorpusCrawls.set(id, { cancel: false });
  session.status = "running";
  session.error = undefined;
  session.progress = {
    phase: "opening",
    screensCaptured: session.screens.length,
    transitionsCaptured: session.transitions.length,
    message: "Starting corpus",
    updatedAt: Date.now(),
  };
  session.updatedAt = session.progress.updatedAt;
  await writeSession(session);
  emitCorpus(session);

  const handle = activeCorpusCrawls.get(id)!;
  handle.promise = runCorpusCrawl(id).catch(() => {
    // errors persisted on the session
  });
  return session;
}

export async function cancelCorpusSession(id: string): Promise<CorpusSession> {
  const active = activeCorpusCrawls.get(id);
  if (active) active.cancel = true;
  const session = await readCorpusSession(id);
  if (!session) throw new Error("corpus session not found");
  assertCorpusAccess(session);
  if (session.status === "running" || session.status === "paused") {
    session.status = "stopped";
    session.progress = {
      ...session.progress,
      phase: "failed",
      message: "Cancelled",
      updatedAt: Date.now(),
    };
    session.updatedAt = session.progress.updatedAt;
    await writeSession(session);
    emitCorpus(session);
  }
  return session;
}

/** Test helper — clear in-memory crawl registry between tests. */
export function resetCorpusCrawlsForTests(): void {
  activeCorpusCrawls.clear();
}
