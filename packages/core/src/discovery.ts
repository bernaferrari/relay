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
  DiscoverySession,
  DiscoveryStatus,
  ObservedScreen,
  ObservedTransition,
  TargetProfile,
} from "@relay/protocol";
import type { SnapshotNode } from "./device.js";
import { readRecipe, saveRecipe, type Recipe, type RecipeStep } from "./recipes.js";
import { findWorkspaceRoot } from "./workspace-root.js";
import { observeScreenIdentity } from "./screen-identity.js";

const DEFAULT_SCOPE: DiscoveryScope = {
  maxScreens: 50,
  maxTransitions: 100,
  maxDurationMs: 15 * 60_000,
  allowSensitiveControls: false,
};

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
  const buildId = optionalText(input.buildId, "discovery build id", 240);
  const caseStackId = optionalText(input.caseStackId, "discovery case stack id", 240);
  return {
    workerId: requiredText(input.workerId, "discovery worker id", 160),
    appMapId: requiredText(input.appMapId, "discovery App Map id", 160),
    goal: requiredText(input.goal, "discovery goal", 4_000),
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
  if (!/^screen-[A-Za-z0-9-]+$/.test(screenId)) throw new Error("invalid discovery screen id");
  return join(discoveryRoot(), sessionId, "screens", `${screenId}.png`);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeScope(scope?: Partial<DiscoveryScope>): DiscoveryScope {
  const bounded = (value: number | undefined, fallback: number, max: number) => {
    const next = value ?? fallback;
    if (!Number.isInteger(next) || next < 1 || next > max)
      throw new Error("invalid discovery scope");
    return next;
  };
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

/** Stable screen identity from visible semantics; screenshots remain evidence, not source of truth. */
export function fingerprintDiscoveryScreen(
  nodes: SnapshotNode[],
  _screenshotDigest?: string,
): string {
  return observeScreenIdentity(nodes).fingerprint;
}

function unsafeControlText(value: string): boolean {
  return /(delete|remove|purchase|pay|subscribe|logout|sign out|password|permission)/i.test(value);
}

/** Safe, semantic candidates for assisted exploration. These are suggestions, never commands. */
export function discoveryControls(nodes: SnapshotNode[]): DiscoveryControl[] {
  const seen = new Set<string>();
  return nodes
    .filter(
      (node) =>
        node.visibleToUser !== false && node.enabled !== false && (node.hittable || node.ref),
    )
    .flatMap((node, index) => {
      const label = (node.label ?? node.value ?? node.identifier ?? "").trim();
      if (!label || unsafeControlText(label)) return [];
      const target = node.ref
        ? { ref: node.ref }
        : node.label
          ? { label: node.label }
          : node.identifier
            ? { text: node.identifier }
            : undefined;
      if (!target) return [];
      const key = JSON.stringify(target);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        { id: `${index}-${digest(key).slice(0, 8)}`, label, role: node.role ?? node.type, target },
      ];
    })
    .slice(0, 40);
}

export async function createDiscoverySession(input: {
  id?: string;
  name: string;
  targetId: string;
  targetProfile?: TargetProfile;
  scope?: Partial<DiscoveryScope>;
  agent?: Omit<DiscoveryAgentContext, "createdBy">;
}): Promise<DiscoverySession> {
  const name = requiredText(input.name, "discovery session name", 160);
  const targetId = requiredText(input.targetId, "discovery target", 240);
  const agent = input.agent ? normalizeAgentContext(input.agent) : undefined;
  const operation = currentOperationContext();
  const at = Date.now();
  const session: DiscoverySession = {
    id: input.id ?? `discovery-${randomUUID()}`,
    name,
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

export async function readDiscoverySession(id: string): Promise<DiscoverySession | null> {
  try {
    return JSON.parse(await readFile(sessionPath(id), "utf8")) as DiscoverySession;
  } catch {
    return null;
  }
}

/** Rename a saved map without changing its captured evidence or run state. */
export async function renameDiscoverySession(id: string, name: string): Promise<DiscoverySession> {
  const session = await readDiscoverySession(id);
  if (!session) throw new Error("Discovery map not found");
  const nextName = name.trim();
  if (!nextName) throw new Error("Map name is required");
  if (nextName.length > 120) throw new Error("Map name is too long");
  const renamed = { ...session, name: nextName, updatedAt: Date.now() };
  await writeSession(renamed);
  emitDiscovery(renamed);
  return renamed;
}

export async function listDiscoverySessions(): Promise<DiscoverySession[]> {
  try {
    const files = (await readdir(discoveryRoot())).filter((file) => file.endsWith(".json"));
    const sessions = await Promise.all(
      files.map((file) => readDiscoverySession(file.slice(0, -5))),
    );
    return sessions
      .filter((session): session is DiscoverySession => Boolean(session))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

export async function setDiscoveryStatus(
  id: string,
  status: DiscoveryStatus,
): Promise<DiscoverySession> {
  const session = await readDiscoverySession(id);
  if (!session) throw new Error("discovery session not found");
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
  const session = await readDiscoverySession(input.sessionId);
  if (!session) throw new Error("discovery session not found");
  assertMutable(session);
  const fingerprint = fingerprintDiscoveryScreen(input.nodes, input.screenshotDigest);
  const existing = session.screens.find((screen) => screen.fingerprint === fingerprint);
  if (existing) {
    if (input.makeCurrent && session.currentScreenId !== existing.id) {
      session.currentScreenId = existing.id;
      session.updatedAt = Date.now();
      await writeSession(session);
      emitDiscovery(session);
    }
    return { session, screen: existing, isNew: false };
  }
  if (session.screens.length >= session.scope.maxScreens)
    throw new Error("discovery screen budget is exhausted");
  const screen: ObservedScreen = {
    id: `screen-${randomUUID()}`,
    fingerprint,
    identity: { schemaVersion: 1, fingerprint },
    ...(input.title?.trim() ? { title: input.title.trim() } : {}),
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
}

export function suggestDiscoveryControl(session: DiscoverySession): {
  screenId: string;
  control: DiscoveryControl;
} | null {
  const used = new Set(
    session.transitions
      .filter((transition) => transition.target)
      .map((transition) => `${transition.fromScreenId}:${JSON.stringify(transition.target)}`),
  );
  const currentScreen = session.currentScreenId
    ? session.screens.find((screen) => screen.id === session.currentScreenId)
    : undefined;
  // Once the session knows what is visible, never suggest a control from a
  // different screen. Legacy maps without currentScreenId retain the old
  // best-effort ordering until the next capture records one.
  const orderedScreens = currentScreen ? [currentScreen] : session.screens;
  for (const screen of orderedScreens) {
    const control = screen.controls?.find(
      (item) => !used.has(`${screen.id}:${JSON.stringify(item.target)}`),
    );
    if (control) return { screenId: screen.id, control };
  }
  return null;
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
  const session = await readDiscoverySession(input.sessionId);
  if (!session) throw new Error("discovery session not found");
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

function pathSteps(transitions: ObservedTransition[]): { steps: RecipeStep[]; warnings: string[] } {
  const steps: RecipeStep[] = [];
  const warnings: string[] = [];
  for (const transition of transitions) {
    if (transition.kind === "tap" && transition.target) {
      steps.push({ kind: "tap", target: transition.target, note: transition.label });
    } else if (transition.kind === "scroll") {
      steps.push({
        kind: "scroll",
        direction: transition.direction ?? "down",
        note: transition.label,
      });
    } else if (transition.kind === "back") {
      steps.push({ kind: "key", key: "back", note: transition.label });
    } else if (transition.kind === "type" && transition.text) {
      steps.push({
        kind: "type",
        text: transition.text,
        target: transition.target,
        note: transition.label,
      });
    } else {
      warnings.push(
        `Transition ${transition.id} needs review because it has no replayable ${transition.kind} detail.`,
      );
      steps.push({
        kind: "pause",
        message: transition.label ?? "Review this discovered interaction",
      });
    }
  }
  return { steps, warnings };
}

/** A discovered path never mutates an existing test; it becomes a new editable YAML definition. */
export async function promoteDiscoveryPath(input: {
  sessionId: string;
  transitionIds: string[];
  recipeId: string;
  title: string;
  description?: string;
  /** Presentation-only review labels compiled into the new test; raw observations stay immutable. */
  transitionLabels?: Record<string, string>;
}): Promise<{ recipe: Recipe; warnings: string[] }> {
  const session = await readDiscoverySession(input.sessionId);
  if (!session) throw new Error("discovery session not found");
  if (!input.title.trim()) throw new Error("test title is required");
  if (await readRecipe(input.recipeId)) throw new Error("test id already exists; choose a new id");
  const selected = input.transitionIds.map((id) => {
    const transition = session.transitions.find((item) => item.id === id);
    if (!transition) throw new Error(`discovery transition not found: ${id}`);
    return transition;
  });
  if (selected.length === 0) throw new Error("select at least one discovery transition");
  for (let index = 1; index < selected.length; index += 1) {
    const previous = selected[index - 1]!;
    const current = selected[index]!;
    if (previous.toScreenId && previous.toScreenId !== current.fromScreenId) {
      throw new Error("selected transitions must form one continuous path");
    }
  }
  const reviewed = selected.map((transition) => ({
    ...transition,
    label: input.transitionLabels?.[transition.id]?.trim() || transition.label,
  }));
  const compiled = pathSteps(reviewed);
  const recipe = await saveRecipe({
    id: input.recipeId,
    expectedRevision: (await readRecipe(input.recipeId))?.updatedAt ?? 0,
    title: input.title,
    description: input.description ?? `Observed path from Discovery Map · ${session.name}`,
    steps: compiled.steps,
  });
  return { recipe, warnings: compiled.warnings };
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
