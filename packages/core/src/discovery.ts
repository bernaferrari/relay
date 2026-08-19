import { createHash, randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { publish } from "./events.js";
import { currentOperationContext } from "./operation-context.js";
import type {
  DiscoveryAgentContext,
  DiscoveryDecisionProvenance,
  DiscoveryScope,
  DiscoveryControl,
  DiscoveryExploreRun,
  DiscoverySession,
  DiscoveryStatus,
  ObservedScreen,
  ObservedTransition,
  TargetProfile,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import {
  isExploreChromeLabel,
  isExploreChromeNode,
  isExploreStateChangingNode,
  isUnsafeExploreControlText,
} from "./explore.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { observeLocaleStableIdentity, observeScreenIdentity } from "./screen-identity.js";
import { grokHeaderAffordances } from "./discovery-semantic-tap.js";
import { serializeSessionWrite } from "./discovery-session-writes.js";
import { settingsScreenTitlesConflict } from "./app-map/settings-screen-titles.js";

const DEFAULT_SCOPE: DiscoveryScope = {
  maxScreens: 50,
  maxTransitions: 100,
  maxDurationMs: 15 * 60_000,
  allowSensitiveControls: false,
};

const EXPLORE_STRATEGIES = new Set(["surface", "journey", "hard-edges"]);
const EXPLORE_MODES = new Set(["semantic", "model"]);

function requiredText(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long`);
  return normalized;
}

function optionalText(value: unknown, label: string, maxLength: number): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, label, maxLength);
}

function normalizeAgentContext(
  input: Omit<DiscoveryAgentContext, "createdBy">,
): Omit<DiscoveryAgentContext, "createdBy"> {
  if (!["ui", "cli", "mcp", "api"].includes(input.source)) {
    throw new Error("discovery agent source is invalid");
  }
  const model = optionalText(input.model, "discovery agent model", 240);
  const focus = optionalText(input.focus, "discovery agent focus", 240);
  const buildId = optionalText(input.buildId, "discovery build id", 240);
  const caseStackId = optionalText(input.caseStackId, "discovery case stack id", 240);
  return {
    workerId: requiredText(input.workerId, "discovery worker id", 160),
    appMapId: requiredText(input.appMapId, "discovery App Map id", 160),
    goal: requiredText(input.goal, "discovery goal", 4_000),
    ...(focus ? { focus } : {}),
    provider: requiredText(input.provider, "discovery agent provider", 160),
    ...(model ? { model } : {}),
    ...(buildId ? { buildId } : {}),
    ...(caseStackId ? { caseStackId } : {}),
    source: input.source,
  };
}

function normalizeDecision(input: DiscoveryDecisionProvenance): DiscoveryDecisionProvenance {
  if (input.mode !== "model" && input.mode !== "semantic") {
    throw new Error("discovery decision mode is invalid");
  }
  if (
    input.durationMs !== undefined &&
    (!Number.isFinite(input.durationMs) ||
      input.durationMs < 0 ||
      input.durationMs > 8 * 60 * 60_000)
  ) {
    throw new Error("discovery decision duration is invalid");
  }
  if (input.promptDigest !== undefined && !/^[a-f\d]{64}$/i.test(input.promptDigest)) {
    throw new Error("discovery decision prompt digest is invalid");
  }
  const requestId = optionalText(input.requestId, "discovery request id", 240);
  return {
    mode: input.mode,
    provider: requiredText(input.provider, "discovery decision provider", 160),
    model: requiredText(input.model, "discovery decision model", 240),
    selectedControlId: requiredText(input.selectedControlId, "discovery selected control id", 240),
    ...(requestId ? { requestId } : {}),
    ...(input.promptDigest ? { promptDigest: input.promptDigest.toLowerCase() } : {}),
    ...(input.durationMs !== undefined ? { durationMs: input.durationMs } : {}),
  };
}

function emitDiscovery(session: DiscoverySession, created = false): void {
  publish({
    type: created ? "resource.created" : "resource.updated",
    at: session.updatedAt,
    projectId: currentOperationContext()?.projectId ?? "default",
    resource: "discovery-session",
    resourceId: session.id,
    revision: session.updatedAt,
  });
}

function discoveryRoot(): string {
  return join(
    process.env.RELAY_WORKSPACE_ROOT?.trim() || findWorkspaceRoot(),
    ".relay",
    "discovery",
  );
}

function sessionPath(id: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(id)) throw new Error("invalid discovery session id");
  return join(discoveryRoot(), `${id}.json`);
}

function screenAssetPath(sessionId: string, screenId: string): string {
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,95}$/.test(sessionId)) {
    throw new Error("invalid discovery session id");
  }
  if (!/^screen-[A-Za-z0-9-]+$/.test(screenId)) throw new Error("invalid discovery screen id");
  return join(discoveryRoot(), sessionId, "screens", `${screenId}.png`);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Identity of a discovery control is its target, nothing else.
 *
 * The opened-flag key is `${screenId}:${JSON.stringify(target)}`, so anything
 * positional here (a snapshot array index, say) makes the same row report a
 * different id on the next snapshot and the explore loop re-opens it forever.
 */
export function discoveryControlId(target: DiscoveryControl["target"]): string {
  return digest(JSON.stringify(target)).slice(0, 16);
}

function normalizeScope(scope?: Partial<DiscoveryScope>): DiscoveryScope {
  const bounded = (value: number | undefined, fallback: number, max: number) => {
    const next = value ?? fallback;
    if (!Number.isInteger(next) || next < 1 || next > max)
      throw new Error("invalid discovery scope");
    return next;
  };
  const strategy = scope?.strategy;
  if (strategy !== undefined && !EXPLORE_STRATEGIES.has(strategy)) {
    throw new Error("invalid discovery explore strategy");
  }
  const mode = scope?.mode;
  if (mode !== undefined && !EXPLORE_MODES.has(mode)) {
    throw new Error("invalid discovery explore mode");
  }
  const maxDepth = scope?.maxDepth;
  if (maxDepth !== undefined) {
    bounded(maxDepth, 2, 12);
  }
  return {
    maxScreens: bounded(scope?.maxScreens, DEFAULT_SCOPE.maxScreens, 500),
    maxTransitions: bounded(scope?.maxTransitions, DEFAULT_SCOPE.maxTransitions, 2_000),
    maxDurationMs: bounded(scope?.maxDurationMs, DEFAULT_SCOPE.maxDurationMs, 8 * 60 * 60_000),
    ...(scope?.allowedOrigins?.length
      ? {
          allowedOrigins: [
            ...new Set(scope.allowedOrigins.map((origin) => origin.trim()).filter(Boolean)),
          ],
        }
      : {}),
    allowSensitiveControls: scope?.allowSensitiveControls ?? false,
    ...(strategy ? { strategy } : {}),
    ...(mode ? { mode } : {}),
    ...(maxDepth !== undefined ? { maxDepth } : {}),
  };
}

async function writeSession(session: DiscoverySession): Promise<void> {
  await mkdir(discoveryRoot(), { recursive: true });
  const destination = sessionPath(session.id);
  const temp = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temp, `${JSON.stringify(session, null, 2)}\n`, "utf8");
  await rename(temp, destination);
}

function assertMutable(session: DiscoverySession): void {
  if (session.status !== "draft" && session.status !== "running") {
    throw new Error(`discovery session is ${session.status}`);
  }
  if (Date.now() - session.createdAt > session.scope.maxDurationMs) {
    throw new Error("discovery time budget is exhausted");
  }
}

/** Prefer locale-stable structure so the same Grok screen survives a language change. */
export function fingerprintDiscoveryScreen(
  nodes: SnapshotNode[],
  _screenshotDigest?: string,
): string {
  const localeStable = observeLocaleStableIdentity(nodes);
  // Locale-stable identity needs a substantial identifier tree; a low threshold
  // collapses distinct Settings/drawer pages that share a few chrome ids.
  if (localeStable.nodes.length >= 12) return localeStable.fingerprint;
  return observeScreenIdentity(nodes).fingerprint;
}

/** True when ≥2 Grok Settings section rows are visible (hub list, not a child page). */
export function looksLikeSettingsList(nodes: SnapshotNode[]): boolean {
  const labels = new Set(
    nodes.map((node) => node.label?.trim()).filter((label): label is string => Boolean(label)),
  );
  const rows = [...labels].filter((label) =>
    /^(Appearance|Haptics|Widget|Usage|Advanced|Voice|Memory|Connectors|Skills|Customize Grok)$/i.test(
      label,
    ),
  );
  return rows.length >= 2;
}

/** Infer a stable screen title from the live tree (Settings hub vs child pages). */
export function discoveryTitleFromNodes(nodes: SnapshotNode[]): string | undefined {
  return titleFromNodes(nodes);
}

function titleFromNodes(nodes: SnapshotNode[]): string | undefined {
  // A scrolled Settings list still shows several section rows — never title it
  // after whichever row happens to sit near the top of the viewport.
  if (looksLikeSettingsList(nodes)) return "Settings";

  // Toolbar / collapsing title first — list rows below must not steal the page name
  // (Settings list still contains an "Appearance" row after you leave Appearance).
  const bar = nodes.find(
    (node) =>
      /collapsing_appbar|action_bar$|toolbar|top_app_bar/i.test(node.identifier ?? "") &&
      Boolean(node.label?.trim()) &&
      !isExploreChromeLabel(node.label!.trim()),
  );
  if (bar?.label?.trim()) return bar.label.trim();
  const heading = nodes.find(
    (node) =>
      /header|heading/.test(`${node.role ?? ""} ${node.type ?? ""}`) && Boolean(node.label?.trim()),
  );
  if (heading?.label?.trim()) return heading.label.trim();

  const named = nodes
    .filter((node) => {
      const label = node.label?.trim();
      if (!label || label.length > 48) return false;
      if (!node.rect || node.rect.y > 520) return false;
      return /^(Settings|Appearance|Haptics|Widget|Usage|Advanced|Voice|Memory|Connectors|Skills|Projects|Automations|Pinned|Imagine|Build|Ask|Customize Grok|NSFW Preferences|Shared Conversations|Data Controls|Help & Support|Kids Mode|Data & Information|Voice Library)$/i.test(
        label,
      );
    })
    .sort((left, right) => (left.rect?.y ?? 0) - (right.rect?.y ?? 0));
  if (named[0]?.label?.trim()) return named[0].label.trim();

  // Prefer a short top-of-screen label over the generic app name.
  const topLabel = nodes.find((node) => {
    const label = node.label?.trim();
    if (!label || label.length > 40 || label.length < 2) return false;
    if (!node.rect || node.rect.y > 280) return false;
    if (isExploreChromeNode(node) || isExploreChromeLabel(label)) return false;
    if (/^(Ask|Imagine|Build|Grok|Back|Close)$/i.test(label)) return false;
    return true;
  });
  if (topLabel?.label?.trim()) return topLabel.label.trim();
  const selected = nodes.find(
    (node) =>
      node.selected === true &&
      Boolean((node.label ?? "").trim()) &&
      !isExploreChromeNode(node) &&
      (node.label ?? "").trim().length < 40,
  );
  return selected?.label?.trim() || grokScreenTitle(nodes);
}

function grokScreenTitle(nodes: SnapshotNode[]): string | undefined {
  if (nodes.some((node) => node.bundleId === "ai.x.grok" || node.bundleId === "ai.x.GrokApp")) {
    return "Grok";
  }
  return undefined;
}

function unsafeControlText(value: string): boolean {
  // Shared with tree crawl / explore — keep destructive filters consistent.
  return isUnsafeExploreControlText(value);
}

const LAYOUT_IDENTIFIER =
  /(?:recycler_view|list_container|content_frame|action_bar|coordinator|framelayout|linearlayout|scrollview|content_parent|main_content|(?:^|\/)content$)/i;
const GENERIC_IDENTIFIER = /:id\/(?:title|summary|icon|text[12])$/i;

function discoveryTarget(node: SnapshotNode): DiscoveryControl["target"] | undefined {
  const spoken = (node.label ?? node.value ?? "").trim();
  const identifier = node.identifier?.trim();
  if (identifier && !LAYOUT_IDENTIFIER.test(identifier) && !GENERIC_IDENTIFIER.test(identifier)) {
    return { identifier };
  }
  const ref = node.ref?.trim();
  if (ref && !/^e\d+$/i.test(ref)) return { ref };
  if (spoken) return { label: spoken };
  return undefined;
}

/** Safe, semantic candidates for assisted exploration. These are suggestions, never commands. */
export function discoveryControls(nodes: SnapshotNode[]): DiscoveryControl[] {
  const seen = new Set<string>();
  const controls = nodes
    .filter(
      (node) =>
        node.visibleToUser !== false &&
        node.enabled !== false &&
        !isExploreChromeNode(node) &&
        !isExploreStateChangingNode(node) &&
        (node.hittable || node.identifier || node.ref || Boolean((node.label ?? "").trim())),
    )
    .flatMap((node) => {
      let label = (node.label ?? node.value ?? "").trim();
      if (!label && node.identifier?.trim() && !LAYOUT_IDENTIFIER.test(node.identifier)) {
        label = node.identifier.split(/[:/]/).pop() ?? node.identifier;
      }
      if (!label || unsafeControlText(label)) return [];
      if (label.length > 48 || /[.?!].*\s/.test(label)) return [];
      if (/double tap to open|send_button|chat_text_input/i.test(label)) return [];
      if (/^\d{1,2}:\d{2}$/.test(label)) return [];
      if (/^(app language|preferred language)$/i.test(label)) return [];
      if (node.identifier && (node.label ?? "").trim() && label === node.identifier) return [];
      if (
        /^(first name|last name|email|password|phone|edit your name|date of birth)$/i.test(label)
      ) {
        return [];
      }
      const target = discoveryTarget(node);
      if (!target) return [];
      const key = JSON.stringify(target);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          control: {
            id: discoveryControlId(target),
            label,
            role: node.role ?? node.type,
            target,
          },
          y: node.rect?.y ?? 1_000_000,
        },
      ];
    });

  const ranked = controls
    .sort((left, right) => {
      const row = (control: DiscoveryControl) =>
        /cell|listitem|row|menuitem|preference/.test(control.role?.toLocaleLowerCase() ?? "")
          ? 0
          : 1;
      return (
        left.y - right.y ||
        row(left.control) - row(right.control) ||
        left.control.label.localeCompare(right.control.label) ||
        left.control.id.localeCompare(right.control.id)
      );
    })
    .map((item) => item.control);
  return [...grokHeaderAffordances(nodes), ...ranked].slice(0, 40);
}

function discoveryBelongsToProject(
  session: Pick<DiscoverySession, "projectId">,
  projectId: string | undefined,
): boolean {
  if (!projectId) return true;
  return (session.projectId?.trim() || "default") === projectId;
}

function assertDiscoveryAccess(session: DiscoverySession): void {
  const operation = currentOperationContext();
  if (!discoveryBelongsToProject(session, operation?.projectId)) {
    throw new Error("discovery session not found");
  }
}

export async function createDiscoverySession(input: {
  id?: string;
  name: string;
  targetId: string;
  targetProfile?: TargetProfile;
  scope?: Partial<DiscoveryScope>;
  agent?: Omit<DiscoveryAgentContext, "createdBy">;
  projectId?: string;
  organizationId?: string;
}): Promise<DiscoverySession> {
  const name = requiredText(input.name, "discovery session name", 160);
  const targetId = requiredText(input.targetId, "discovery target", 240);
  const agent = input.agent ? normalizeAgentContext(input.agent) : undefined;
  const operation = currentOperationContext();
  const at = Date.now();
  const projectId = input.projectId?.trim() || operation?.projectId?.trim() || "default";
  const organizationId =
    input.organizationId?.trim() || operation?.organizationId?.trim() || "local";
  const session: DiscoverySession = {
    id: input.id ?? `discovery-${randomUUID()}`,
    name,
    projectId,
    organizationId,
    targetId,
    ...(input.targetProfile ? { targetProfile: { ...input.targetProfile } } : {}),
    ...(agent
      ? {
          agent: {
            ...agent,
            ...(operation
              ? {
                  createdBy: {
                    actorId: operation.actorId,
                    actorKind: operation.actorKind,
                  },
                }
              : {}),
          },
        }
      : {}),
    scope: normalizeScope(input.scope),
    status: "draft",
    createdAt: at,
    updatedAt: at,
    screens: [],
    transitions: [],
  };
  await writeSession(session);
  emitDiscovery(session, true);
  return session;
}

export async function readDiscoverySession(
  id: string,
  filter?: { projectId?: string },
): Promise<DiscoverySession | null> {
  try {
    const session = JSON.parse(await readFile(sessionPath(id), "utf8")) as DiscoverySession;
    if (!discoveryBelongsToProject(session, filter?.projectId)) return null;
    return session;
  } catch {
    return null;
  }
}

/** Rename a saved map without changing its captured evidence or run state. */
export async function renameDiscoverySession(id: string, name: string): Promise<DiscoverySession> {
  return serializeSessionWrite(id, async () => {
    const session = await readDiscoverySession(id);
    if (!session) throw new Error("Discovery map not found");
    assertDiscoveryAccess(session);
    const nextName = name.trim();
    if (!nextName) throw new Error("Map name is required");
    if (nextName.length > 120) throw new Error("Map name is too long");
    const renamed = { ...session, name: nextName, updatedAt: Date.now() };
    await writeSession(renamed);
    emitDiscovery(renamed);
    return renamed;
  });
}

export async function listDiscoverySessions(filter?: {
  projectId?: string;
}): Promise<DiscoverySession[]> {
  try {
    const files = (await readdir(discoveryRoot())).filter((file) => file.endsWith(".json"));
    const sessions = await Promise.all(
      files.map((file) => readDiscoverySession(file.slice(0, -5))),
    );
    return sessions
      .filter((session): session is DiscoverySession => Boolean(session))
      .filter((session) => discoveryBelongsToProject(session, filter?.projectId))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function setDiscoveryStatus(
  id: string,
  status: DiscoveryStatus,
): Promise<DiscoverySession> {
  return serializeSessionWrite(id, async () => {
    const session = await readDiscoverySession(id);
    if (!session) throw new Error("discovery session not found");
    assertDiscoveryAccess(session);
    const allowed: Record<DiscoveryStatus, DiscoveryStatus[]> = {
      draft: ["running", "stopped"],
      running: ["paused", "complete", "stopped"],
      paused: ["running", "complete", "stopped"],
      complete: [],
      stopped: [],
    };
    if (session.status !== status && !allowed[session.status].includes(status)) {
      throw new Error(`discovery session cannot move from ${session.status} to ${status}`);
    }
    session.status = status;
    session.updatedAt = Date.now();
    await writeSession(session);
    emitDiscovery(session);
    return session;
  });
}

/** Merge explore strategy / depth onto a session before start (optional). */
export async function patchDiscoveryScope(
  id: string,
  patch: Partial<DiscoveryScope>,
): Promise<DiscoverySession> {
  return serializeSessionWrite(id, async () => {
    const session = await readDiscoverySession(id);
    if (!session) throw new Error("discovery session not found");
    assertDiscoveryAccess(session);
    if (session.status !== "draft" && session.status !== "paused" && session.status !== "running") {
      throw new Error(`cannot patch discovery scope from ${session.status}`);
    }
    session.scope = normalizeScope({ ...session.scope, ...patch });
    session.updatedAt = Date.now();
    await writeSession(session);
    emitDiscovery(session);
    return session;
  });
}

/**
 * Persist the explore crawl record so it survives a process restart.
 *
 * Deliberately tolerant of a terminal session status: the crawl that just
 * stopped is exactly the one whose stop reason has to be written down.
 */
export async function writeDiscoveryExploreRun(
  id: string,
  run: DiscoveryExploreRun,
): Promise<DiscoverySession | undefined> {
  return serializeSessionWrite(id, async () => {
    const session = await readDiscoverySession(id);
    if (!session) return undefined;
    assertDiscoveryAccess(session);
    session.explore = { ...run, updatedAt: Date.now() };
    session.updatedAt = session.explore.updatedAt;
    await writeSession(session);
    emitDiscovery(session);
    return session;
  });
}

export async function recordObservedScreen(input: {
  sessionId: string;
  nodes: SnapshotNode[];
  title?: string;
  screenshotPath?: string;
  screenshotDigest?: string;
  snapshotDigest?: string;
  makeCurrent?: boolean;
}): Promise<{ session: DiscoverySession; screen: ObservedScreen; isNew: boolean }> {
  return serializeSessionWrite(input.sessionId, async () => {
    const session = await readDiscoverySession(input.sessionId);
    if (!session) throw new Error("discovery session not found");
    assertDiscoveryAccess(session);
    assertMutable(session);
    const fingerprint = fingerprintDiscoveryScreen(input.nodes, input.screenshotDigest);
    const title = input.title?.trim() || titleFromNodes(input.nodes);
    const existing =
      session.screens.find((screen) => {
        if (screen.fingerprint !== fingerprint) return false;
        // Shared Settings chrome must not collapse Memory into Kids Mode / NSFW.
        return !settingsScreenTitlesConflict(screen.title, title);
      }) ??
      // Hub lists drift fingerprint while scrolling/animating — keep one Settings/Appearance/etc.
      (title &&
      /^(Settings|Appearance|Haptics|Widget|Usage|Advanced|Voice|Memory|Connectors|Skills|Customize Grok)$/i.test(
        title,
      )
        ? session.screens.find((screen) => screen.title?.trim() === title)
        : undefined);
    if (existing) {
      // Keep the first title once set — re-observe / scroll must not rename the hub.
      if (title && !existing.title?.trim()) existing.title = title;
      if (existing.fingerprint !== fingerprint) {
        existing.identity = {
          schemaVersion: 1,
          fingerprint: existing.fingerprint,
          aliases: [...new Set([...(existing.identity?.aliases ?? []), fingerprint])],
        };
      }
      if (input.screenshotPath) {
        const destination = screenAssetPath(session.id, existing.id);
        await mkdir(join(discoveryRoot(), session.id, "screens"), { recursive: true });
        await copyFile(input.screenshotPath, destination);
        existing.screenshotPath = `screens/${existing.id}.png`;
        existing.capturedAt = Date.now();
        session.updatedAt = existing.capturedAt;
      }
      existing.controls = discoveryControls(input.nodes);
      if (input.makeCurrent) session.currentScreenId = existing.id;
      await writeSession(session);
      emitDiscovery(session);
      return { session, screen: existing, isNew: false };
    }
    if (session.screens.length >= session.scope.maxScreens)
      throw new Error("discovery screen budget is exhausted");
    const screen: ObservedScreen = {
      id: `screen-${randomUUID()}`,
      fingerprint,
      identity: { schemaVersion: 1, fingerprint },
      ...(title ? { title } : {}),
      capturedAt: Date.now(),
      ...(input.snapshotDigest ? { snapshotDigest: input.snapshotDigest } : {}),
      controls: discoveryControls(input.nodes),
    };
    if (input.screenshotPath) {
      const destination = screenAssetPath(session.id, screen.id);
      await mkdir(join(discoveryRoot(), session.id, "screens"), { recursive: true });
      await copyFile(input.screenshotPath, destination);
      screen.screenshotPath = `screens/${screen.id}.png`;
    }
    session.screens.push(screen);
    if (input.makeCurrent) session.currentScreenId = screen.id;
    session.updatedAt = screen.capturedAt;
    await writeSession(session);
    emitDiscovery(session);
    return { session, screen, isNew: true };
  });
}

export async function replaceDiscoveryScreenControls(
  sessionId: string,
  screenId: string,
  controls: DiscoveryControl[],
): Promise<DiscoverySession> {
  return serializeSessionWrite(sessionId, async () => {
    const session = await readDiscoverySession(sessionId);
    if (!session) throw new Error("discovery session not found");
    assertDiscoveryAccess(session);
    const screen = session.screens.find((item) => item.id === screenId);
    if (!screen) throw new Error("discovery screen not found");
    screen.controls = controls;
    session.updatedAt = Date.now();
    await writeSession(session);
    emitDiscovery(session);
    return session;
  });
}

export function suggestDiscoveryControl(
  session: DiscoverySession,
  skipped: ReadonlySet<string> = new Set(),
): {
  screenId: string;
  control: DiscoveryControl;
} | null {
  const used = new Set([
    ...skipped,
    ...session.transitions
      .filter((transition) => transition.target)
      .map((transition) => `${transition.fromScreenId}:${JSON.stringify(transition.target)}`),
  ]);
  const currentScreen = session.currentScreenId
    ? session.screens.find((screen) => screen.id === session.currentScreenId)
    : undefined;
  if (!currentScreen) return null;
  const control = currentScreen.controls?.find(
    (item) => !used.has(`${currentScreen.id}:${JSON.stringify(item.target)}`),
  );
  return control ? { screenId: currentScreen.id, control } : null;
}

export function isSensitiveDiscoveryAction(
  action: Pick<ObservedTransition, "label" | "kind">,
): boolean {
  const text = action.label?.toLowerCase() ?? "";
  return (
    action.kind === "type" ||
    /(delete|remove|purchase|pay|subscribe|logout|sign out|password|permission)/.test(text)
  );
}

export async function recordObservedTransition(
  input: Omit<ObservedTransition, "id" | "capturedAt"> & { sessionId: string },
): Promise<ObservedTransition> {
  return serializeSessionWrite(input.sessionId, async () => {
    const session = await readDiscoverySession(input.sessionId);
    if (!session) throw new Error("discovery session not found");
    assertDiscoveryAccess(session);
    assertMutable(session);
    if (!session.scope.allowSensitiveControls && isSensitiveDiscoveryAction(input)) {
      throw new Error("discovery policy blocks sensitive controls");
    }
    if (!session.screens.some((screen) => screen.id === input.fromScreenId)) {
      throw new Error("transition source screen was not observed");
    }
    if (input.toScreenId && !session.screens.some((screen) => screen.id === input.toScreenId)) {
      throw new Error("transition destination screen was not observed");
    }
    if (session.transitions.length >= session.scope.maxTransitions) {
      throw new Error("discovery transition budget is exhausted");
    }
    const transition: ObservedTransition = {
      id: `transition-${randomUUID()}`,
      fromScreenId: input.fromScreenId,
      ...(input.toScreenId ? { toScreenId: input.toScreenId } : {}),
      kind: input.kind,
      ...(input.label?.trim() ? { label: input.label.trim() } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.text !== undefined ? { text: input.text } : {}),
      ...(input.direction ? { direction: input.direction } : {}),
      ...(input.decision ? { decision: normalizeDecision(input.decision) } : {}),
      capturedAt: Date.now(),
      changedScreen: input.changedScreen,
    };
    session.transitions.push(transition);
    session.currentScreenId = input.toScreenId ?? input.fromScreenId;
    session.updatedAt = transition.capturedAt;
    await writeSession(session);
    emitDiscovery(session);
    return transition;
  });
}

export async function writeDiscoveryScreenAsset(
  sessionId: string,
  screenId: string,
  png: Buffer,
): Promise<void> {
  return serializeSessionWrite(sessionId, async () => {
    const session = await readDiscoverySession(sessionId);
    if (!session) throw new Error("discovery session not found");
    const screen = session.screens.find((item) => item.id === screenId);
    if (!screen) throw new Error("discovery screen not found");
    const destination = screenAssetPath(sessionId, screenId);
    await mkdir(join(discoveryRoot(), session.id, "screens"), { recursive: true });
    await writeFile(destination, png);
    screen.screenshotPath = `screens/${screen.id}.png`;
    screen.capturedAt = Date.now();
    session.currentScreenId = screenId;
    session.updatedAt = screen.capturedAt;
    await writeSession(session);
    emitDiscovery(session);
  });
}

export async function readDiscoveryScreenAsset(
  sessionId: string,
  screenId: string,
): Promise<Buffer | null> {
  try {
    return await readFile(screenAssetPath(sessionId, screenId));
  } catch {
    return null;
  }
}

/** App Map is truth. Discovery no longer writes YAML recipes. */
export async function promoteDiscoveryPath(_input: {
  sessionId: string;
  transitionIds: string[];
  recipeId: string;
  title: string;
  description?: string;
  transitionLabels?: Record<string, string>;
}): Promise<never> {
  throw new Error(
    "Discovery promotes to the App Map. Start explore, then Keep a proposed edge. YAML recipe promote is removed.",
  );
}

export function formatDiscoveryExport(
  session: DiscoverySession,
  format: "json" | "markdown",
): string {
  if (format === "json") return `${JSON.stringify(session, null, 2)}\n`;
  const lines = [
    `# ${session.name}`,
    "",
    `- Status: ${session.status}`,
    `- Target: ${session.targetProfile?.name ?? session.targetId}`,
    `- Screens: ${session.screens.length}`,
    `- Transitions: ${session.transitions.length}`,
    "",
    "## Observed paths",
  ];
  for (const transition of session.transitions) {
    const from =
      session.screens.find((screen) => screen.id === transition.fromScreenId)?.title ??
      transition.fromScreenId;
    const to = transition.toScreenId
      ? (session.screens.find((screen) => screen.id === transition.toScreenId)?.title ??
        transition.toScreenId)
      : "same screen";
    lines.push(
      `- ${from} → ${to}: ${transition.kind}${transition.label ? ` “${transition.label}”` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
