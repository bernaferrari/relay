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
  CorpusAnalysisReport,
  CorpusFinding,
  CorpusJourney,
  CorpusJourneyStep,
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
  scrollUp,
  scrollDown,
  setAndroidAppLocale,
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

const MAX_CORPUS_LOCALES = 250;

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

function screenAccessibilityAssetPath(sessionId: string, screenId: string): string {
  if (!/^screen-[A-Za-z0-9-]+$/.test(screenId)) throw new Error("invalid corpus screen id");
  return join(sessionDir(sessionId), "screens", `${screenId}.accessibility.json`);
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
      const stableKey = optionalText(target.stableKey, `${label}[${index}].target.stableKey`, 500);
      const tapLabel = optionalText(target.label, `${label}[${index}].target.label`, 240);
      const text = optionalText(target.text, `${label}[${index}].target.text`, 240);
      const point = target.point as Record<string, unknown> | undefined;
      const x = point ? Number(point.x) : Number.NaN;
      const y = point ? Number(point.y) : Number.NaN;
      const validPoint = Number.isFinite(x) && Number.isFinite(y) && x >= 0 && y >= 0;
      if (!stableKey && !identifier && !tapLabel && !text && !validPoint) {
        throw new Error(`${label}[${index}] tap target requires identifier, label, text, or point`);
      }
      return {
        kind: "tap",
        target: {
          ...(identifier ? { identifier } : {}),
          ...(stableKey ? { stableKey } : {}),
          ...(tapLabel ? { label: tapLabel } : {}),
          ...(text ? { text } : {}),
          ...(validPoint ? { point: { x, y } } : {}),
        },
      };
    }
    throw new Error(`${label}[${index}].kind is unsupported`);
  });
}

function normalizeJourneys(value: unknown): CorpusJourney[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("journeys must be an array");
  const seen = new Set<string>();
  return value.map((journey, journeyIndex) => {
    if (!journey || typeof journey !== "object") {
      throw new Error(`journeys[${journeyIndex}] is invalid`);
    }
    const record = journey as Record<string, unknown>;
    const id = requiredText(record.id, `journeys[${journeyIndex}].id`, 120);
    if (seen.has(id)) throw new Error(`duplicate journey id: ${id}`);
    seen.add(id);
    const name = requiredText(record.name, `journeys[${journeyIndex}].name`, 160);
    if (!Array.isArray(record.steps) || !record.steps.length) {
      throw new Error(`journeys[${journeyIndex}].steps must not be empty`);
    }
    const steps = record.steps.map((step, stepIndex): CorpusJourneyStep => {
      if (!step || typeof step !== "object") {
        throw new Error(`journeys[${journeyIndex}].steps[${stepIndex}] is invalid`);
      }
      const stepRecord = step as Record<string, unknown>;
      if (stepRecord.kind === "capture") {
        return {
          kind: "capture",
          name: requiredText(
            stepRecord.name,
            `journeys[${journeyIndex}].steps[${stepIndex}].name`,
            160,
          ),
          ...(optionalText(stepRecord.key, `journeys[${journeyIndex}].steps[${stepIndex}].key`, 120)
            ? {
                key: optionalText(
                  stepRecord.key,
                  `journeys[${journeyIndex}].steps[${stepIndex}].key`,
                  120,
                )!,
              }
            : {}),
        };
      }
      return normalizeNavSteps([step], `journeys[${journeyIndex}].steps[${stepIndex}]`)![0]!;
    });
    if (!steps.some((step) => step.kind === "capture")) {
      throw new Error(`journey ${id} requires at least one capture step`);
    }
    return { id, name, steps };
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
  if (locales.length > MAX_CORPUS_LOCALES) {
    throw new Error(`corpus supports at most ${MAX_CORPUS_LOCALES} locales`);
  }
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
  const entryPath = normalizeNavSteps(scope?.entryPath, "entryPath");
  const languagePath = normalizeNavSteps(scope?.languagePath, "languagePath");
  const journeys = normalizeJourneys(scope?.journeys);
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
    ...(entryPath ? { entryPath } : {}),
    ...(languagePath ? { languagePath } : {}),
    ...(languageOptions && Object.keys(languageOptions).length ? { languageOptions } : {}),
    ...(journeys ? { journeys } : {}),
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

function structuralControlKey(
  nodes: SnapshotNode[],
  node: SnapshotNode,
  fallbackIndex: number,
): string {
  const byIndex = new Map(
    nodes.map((candidate, index) => [candidate.index ?? index, candidate] as const),
  );
  const segments: string[] = [];
  let current: SnapshotNode | undefined = node;
  let guard = 0;
  while (current && guard < 14) {
    const parentIndex = current.parentIndex;
    const type = (current.role ?? current.type ?? "control").trim().toLocaleLowerCase();
    const siblings = nodes.filter((candidate) => candidate.parentIndex === parentIndex);
    const sameType = siblings.filter(
      (candidate) =>
        (candidate.role ?? candidate.type ?? "control").trim().toLocaleLowerCase() === type,
    );
    const ordinal = Math.max(0, sameType.indexOf(current));
    segments.push(`${type}[${ordinal}]`);
    if (parentIndex === undefined) break;
    current = byIndex.get(parentIndex);
    guard += 1;
  }
  return `structure:${segments.reverse().join("/") || `control[${fallbackIndex}]`}`;
}

function isSystemOrKeyboardNode(node: SnapshotNode): boolean {
  const owner = `${node.bundleId ?? ""} ${node.identifier ?? ""}`;
  return /(?:^|\s)(?:com\.android\.systemui|com\.touchtype\.swiftkey|com\.google\.android\.inputmethod\.latin|com\.samsung\.android\.honeyboard)(?::|\/|\.|\s|$)/i.test(
    owner,
  );
}

function actionableAnchor(nodes: SnapshotNode[], node: SnapshotNode): SnapshotNode | undefined {
  if (node.hittable) return node;
  const byIndex = new Map(
    nodes.map((candidate, fallback) => [candidate.index ?? fallback, candidate] as const),
  );
  let parentIndex = node.parentIndex;
  let guard = 0;
  while (parentIndex !== undefined && guard < 16) {
    const parent = byIndex.get(parentIndex);
    if (!parent) return undefined;
    if (parent.hittable) return parent;
    parentIndex = parent.parentIndex;
    guard += 1;
  }
  return undefined;
}

/** Interactive candidates for the corpus crawl. Prefer stable identifiers. */
export function corpusControls(
  nodes: SnapshotNode[],
  options?: { allowSensitive?: boolean; includeToggles?: boolean },
): CorpusControl[] {
  const seen = new Set<string>();
  const nested = isNestedSettingsPage(nodes);
  return nodes
    .filter((node) => node.visibleToUser !== false && node.enabled !== false)
    .flatMap((node, index) => {
      if (isSystemOrKeyboardNode(node)) return [];
      const anchor = actionableAnchor(nodes, node);
      if (anchor && isSystemOrKeyboardNode(anchor)) return [];
      const visibleLabel = (node.label ?? node.value ?? "").trim();
      const identifierOnlyControl =
        !visibleLabel &&
        Boolean(node.identifier) &&
        Boolean(anchor) &&
        !/framelayout|linearlayout|scrollview|content|root/i.test(
          `${node.type ?? ""} ${node.identifier ?? ""}`,
        );
      const label = visibleLabel || (identifierOnlyControl ? node.identifier!.trim() : "");
      if (!label) return [];
      if (isCorpusChromeLabel(label)) return [];
      if (!options?.includeToggles && isToggleControl(node, label)) return [];
      if (!options?.allowSensitive && unsafeControlText(label)) return [];
      if (!anchor && node.type !== "Cell" && !node.identifier) return [];
      // Nested pages often still expose the parent settings list in the AX tree.
      if (nested && node.hittable === false && !node.identifier && !anchor) return [];
      const role = `${node.role ?? ""} ${node.type ?? ""}`.toLocaleLowerCase();
      if (
        /statictext|header|heading/.test(role) &&
        node.type !== "Cell" &&
        node.type !== "Button"
      ) {
        return [];
      }
      const semanticKey =
        stableLabelKey(anchor?.label) ??
        stableLabelKey(anchor?.value) ??
        stableLabelKey(node.label) ??
        stableLabelKey(node.value);
      const stableKey =
        anchor?.identifier || node.identifier || semanticKey
          ? corpusControlStableKey(anchor ?? node)
          : structuralControlKey(nodes, anchor ?? node, index);
      const target = anchor?.identifier
        ? { identifier: anchor.identifier }
        : anchor?.ref
          ? { ref: anchor.ref }
          : node.identifier
            ? { identifier: node.identifier }
            : node.ref
              ? { ref: node.ref }
              : stableLabelKey(node.label)
                ? { label: node.label! }
                : node.label
                  ? { label: node.label }
                  : undefined;
      if (!target) return [];
      const key = stableKey;
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

/**
 * Start additional locale replays from completed, auditable baseline evidence.
 *
 * A corpus map is expensive to discover but its recorded controls are locale
 * stable.  Copying the baseline means a locale comparison never has to crawl
 * English again, while the resulting pack remains self-contained: English,
 * screenshots, and accessibility sidecars all live beside the new locales.
 */
export async function createCorpusReplaySession(input: {
  sourceSessionId: string;
  name: string;
  targetId: string;
  targetProfile?: TargetProfile;
  locales: string[];
  projectId?: string;
  organizationId?: string;
}): Promise<CorpusSession> {
  const source = await readCorpusSession(input.sourceSessionId, {
    projectId: input.projectId,
  });
  if (!source) throw new Error("baseline corpus session not found");
  assertCorpusAccess(source);
  const mapLocale = source.scope.mapLocale ?? source.scope.locales[0]!;
  if (!source.mapPlan?.actions.length) {
    throw new Error("baseline corpus has no reusable screen map");
  }
  const baselineScreens = source.screens.filter((screen) => screen.locale === mapLocale);
  if (!baselineScreens.length) {
    throw new Error(`baseline corpus has no ${mapLocale} screenshots`);
  }

  const locales = [mapLocale, ...input.locales.filter((locale) => locale !== mapLocale)];
  const created = await createCorpusSession({
    name: input.name,
    targetId: input.targetId,
    targetProfile: input.targetProfile,
    projectId: input.projectId,
    organizationId: input.organizationId,
    scope: {
      ...source.scope,
      locales,
      mapLocale,
      strategy: "map-once-replay",
    },
  });

  const copiedScreens: CorpusScreen[] = [];
  for (const sourceScreen of baselineScreens) {
    const screen: CorpusScreen = { ...sourceScreen };
    delete screen.artifactPath;
    const sourcePng = screenAssetPath(source.id, sourceScreen.id);
    if (sourceScreen.screenshotPath && existsSync(sourcePng)) {
      await mkdir(join(sessionDir(created.id), "screens"), { recursive: true });
      await copyFile(sourcePng, screenAssetPath(created.id, sourceScreen.id));
    } else {
      delete screen.screenshotPath;
      delete screen.snapshotDigest;
    }
    const sourceAccessibility = screenAccessibilityAssetPath(source.id, sourceScreen.id);
    if (sourceScreen.accessibilityPath && existsSync(sourceAccessibility)) {
      await mkdir(join(sessionDir(created.id), "screens"), { recursive: true });
      await copyFile(
        sourceAccessibility,
        screenAccessibilityAssetPath(created.id, sourceScreen.id),
      );
    } else {
      delete screen.accessibilityPath;
      delete screen.accessibilityDigest;
    }
    copiedScreens.push(screen);
  }

  const now = Date.now();
  const replay: CorpusSession = {
    ...created,
    screens: copiedScreens,
    transitions: source.transitions
      .filter((transition) => transition.locale === mapLocale)
      .map((transition) => ({ ...transition })),
    mapPlan: JSON.parse(JSON.stringify(source.mapPlan)) as CorpusMapPlan,
    currentScreenId: source.currentScreenId,
    currentLocale: mapLocale,
    progress: {
      phase: "idle",
      screensCaptured: copiedScreens.length,
      transitionsCaptured: source.transitions.filter((transition) => transition.locale === mapLocale)
        .length,
      completedLocales: [mapLocale],
      message: `Reusing ${mapLocale} baseline (${copiedScreens.length} checkpoints)`,
      updatedAt: now,
    },
    updatedAt: now,
  };
  await writeSession(replay);
  emitCorpus(replay, true);
  return replay;
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
      if (session) {
        // A persisted running row without an in-process worker is an interrupted
        // crawl, usually after Relay restarted. Present it as resumable instead
        // of leaving the desktop stuck on a fictional live run.
        if (session.status === "running" && !activeCorpusCrawls.has(session.id)) {
          sessions.push({
            ...session,
            status: "paused",
            progress: {
              ...session.progress,
              phase: "idle",
              message: "Interrupted — ready to resume",
            },
          });
        } else {
          sessions.push(session);
        }
      }
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
  stopped: ["running"],
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
  accessibility?: unknown;
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
    screen.snapshotDigest = createHash("sha256")
      .update(await readFile(destination))
      .digest("hex");
  }
  if (input.accessibility !== undefined) {
    await mkdir(join(sessionDir(session.id), "screens"), { recursive: true });
    const destination = screenAccessibilityAssetPath(session.id, screen.id);
    const serialized = `${JSON.stringify(input.accessibility, null, 2)}\n`;
    await writeFile(destination, serialized, "utf8");
    screen.accessibilityPath = `screens/${screen.id}.accessibility.json`;
    screen.accessibilityDigest = createHash("sha256").update(serialized).digest("hex");
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

export async function readCorpusScreenAccessibilityAsset(
  sessionId: string,
  screenId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(screenAccessibilityAssetPath(sessionId, screenId));
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

function normalizedCorpusLabel(value: string | undefined): string {
  return (value ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

function meaningfulCorpusLabel(value: string | undefined): boolean {
  const label = (value ?? "").trim();
  if (label.length < 4 || !/\p{L}/u.test(label)) return false;
  if (/^(?:https?:\/\/|www\.|[\d\W_]+$)/iu.test(label)) return false;
  return true;
}

function localeFamily(locale: string): string {
  return locale.trim().toLocaleLowerCase().split(/[-_]/u)[0] ?? locale;
}

function corpusFindingId(parts: string[]): string {
  return digest(`relay-corpus-finding:v1:${parts.join("\u0000")}`).slice(0, 20);
}

/** Explainable checks over locale-stable screen and control evidence. No model
 * call is required, and possible linguistic defects remain explicitly
 * qualified so the report does not overstate certainty. */
export function analyzeCorpus(session: CorpusSession): CorpusAnalysisReport {
  const baselineLocale = session.scope.mapLocale ?? session.scope.locales[0]!;
  const groups = new Map<string, CorpusScreen[]>();
  for (const screen of session.screens) {
    const group = groups.get(screen.canonicalKey) ?? [];
    group.push(screen);
    groups.set(screen.canonicalKey, group);
  }
  const findings: CorpusFinding[] = [];
  const add = (finding: Omit<CorpusFinding, "id">): void => {
    findings.push({
      ...finding,
      id: corpusFindingId([
        finding.code,
        finding.canonicalKey,
        finding.locale,
        finding.stableKey ?? "",
      ]),
    });
  };

  for (const [canonicalKey, group] of groups) {
    const baseline = group.find((screen) => screen.locale === baselineLocale);
    const screenLabel =
      baseline?.title ??
      baseline?.path.at(-1) ??
      group.find((screen) => screen.title)?.title ??
      group[0]?.path.at(-1) ??
      canonicalKey.slice(0, 12);

    for (const locale of session.scope.locales) {
      const current = group.find((screen) => screen.locale === locale);
      if (!current) {
        add({
          code: "SCREEN_MISSING",
          severity: "critical",
          confidence: "high",
          canonicalKey,
          screenLabel,
          locale,
          baselineLocale,
          detail: `${screenLabel} was not captured in ${locale}.`,
        });
        continue;
      }
      if (
        !baseline ||
        locale === baselineLocale ||
        localeFamily(locale) === localeFamily(baselineLocale)
      ) {
        continue;
      }

      const baselineLabels = baseline.localizedLabels ?? {};
      const currentLabels = current.localizedLabels ?? {};
      const stableBaselineLabels = Object.entries(baselineLabels).filter(
        ([key, label]) => !key.startsWith("label:") && meaningfulCorpusLabel(label),
      );
      const commonLabels = stableBaselineLabels.filter(([key]) => key in currentLabels);
      const unchangedLabels = commonLabels.filter(
        ([key, label]) =>
          normalizedCorpusLabel(currentLabels[key]) === normalizedCorpusLabel(label),
      );

      const sameScreenshot =
        Boolean(baseline.snapshotDigest) && baseline.snapshotDigest === current.snapshotDigest;
      if (
        (sameScreenshot || baseline.fingerprint === current.fingerprint) &&
        stableBaselineLabels.length > 0 &&
        commonLabels.length > 0 &&
        unchangedLabels.length === commonLabels.length
      ) {
        add({
          code: "POSSIBLE_LOCALE_NOT_APPLIED",
          severity: "critical",
          confidence: sameScreenshot ? "high" : "medium",
          canonicalKey,
          screenLabel,
          locale,
          baselineLocale,
          detail: sameScreenshot
            ? `${screenLabel} has the exact same screenshot and labels in ${baselineLocale} and ${locale}; the language may not have changed.`
            : `${screenLabel} has the same semantic content in ${baselineLocale} and ${locale}; the language may not have changed.`,
        });
        continue;
      }

      for (const [stableKey, expected] of stableBaselineLabels) {
        const observed = currentLabels[stableKey];
        if (observed === undefined) {
          add({
            code: "CONTROL_MISSING",
            severity: "warning",
            confidence: "medium",
            canonicalKey,
            screenLabel,
            locale,
            baselineLocale,
            stableKey,
            expected,
            detail: `${expected} is present in ${baselineLocale} but missing from ${locale}.`,
          });
          continue;
        }
        if (normalizedCorpusLabel(observed) === normalizedCorpusLabel(expected)) {
          add({
            code: "POSSIBLE_UNTRANSLATED_TEXT",
            severity: "warning",
            confidence: "medium",
            canonicalKey,
            screenLabel,
            locale,
            baselineLocale,
            stableKey,
            expected,
            observed,
            detail: `“${observed}” is unchanged from ${baselineLocale} on ${screenLabel}.`,
          });
        }
      }
    }
  }

  const severityOrder = { critical: 0, warning: 1 } as const;
  findings.sort(
    (left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity] ||
      left.screenLabel.localeCompare(right.screenLabel) ||
      left.locale.localeCompare(right.locale) ||
      left.code.localeCompare(right.code),
  );
  return {
    schemaVersion: 1,
    sessionId: session.id,
    generatedAt: Date.now(),
    baselineLocale,
    findings,
    critical: findings.filter((finding) => finding.severity === "critical").length,
    warnings: findings.filter((finding) => finding.severity === "warning").length,
    affectedScreens: new Set(findings.map((finding) => finding.canonicalKey)).size,
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
  const analysis = analyzeCorpus(session);
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
    const screenshotDigest =
      screen.snapshotDigest ??
      createHash("sha256")
        .update(await readFile(absolute))
        .digest("hex");
    const accessibilityRelative = screen.accessibilityPath
      ? relative.replace(/\.png$/i, ".accessibility.json")
      : undefined;
    let accessibilityDigest: string | undefined;
    if (accessibilityRelative) {
      const accessibilityAbsolute = join(rootDir, accessibilityRelative);
      await mkdir(join(accessibilityAbsolute, ".."), { recursive: true });
      await copyFile(screenAccessibilityAssetPath(session.id, screen.id), accessibilityAbsolute);
      accessibilityDigest =
        screen.accessibilityDigest ??
        createHash("sha256")
          .update(await readFile(accessibilityAbsolute))
          .digest("hex");
    }
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
      sha256: screenshotDigest,
      ...(accessibilityRelative
        ? {
            accessibilityFile: accessibilityRelative,
            accessibilitySha256: accessibilityDigest!,
          }
        : {}),
    });
    const bucket = byCanonicalKey[screen.canonicalKey] ?? {};
    bucket[screen.locale] = relative;
    byCanonicalKey[screen.canonicalKey] = bucket;
  }

  const manifest: CorpusPackManifest = {
    schemaVersion: 2,
    sessionId: session.id,
    name: session.name,
    generatedAt: Date.now(),
    locales: [...session.scope.locales],
    rootDir: `pack`,
    execution: {
      ...(session.projectId ? { projectId: session.projectId } : {}),
      ...(session.organizationId ? { organizationId: session.organizationId } : {}),
      status: session.status,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      targetId: session.targetId,
      ...(session.targetProfile ? { targetProfile: { ...session.targetProfile } } : {}),
      strategy: session.scope.strategy,
      mapLocale: session.scope.mapLocale ?? session.scope.locales[0]!,
      ...(session.scope.app ? { app: session.scope.app } : {}),
      completedLocales: [...(session.progress.completedLocales ?? [])],
      ...(session.mapPlan ? { mapPlan: session.mapPlan } : {}),
    },
    screens,
    byCanonicalKey,
    analysis,
  };
  await writeFile(join(rootDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await writeFile(join(rootDir, "analysis.json"), `${JSON.stringify(analysis, null, 2)}\n`, "utf8");
  await writeFile(
    join(rootDir, "README.md"),
    [
      `# ${session.name}`,
      "",
      `Locales: ${session.scope.locales.join(", ")}`,
      `Screens: ${screens.length}`,
      `Target: ${session.targetProfile?.name ?? session.targetId}`,
      `Strategy: ${session.scope.strategy} · baseline ${session.scope.mapLocale ?? session.scope.locales[0]}`,
      "",
      "Each PNG path is `<locale>/<path>__<canonicalKey>.png`; its normalized accessibility snapshot uses the same path with `.accessibility.json`.",
      "`manifest.json` freezes execution provenance, SHA-256 digests, and groups the same logical screen across languages under `byCanonicalKey`.",
      `Findings: ${analysis.critical} critical · ${analysis.warnings} warnings across ${analysis.affectedScreens} screens.`,
      "`analysis.json` contains deterministic missing-screen, missing-control, unchanged-locale, and possible-untranslated-text findings.",
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
  const analysis = analyzeCorpus(session);
  const lines = [
    `# ${session.name}`,
    "",
    `- Status: ${session.status}`,
    `- Target: ${session.targetProfile?.name ?? session.targetId}`,
    `- Locales: ${session.scope.locales.join(", ")}`,
    `- Screens: ${session.screens.length}`,
    `- Transitions: ${session.transitions.length}`,
    `- Coverage: ${coverage.complete} complete · ${coverage.partial} partial`,
    `- Findings: ${analysis.critical} critical · ${analysis.warnings} warnings`,
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
  if (analysis.findings.length) {
    lines.push("", "## Findings");
    for (const finding of analysis.findings) {
      lines.push(`- **${finding.severity}** · ${finding.locale} · ${finding.detail}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

async function runNavSteps(
  device: Device,
  steps: CorpusNavStep[] | undefined,
  app: string | undefined,
  options?: { allowSensitive?: boolean; includeToggles?: boolean },
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
      else await scrollUp(device, step.amount ?? 1);
      await sleep(350, device);
      continue;
    }
    // Identifier-only chrome (tabs/sidebar/gear) is soft: already on Settings
    // must not abort the whole crawl when Ask/sidebar is not on screen.
    const softIdentifier =
      Boolean(step.target.identifier) && !step.target.label && !step.target.text;
    try {
      if (step.target.stableKey) {
        const context = currentTargetContext();
        if (context.kind !== "device") throw new Error("stable corpus controls require a device");
        await interactCorpusControl({
          device,
          serial: context.serial,
          control: {
            id: step.target.stableKey,
            stableKey: step.target.stableKey,
            label: step.target.label ?? step.target.text ?? step.target.stableKey,
            target: {
              ...(step.target.identifier ? { identifier: step.target.identifier } : {}),
              ...(step.target.label ? { label: step.target.label } : {}),
              ...(step.target.text ? { text: step.target.text } : {}),
              ...(step.target.point ? { point: step.target.point } : {}),
            },
          },
          allowSensitive: options?.allowSensitive === true,
          includeToggles: options?.includeToggles === true,
        });
      } else if (step.target.identifier) {
        await pressIdentifier(device, step.target.identifier);
      } else if (step.target.text) {
        await pressMatchingText(device, step.target.text);
      } else if (step.target.label) {
        try {
          await pressLabel(device, step.target.label);
        } catch {
          await pressMatchingText(device, step.target.label);
        }
      } else if (step.target.point) {
        await interact(
          { kind: "point", x: step.target.point.x, y: step.target.point.y },
          undefined,
        );
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

/**
 * Resolve a recorded structural control against the live viewport. Long lists
 * expose only visible rows, so seek one viewport at a time and stop as soon as
 * the requested control appears. The returned target is fresh (refs expire and
 * labels may be localized); callers never tap the stale discovery target.
 */
async function interactCorpusControl(input: {
  device: Device;
  serial: string;
  control: CorpusControl;
  allowSensitive: boolean;
  includeToggles?: boolean;
  maxScrolls?: number;
}): Promise<CorpusControl> {
  const maxScrolls = Math.max(0, Math.min(8, input.maxScrolls ?? 6));
  for (let scroll = 0; scroll <= maxScrolls; scroll += 1) {
    const snapshot = await captureSnapshot({ serial: input.serial });
    const visible = corpusControls(snapshot.nodes, {
      allowSensitive: input.allowSensitive,
      includeToggles: input.includeToggles,
    });
    const live = visible.find((candidate) => candidate.stableKey === input.control.stableKey);
    if (live) {
      await interact(controlToInteract(live), { serial: input.serial });
      return live;
    }
    if (scroll === maxScrolls) break;
    await scrollDown(input.device, 0.55);
    await sleep(300, input.device);
  }
  throw new Error(`Control “${input.control.label}” was not found after ${maxScrolls} scrolls`);
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
      accessibility: snap,
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
    let liveControl = control;
    try {
      liveControl = await interactCorpusControl({
        device,
        serial,
        control,
        allowSensitive: Boolean(session.scope.allowSensitiveControls),
      });
      await sleep(550, device);
    } catch (error) {
      await updateProgress(session, {
        phase: input.recordPlan ? "mapping" : "crawling",
        locale,
        message: `Skipped “${control.label}”: ${error instanceof Error ? error.message : String(error)}`,
      });
      continue;
    }

    const nextPath = [...frame.path, liveControl.label];
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
      label: liveControl.label,
      stableKey: liveControl.stableKey,
      target: liveControl.target,
      depth: frame.depth,
      changedScreen: after.screen.id !== beforeId,
    });
    session = (await readCorpusSession(session.id))!;

    if (input.recordPlan && after.screen.id !== beforeId) {
      input.recordPlan.push({
        kind: "open",
        stableKey: liveControl.stableKey,
        label: liveControl.label,
        target: liveControl.target,
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
    let liveControl = control;
    try {
      liveControl = await interactCorpusControl({
        device,
        serial,
        control,
        allowSensitive: Boolean(session.scope.allowSensitiveControls),
      });
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
      label: liveControl.label,
      stableKey: liveControl.stableKey,
      target: liveControl.target,
      depth: action.depth,
      changedScreen: after.screen.id !== beforeId,
    });
    session = (await readCorpusSession(session.id))!;
    currentScreenId = after.screen.id;
  }

  return (await readCorpusSession(session.id))!;
}

/**
 * Replay deliberately recorded stateful flows after the navigable page map.
 *
 * A journey starts from the same app + entry path for every locale. Capture
 * checkpoints are first-class evidence identities, so a dialog or toggled
 * state remains distinct even when it shares its parent's title or bounds.
 * Cleanup steps after the last checkpoint still run before the next journey.
 */
async function replayCorpusJourneys(input: {
  session: CorpusSession;
  locale: string;
  serial: string;
  device: Device;
}): Promise<CorpusSession> {
  const journeys = input.session.scope.journeys ?? [];
  if (!journeys.length) return input.session;

  let session = input.session;
  const app = session.scope.app;

  for (const journey of journeys) {
    if (isCancelled(session.id)) throw new Error("corpus cancelled");
    if (Date.now() - session.createdAt > session.scope.maxDurationMs) {
      throw new Error("corpus time budget is exhausted");
    }

    await updateProgress(session, {
      phase: "replaying",
      locale: input.locale,
      path: [journey.name],
      message: `Replaying “${journey.name}”`,
    });

    if (app) {
      await openApp(input.device, app, { relaunch: true });
      await sleep(700, input.device);
    }
    await runNavSteps(input.device, session.scope.entryPath, app);

    let checkpoint = 0;
    for (const step of journey.steps) {
      if (isCancelled(session.id)) throw new Error("corpus cancelled");
      if (step.kind !== "capture") {
        await runNavSteps(input.device, [step], app, {
          // Journeys are explicit user-authored flows. They may intentionally
          // open transactional dialogs or exercise a reversible toggle.
          allowSensitive: true,
          includeToggles: true,
        });
        continue;
      }

      checkpoint += 1;
      await updateProgress(session, {
        phase: "replaying",
        locale: input.locale,
        depth: checkpoint,
        path: [journey.name, step.name],
        message: `Capture “${step.name}”`,
      });
      const captured = await captureCurrent({
        sessionId: session.id,
        serial: input.serial,
        locale: input.locale,
        depth: checkpoint,
        path: [journey.name, step.name],
        pathKeys: [
          `journey:${journey.id}`,
          `checkpoint:${step.key ?? slugCorpusPathSegment(step.name)}`,
        ],
      });
      session = captured.session;
    }
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
  const target = currentTargetContext();
  if (target.kind === "device" && target.platform === "android" && app) {
    await setAndroidAppLocale(app, locale);
    await openApp(device, app, { relaunch: true });
    await sleep(700, device);
    if (session.scope.entryPath?.length) {
      await runNavSteps(device, session.scope.entryPath, app);
    }
    return;
  }
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
        let plan =
          session.mapPlan?.mappedLocale === mapLocale && session.mapPlan.actions.length > 0
            ? session.mapPlan
            : undefined;
        if (plan) {
          await updateProgress(session, {
            phase: "replaying",
            locale: mapLocale,
            message: "Reusing saved screen map",
          });
        } else {
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
          plan = {
            mappedLocale: mapLocale,
            ...(rootScreen ? { rootCanonicalKey: rootScreen.canonicalKey } : {}),
            actions,
            mappedAt: Date.now(),
          };
          session.mapPlan = plan;
          session.updatedAt = Date.now();
          await writeSession(session);
          emitCorpus(session);
        }
        session = await replayCorpusJourneys({
          session,
          locale: mapLocale,
          serial,
          device,
        });
        session = await markCorpusLocaleComplete(session, mapLocale);

        for (const locale of otherLocales) {
          if (isCancelled(sessionId)) throw new Error("corpus cancelled");
          session = (await readCorpusSession(sessionId))!;
          if (corpusLocaleIsComplete(session, locale)) continue;
          await switchToLocale({ session, locale, device, app });
          session = (await readCorpusSession(sessionId))!;
          session = await replayLocalePlan({
            session,
            locale,
            serial,
            device,
            plan,
          });
          session = await replayCorpusJourneys({ session, locale, serial, device });
          session = await markCorpusLocaleComplete(session, locale);
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
          session = await replayCorpusJourneys({ session, locale, serial, device });
          session = await markCorpusLocaleComplete(session, locale);
        }
      }

      if (platform === "android" && app && otherLocales.length > 0) {
        await updateProgress(session, {
          phase: "switching-language",
          locale: mapLocale,
          message: `Restoring language to ${mapLocale}`,
        });
        await setAndroidAppLocale(app, mapLocale);
        await openApp(device, app, { relaunch: true });
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
        completedLocales: [...session.scope.locales],
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
      if (platform === "android" && session.scope.app && session.scope.mapLocale) {
        try {
          await setAndroidAppLocale(session.scope.app, session.scope.mapLocale);
          await openApp(device, session.scope.app, { relaunch: true });
        } catch {
          // Preserve the original crawl error; locale restoration is best effort.
        }
      }
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
  if (session.status === "running" && activeCorpusCrawls.has(id)) return session;
  const interrupted = session.status === "running" && !activeCorpusCrawls.has(id);
  if (!interrupted && !STATUS_TRANSITIONS[session.status].includes("running")) {
    throw new Error(`cannot start corpus from ${session.status}`);
  }
  if (activeCorpusCrawls.has(id)) throw new Error("corpus crawl is already active");

  activeCorpusCrawls.set(id, { cancel: false });
  session.status = "running";
  session.error = undefined;
  const completedLocales = session.mapPlan
    ? session.scope.locales.filter((locale) => corpusLocaleIsComplete(session, locale))
    : [];
  session.progress = {
    phase: "opening",
    screensCaptured: session.screens.length,
    transitionsCaptured: session.transitions.length,
    completedLocales,
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

async function markCorpusLocaleComplete(
  session: CorpusSession,
  locale: string,
): Promise<CorpusSession> {
  const completed = new Set(session.progress.completedLocales ?? []);
  completed.add(locale);
  return await updateProgress(session, {
    locale,
    completedLocales: session.scope.locales.filter((value) => completed.has(value)),
    message: `Captured ${locale}`,
  });
}

function corpusLocaleIsComplete(session: CorpusSession, locale: string): boolean {
  const mapLocale = session.scope.mapLocale ?? session.scope.locales[0];
  const expected = new Set(
    session.screens
      .filter((screen) => screen.locale === mapLocale)
      .map((screen) => screen.canonicalKey),
  );
  if (expected.size === 0) return false;
  const observed = new Set(
    session.screens
      .filter((screen) => screen.locale === locale)
      .map((screen) => screen.canonicalKey),
  );
  return [...expected].every((canonicalKey) => observed.has(canonicalKey));
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
