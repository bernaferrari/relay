import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compactGoalObservation,
  createOpenRouterDecisionProvider,
  DEFAULT_OPENROUTER_DECISION_MODEL,
  findWorkspaceRoot,
  isEditableGoalControl,
  type ModelDecisionProvider,
} from "@relay/core";
import type {
  CompactGoalObservation,
  GoalObservationAction,
  GoalSessionAction,
  GoalSessionBudget,
  GoalSessionInteractionTarget,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStartInput,
  GoalSessionStopCode,
  GoalReproductionRecord,
  GoalFinding,
  ModelChoiceAnswer,
  ModelDecisionRecord,
  TargetObservation,
} from "@relay/protocol";
import {
  GOAL_FINDING_SCHEMA_VERSION,
  GOAL_SESSION_MAX_ACTIONS,
  GOAL_SESSION_MAX_DURATION_MS,
  GOAL_SESSION_MAX_STEPS,
  GOAL_SESSION_SCHEMA_VERSION,
} from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";

const MAX_GOAL_CHARS = 2_048;
const MAX_ERROR_CHARS = 1_024;
const MAX_EVIDENCE_REFS = 8;

export type GoalSessionStore = {
  load(id: string): Promise<GoalSessionRecord | null>;
  save(record: GoalSessionRecord): Promise<void>;
};

export type GoalSessionRunnerOptions = {
  operations: RelayOperationPort;
  decisionProvider?: ModelDecisionProvider;
  store?: GoalSessionStore;
  now?: () => number;
  id?: () => string;
  /** External cancellation for this runner's sessions (job cancellation or
   * process shutdown). Checked before every mutation, not only between steps. */
  signal?: AbortSignal;
};

export type GoalSessionCallOptions = {
  /** Cancellation scoped to this one session (server job cancellation). */
  signal?: AbortSignal;
};

export type GoalSessionRunner = {
  start(input: GoalSessionStartInput, call?: GoalSessionCallOptions): Promise<GoalSessionResult>;
  resume(sessionId: string, call?: GoalSessionCallOptions): Promise<GoalSessionResult>;
  reproduce(sessionId: string, call?: GoalSessionCallOptions): Promise<GoalSessionResult>;
  inspect(sessionId: string): Promise<GoalSessionRecord & { valueRefs?: string[] }>;
  /** Request cancellation. A loop running in this process stops at its next
   * checkpoint; a running record not owned here can only be fenced after
   * review. Terminal records are returned unchanged. */
  cancel(sessionId: string): Promise<GoalSessionRecord>;
};

function goalStoreRoot(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  return join(state, "goals");
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, MAX_ERROR_CHARS) || "Relay operation failed";
}

function boundedGoal(value: string): string {
  const goal = value.trim();
  if (!goal || goal.length > MAX_GOAL_CHARS) {
    throw new TypeError(`goal must be between 1 and ${MAX_GOAL_CHARS} characters.`);
  }
  return goal;
}

function boundedBudget(input: GoalSessionStartInput): GoalSessionBudget {
  const maxSteps = input.maxSteps ?? Math.min(12, GOAL_SESSION_MAX_STEPS);
  const maxDurationMs = input.maxDurationMs ?? Math.min(5 * 60_000, GOAL_SESSION_MAX_DURATION_MS);
  if (
    !Number.isInteger(maxSteps) ||
    maxSteps < 1 ||
    maxSteps > GOAL_SESSION_MAX_STEPS ||
    maxSteps > GOAL_SESSION_MAX_ACTIONS
  ) {
    throw new TypeError(`maxSteps must be an integer between 1 and ${GOAL_SESSION_MAX_STEPS}.`);
  }
  if (
    !Number.isInteger(maxDurationMs) ||
    maxDurationMs < 1_000 ||
    maxDurationMs > GOAL_SESSION_MAX_DURATION_MS
  ) {
    throw new TypeError(
      `maxDurationMs must be an integer between 1000 and ${GOAL_SESSION_MAX_DURATION_MS}.`,
    );
  }
  return { maxSteps, maxDurationMs };
}

function assertSessionId(id: string): void {
  if (!validId(id)) throw new TypeError("Invalid goal session id.");
}

function parseStoredRecord(value: unknown, expectedId: string): GoalSessionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Stored goal session is not an object.");
  }
  const record = value as Partial<GoalSessionRecord>;
  if (
    record.schemaVersion !== GOAL_SESSION_SCHEMA_VERSION ||
    record.id !== expectedId ||
    typeof record.goal !== "string" ||
    !record.target ||
    typeof record.target !== "object" ||
    !record.budget ||
    typeof record.budget !== "object" ||
    !Array.isArray(record.actions) ||
    !Array.isArray(record.observations) ||
    (record.findings !== undefined && !Array.isArray(record.findings)) ||
    (record.status !== "running" &&
      record.status !== "completed" &&
      record.status !== "blocked" &&
      record.status !== "uncertain")
  ) {
    throw new TypeError("Stored goal session is malformed.");
  }
  return record as GoalSessionRecord;
}

function createFileStore(): GoalSessionStore {
  return {
    async load(id) {
      assertSessionId(id);
      try {
        const content = await readFile(join(goalStoreRoot(), `${id}.json`), "utf8");
        return parseStoredRecord(JSON.parse(content) as unknown, id);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async save(record) {
      assertSessionId(record.id);
      const root = goalStoreRoot();
      await mkdir(root, { recursive: true });
      const temporary = join(root, `.${record.id}.${randomUUID()}.tmp`);
      await writeFile(temporary, JSON.stringify(record), { encoding: "utf8", mode: 0o600 });
      await rename(temporary, join(root, `${record.id}.json`));
    },
  };
}

function targetPlatform(platform: "android" | "ios" | "browser") {
  return platform;
}

function assertOpenedTarget(result: { session: { targetId: string } }, targetId: string): void {
  if (result.session.targetId !== targetId) {
    throw new TypeError(
      `Relay opened target ${result.session.targetId}, but the goal requested ${targetId}.`,
    );
  }
}

function evidenceRefs(sessionId: string, observation: TargetObservation, digest: string): string[] {
  const refs = [`goal:${sessionId}:observation:${digest}`];
  const projections = [
    ...(observation.pixels.status === "captured" ? [observation.pixels.artifact] : []),
    observation.semantics.artifact,
  ];
  for (const projection of projections) {
    if (projection.status === "available") refs.push(projection.artifact.id);
  }
  return [...new Set(refs)].slice(0, MAX_EVIDENCE_REFS);
}

function recentActions(record: GoalSessionRecord): GoalObservationAction[] {
  return record.actions.slice(-20).map((action) => ({
    id: action.id,
    kind: action.interaction.kind,
    outcome:
      action.status === "acknowledged"
        ? "acknowledged"
        : action.status === "unknown"
          ? "unknown"
          : "rejected",
    summary: action.label,
  }));
}

function observationSignals(observation: TargetObservation) {
  const signals = [] as Array<{
    kind: "error" | "network" | "log" | "missing-evidence" | "runtime";
    severity: "info" | "warning" | "error";
    summary: string;
  }>;
  if (observation.semantics.status !== "current") {
    signals.push({
      kind: "missing-evidence",
      severity: "warning",
      summary: observation.semantics.message ?? "Semantic controls are not current.",
    });
  }
  if (observation.pixels.status !== "captured") {
    signals.push({
      kind: "missing-evidence",
      severity: "warning",
      summary: "Pixels are unavailable.",
    });
  }
  return signals;
}

function observationCapabilities(observation: TargetObservation) {
  return [
    {
      name: "semantic-control",
      available: observation.semantics.status === "current",
      ...(observation.semantics.status === "current"
        ? {}
        : { reason: "Current semantic control proof is unavailable." }),
    },
    {
      name: "pixels",
      available: observation.pixels.status === "captured",
      ...(observation.pixels.status === "captured"
        ? {}
        : { reason: "Current pixels are unavailable." }),
    },
  ];
}

function choiceAnswer(
  decision: ModelDecisionRecord | undefined,
  id: string,
): ModelChoiceAnswer | undefined {
  const answer = decision?.answers?.[id];
  return answer?.type === "choice" ? answer : undefined;
}

function findCandidate(observation: CompactGoalObservation, candidateId: string) {
  if (observation.screen.semantics !== "current") return undefined;
  return observation.candidates.find((item) => item.id === candidateId);
}

function hasSelector(target: CompactGoalObservation["candidates"][number]["target"]): boolean {
  return Boolean(target.identifier || target.ref || target.label || target.point);
}

/** Tap admission: a proven-enabled, non-editable control with a selector. */
function safeCandidate(observation: CompactGoalObservation, candidateId: string) {
  const candidate = findCandidate(observation, candidateId);
  if (!candidate || candidate.kind !== "control" || !candidate.enabled) return undefined;
  // Assumed-enabled is presentation data, not proven actionability (GOAL-04).
  if (candidate.enabledAssumed) return undefined;
  if (isEditableGoalControl(candidate.role, candidate.target.identifier)) return undefined;
  if (!hasSelector(candidate.target)) return undefined;
  return candidate;
}

/** Fill admission: a proven-enabled editable control with a selector. */
function fillCandidate(observation: CompactGoalObservation, candidateId: string) {
  const candidate = findCandidate(observation, candidateId);
  if (!candidate || candidate.kind !== "control" || !candidate.enabled) return undefined;
  if (candidate.enabledAssumed) return undefined;
  if (!isEditableGoalControl(candidate.role, candidate.target.identifier)) return undefined;
  if (!hasSelector(candidate.target)) return undefined;
  return candidate;
}

/** Synthetic loop primitives are always offered with current semantics. */
function systemCandidate(observation: CompactGoalObservation, candidateId: string) {
  const candidate = findCandidate(observation, candidateId);
  if (!candidate || !candidate.id.startsWith("sys-")) return undefined;
  return candidate;
}

/** Frame binding for browser-device control inputs. Stale sequences are
 * rejected server-side BEFORE dispatch, which is what makes a bounded retry
 * safe. */
type BrowserFrameBinding = { sessionId: string; pageId: string; sequence: number };

async function currentBrowserFrame(
  operations: RelayOperationPort,
  targetId: string,
): Promise<BrowserFrameBinding | undefined> {
  const result = await operations.invoke("target.browser-device.frame", { targetId });
  const frame = result.frame;
  return frame
    ? { sessionId: frame.sessionId, pageId: frame.pageId, sequence: frame.sequence }
    : undefined;
}

/** Dispatch one typed goal action. Browser targets drive the same
 * frame-bound browser-device session the observations came from; native
 * targets use the semantic interact operation. */
async function dispatchGoalAction(
  operations: RelayOperationPort,
  record: GoalSessionRecord,
  action: GoalSessionAction,
  frame: BrowserFrameBinding | undefined,
): Promise<void> {
  const interaction = action.interaction;
  // Wait and capture are local workflow checkpoints. They are acknowledged
  // after the runner sleeps or captures the next observation; neither is a
  // device mutation and neither belongs on target.interact.
  if (interaction.kind === "wait" || interaction.kind === "capture") return;
  if (record.target.platform !== "browser") {
    await operations.invoke("target.interact", interactionInput(record, action));
    return;
  }
  const targetId = record.target.targetId;
  const binding = frame ?? (await currentBrowserFrame(operations, targetId));
  if (!binding) {
    throw new Error("Browser goal target has no open browser-device session.");
  }
  const bound = { sessionId: binding.sessionId, pageId: binding.pageId };
  if (interaction.kind === "fill") {
    const point = interaction.target.point;
    if (!point) throw new Error("Browser fill requires the field's observed point.");
    await operations.invoke("target.browser-device.control", {
      targetId,
      input: { ...bound, expectedSequence: binding.sequence, kind: "click", x: point.x, y: point.y },
    });
    const next = await currentBrowserFrame(operations, targetId);
    if (!next) throw new Error("Browser goal target lost its browser-device session mid-fill.");
    await operations.invoke("target.browser-device.control", {
      targetId,
      input: {
        sessionId: next.sessionId,
        pageId: next.pageId,
        expectedSequence: next.sequence,
        kind: "text",
        text: interaction.value,
      },
    });
    return;
  }
  if (interaction.kind === "key") {
    if (interaction.key !== "back") {
      throw new Error(`Browser goal key ${interaction.key} is not mapped to a control input.`);
    }
    await operations.invoke("target.browser-device.control", {
      targetId,
      input: { ...bound, expectedSequence: binding.sequence, kind: "history", direction: "back" },
    });
    return;
  }
  if (interaction.kind === "swipe") {
    await operations.invoke("target.browser-device.control", {
      targetId,
      input: {
        ...bound,
        expectedSequence: binding.sequence,
        kind: "wheel",
        x: interaction.from.x,
        y: interaction.from.y,
        deltaX: interaction.to.x - interaction.from.x,
        deltaY: interaction.to.y - interaction.from.y,
      },
    });
    return;
  }
  const point = interaction.target.point;
  if (!point) {
    // No observed geometry: fall through to the semantic interact operation,
    // which resolves the selector server-side.
    await operations.invoke("target.interact", interactionInput(record, action));
    return;
  }
  await operations.invoke("target.browser-device.control", {
    targetId,
    input: { ...bound, expectedSequence: binding.sequence, kind: "click", x: point.x, y: point.y },
  });
}

function interactionFor(candidate: {
  target: GoalSessionInteractionTarget;
}): GoalSessionAction["interaction"] {
  // Keep every observed targeting fact: the semantic selector drives native
  // dispatch, and the observed point drives frame-bound browser control.
  const target = { ...candidate.target };
  if (candidate.target.identifier) return { kind: "identifier", target };
  if (candidate.target.ref) return { kind: "ref", target };
  if (candidate.target.label) return { kind: "label", target };
  if (candidate.target.point) return { kind: "point", target };
  throw new TypeError("Goal candidate has no actionable selector.");
}

function interactionInput(record: GoalSessionRecord, action: GoalSessionAction, targetId?: string) {
  const base = {
    serial: targetId ?? record.target.targetId,
    ...(record.laneId ? { laneId: record.laneId } : {}),
  };
  const interaction = action.interaction;
  if (interaction.kind === "fill") {
    const selector = interaction.target;
    return {
      ...base,
      kind: "type" as const,
      text: interaction.value,
      target: {
        ...(selector.identifier ? { identifier: selector.identifier } : {}),
        ...(selector.ref ? { ref: selector.ref } : {}),
        ...(selector.label ? { label: selector.label } : {}),
        ...(selector.point ? { point: selector.point } : {}),
      },
    };
  }
  if (interaction.kind === "key") {
    return { ...base, kind: "key" as const, key: interaction.key };
  }
  if (interaction.kind === "swipe") {
    return {
      ...base,
      kind: "swipe" as const,
      from: interaction.from,
      to: interaction.to,
    };
  }
  if (interaction.kind === "wait" || interaction.kind === "capture") {
    throw new TypeError(`Goal interaction ${interaction.kind} is never dispatched to the target.`);
  }
  const selector = interaction.target;
  return {
    ...base,
    kind: interaction.kind,
    ...(selector.identifier ? { identifier: selector.identifier } : {}),
    ...(selector.ref ? { ref: selector.ref } : {}),
    ...(selector.label ? { label: selector.label } : {}),
    ...(selector.point ? { x: selector.point.x, y: selector.point.y } : {}),
  };
}

function isOutcomeUnknown(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase();
  return message.includes("outcome-unknown") || message.includes("outcome unknown");
}

/** Classify a dispatch failure that arrived after intent was persisted. Only
 * a server admission/validation refusal (HTTP 4xx) proves the input never
 * reached the target. Transport failures, overloads, aborts, and anything
 * ambiguous stay unknown until reconciled — a socket that closed after a
 * request was submitted is not evidence of rejection. */
function isProvablePreDispatchRejection(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = error.status;
    if (typeof status === "number") return status >= 400 && status < 500;
  }
  return false;
}

function result(record: GoalSessionRecord): GoalSessionResult {
  return {
    schemaVersion: GOAL_SESSION_SCHEMA_VERSION,
    sessionId: record.id,
    goal: record.goal,
    target: record.target,
    status: record.status,
    step: record.step,
    budget: record.budget,
    ...(record.stopReason ? { stopReason: record.stopReason } : {}),
    ...(record.lastObservation ? { lastObservation: record.lastObservation } : {}),
    ...(record.lastDecision ? { lastDecision: record.lastDecision } : {}),
    ...(record.reproduction ? { reproduction: record.reproduction } : {}),
    findings: record.findings ?? [],
    actions: record.actions,
    observations: record.observations,
    ...(record.pendingAction ||
    record.stopReason?.code === "action-uncertain" ||
    record.stopReason?.code === "resume-review-required"
      ? { resumeRequiresReview: true as const }
      : {}),
  };
}

function stop(
  record: GoalSessionRecord,
  status: Exclude<GoalSessionRecord["status"], "running">,
  code: GoalSessionStopCode,
  message: string,
  at: number,
): GoalSessionRecord {
  const next = {
    ...record,
    status,
    updatedAt: at,
    stopReason: { code, message: message.slice(0, MAX_ERROR_CHARS), at },
  };
  return appendFinding(next, findingForStop(next, code, message, at));
}

async function resolveTarget(
  operations: RelayOperationPort,
  input: GoalSessionStartInput,
  sessionId: string,
): Promise<{ target: GoalSessionRecord["target"]; laneId?: string }> {
  if (input.startUrl && input.targetId) {
    throw new TypeError("Provide startUrl or targetId, not both.");
  }
  if (input.startUrl && input.authenticationFixtureReference) {
    throw new TypeError(
      "authenticationFixtureReference requires an existing managed browser target; provide targetId instead of startUrl.",
    );
  }
  if (input.authenticationFixtureReference && input.signedOut) {
    throw new TypeError("Choose authenticationFixtureReference or signedOut, not both.");
  }
  if (!input.startUrl && !input.targetId) {
    throw new TypeError("A goal session needs startUrl or targetId.");
  }
  if (input.startUrl) {
    let url: URL;
    try {
      url = new URL(input.startUrl);
    } catch {
      throw new TypeError("startUrl must be an absolute URL.");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new TypeError("startUrl must use http or https.");
    }
    const targetId = `goal-${sessionId}`;
    const created = await operations.invoke("target.create", {
      id: targetId,
      name: `Relay goal ${sessionId.slice(0, 8)}`,
      startUrl: url.toString(),
      headless: true,
      profileRetention: "ephemeral",
    });
    if (created.target.id !== targetId || created.target.kind !== "browser") {
      throw new TypeError("Relay returned an unexpected goal browser target.");
    }
    const opened = await operations.invoke("target.open", {
      targetId,
      ...(input.laneId ? { laneId: input.laneId } : {}),
      ...(input.authenticationFixtureReference
        ? { authenticationFixtureReference: input.authenticationFixtureReference }
        : { signedOut: true }),
      presentation: "embedded",
    });
    assertOpenedTarget(opened, targetId);
    // Observations flow through the browser-device session; it attaches to
    // the same fixture-bound live session the open above created.
    const device = await operations.invoke("target.browser-device.open", { targetId });
    const runtimeSessionId =
      device.session.sessionId ?? opened.session.sessionId ?? undefined;
    return {
      target: {
        targetId,
        platform: targetPlatform("browser"),
        startUrl: url.toString(),
        ...(input.laneId ? { laneId: input.laneId } : {}),
        ...(input.authenticationFixtureReference
          ? { authenticationFixtureReference: input.authenticationFixtureReference }
          : { signedOut: true as const }),
        ...(runtimeSessionId ? { runtimeSessionId } : {}),
        ...(opened.session.configurationDigest
          ? { configurationDigest: opened.session.configurationDigest }
          : {}),
        ...(opened.session.authenticationFixtureId
          ? { appliedAuthenticationFixtureId: opened.session.authenticationFixtureId }
          : {}),
      },
      ...(input.laneId ? { laneId: input.laneId } : {}),
    };
  }
  const targetId = input.targetId!;
  const devices = await operations.invoke("target.devices.list", {});
  const device = devices.devices.find((item) => item.id === targetId || item.serial === targetId);
  if (!device) throw new TypeError(`Target ${targetId} is not connected.`);
  if (input.authenticationFixtureReference && device.platform !== "browser") {
    throw new TypeError("Authentication fixtures can only bind managed browser targets.");
  }
  // An existing managed browser target must actually be opened for this goal —
  // with the requested fixture or clean state — before any interaction. Listing
  // devices only proves the target exists; it never applies a configuration.
  if (device.platform === "browser") {
    // Reproduction of a goal started against an existing managed browser
    // needs the target's durable startUrl; read it from the target registry.
    const listed = await operations.invoke("target.list", {});
    const registered = listed.targets.find((target) => target.id === targetId);
    const browserStartUrl =
      registered?.browser?.startUrl && registered.browser.startUrl.startsWith("http")
        ? registered.browser.startUrl
        : undefined;
    const opened = await operations.invoke("target.open", {
      targetId: device.serial || device.id,
      ...(input.laneId ? { laneId: input.laneId } : {}),
      ...(input.authenticationFixtureReference
        ? { authenticationFixtureReference: input.authenticationFixtureReference }
        : input.signedOut
          ? { signedOut: true }
          : {}),
      presentation: "embedded",
    });
    assertOpenedTarget(opened, device.serial || device.id);
    const browserDevice = await operations.invoke("target.browser-device.open", {
      targetId: device.serial || device.id,
    });
    return {
      target: {
        targetId: device.serial || device.id,
        platform: targetPlatform("browser"),
        ...(browserStartUrl ? { startUrl: browserStartUrl } : {}),
        ...(browserDevice.session.sessionId
          ? { runtimeSessionId: browserDevice.session.sessionId }
          : opened.session.sessionId
            ? { runtimeSessionId: opened.session.sessionId }
            : {}),
        ...(input.laneId ? { laneId: input.laneId } : {}),
        ...(input.authenticationFixtureReference
          ? { authenticationFixtureReference: input.authenticationFixtureReference }
          : {}),
        ...(input.signedOut || opened.session.signedOut ? { signedOut: true as const } : {}),
        ...(opened.session.sessionId
          ? { runtimeSessionId: opened.session.sessionId }
          : {}),
        ...(opened.session.configurationDigest
          ? { configurationDigest: opened.session.configurationDigest }
          : {}),
        ...(opened.session.authenticationFixtureId
          ? { appliedAuthenticationFixtureId: opened.session.authenticationFixtureId }
          : {}),
      },
      ...(input.laneId ? { laneId: input.laneId } : {}),
    };
  }
  return {
    target: {
      targetId: device.serial || device.id,
      platform: targetPlatform(device.platform),
      ...(input.laneId ? { laneId: input.laneId } : {}),
      ...(input.authenticationFixtureReference
        ? { authenticationFixtureReference: input.authenticationFixtureReference }
        : {}),
    },
    ...(input.laneId ? { laneId: input.laneId } : {}),
  };
}

async function ensureFreshBrowserTarget(
  operations: RelayOperationPort,
  targetId: string,
  startUrl: string,
  sessionId: string,
  authenticationFixtureReference?: string,
): Promise<{ target: GoalSessionRecord["target"]; exists: boolean }> {
  const registered = await operations.invoke("target.list", {});
  const existing = registered.targets.find((target) => target.id === targetId);
  if (existing) {
    if (existing.kind !== "browser" || existing.browser?.startUrl !== startUrl) {
      throw new TypeError("The durable goal target is bound to a different browser configuration.");
    }
    return {
      target: {
        targetId,
        platform: "browser",
        startUrl,
        ...(authenticationFixtureReference ? { authenticationFixtureReference } : {}),
      },
      exists: true,
    };
  }
  const created = await operations.invoke("target.create", {
    id: targetId,
    name: `Relay goal ${sessionId.slice(0, 8)}`,
    startUrl,
    headless: true,
    profileRetention: "ephemeral",
  });
  if (created.target.id !== targetId || created.target.kind !== "browser") {
    throw new TypeError("Relay returned an unexpected goal browser target.");
  }
  return {
    target: {
      targetId,
      platform: "browser",
      startUrl,
      ...(authenticationFixtureReference ? { authenticationFixtureReference } : {}),
    },
    exists: false,
  };
}

function reproductionEvidenceRefs(
  sessionId: string,
  reproductionId: string,
  observation: TargetObservation,
  digest: string,
): string[] {
  const refs = [`goal:${sessionId}:reproduction:${reproductionId}:observation:${digest}`];
  const projections = [
    ...(observation.pixels.status === "captured" ? [observation.pixels.artifact] : []),
    observation.semantics.artifact,
  ];
  for (const projection of projections) {
    if (projection.status === "available") refs.push(projection.artifact.id);
  }
  return [...new Set(refs)].slice(0, MAX_EVIDENCE_REFS);
}

function findingEvidenceRefs(record: GoalSessionRecord): string[] {
  return [
    ...(record.actions.at(-1)?.evidenceRefs ?? []),
    ...(record.observations.at(-1)?.evidenceRefs ?? []),
  ].slice(0, MAX_EVIDENCE_REFS);
}

function findingForStop(
  record: GoalSessionRecord,
  code: GoalSessionStopCode,
  message: string,
  at: number,
): GoalFinding | undefined {
  if (code === "goal-achieved") return undefined;
  const missingEvidence = code === "observation-unavailable";
  const uncertainMutation = code === "action-uncertain";
  return {
    schemaVersion: GOAL_FINDING_SCHEMA_VERSION,
    id: `finding-${record.id}-${code}`,
    sessionId: record.id,
    kind: missingEvidence
      ? "missing-evidence"
      : uncertainMutation
        ? "possible-issue"
        : "blocked-exploration",
    status: uncertainMutation ? "open" : "blocked",
    title: missingEvidence
      ? "Exploration stopped with missing evidence"
      : uncertainMutation
        ? "Possible issue after an uncertain interaction"
        : "Exploration stopped before the goal was established",
    summary: message.slice(0, MAX_ERROR_CHARS),
    evidenceRefs: findingEvidenceRefs(record),
    source: "goal-runner",
    createdAt: at,
    updatedAt: at,
    requiresReview: true,
  };
}

function appendFinding(
  record: GoalSessionRecord,
  finding: GoalFinding | undefined,
): GoalSessionRecord {
  if (!finding) return record;
  const findings = [...(record.findings ?? []).filter((item) => item.id !== finding.id), finding];
  return { ...record, findings };
}

export function createGoalSessionRunner(options: GoalSessionRunnerOptions): GoalSessionRunner {
  const store = options.store ?? createFileStore();
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const locks = new Map<string, Promise<GoalSessionResult>>();
  const cancelRequested = new Set<string>();

  const persist = async (record: GoalSessionRecord): Promise<void> => {
    await store.save({ ...record, updatedAt: now() });
  };

  let browserFrame: BrowserFrameBinding | undefined;
  const capture = async (record: GoalSessionRecord): Promise<CompactGoalObservation> => {
    const observation = await options.operations.invoke("target.observation.capture", {
      serial: record.target.targetId,
    });
    if (record.target.platform === "browser") {
      browserFrame = await currentBrowserFrame(options.operations, record.target.targetId);
    }
    const compact = compactGoalObservation({
      goal: record.goal,
      sessionId: record.id,
      targetId: record.target.targetId,
      platform: record.target.platform,
      app: observation.foregroundApp,
      ...(record.target.runtimeSessionId
        ? { runtimeSessionId: record.target.runtimeSessionId }
        : {}),
      observation,
      recentActions: recentActions(record),
      signals: observationSignals(observation),
      capabilities: observationCapabilities(observation),
      missingEvidence: [
        ...(observation.pixels.status === "captured" ? [] : ["pixels"]),
        ...(observation.semantics.status === "current" ? [] : ["current semantics"]),
      ],
    });
    const refs = evidenceRefs(record.id, observation, compact.observationDigest);
    const next: GoalSessionRecord = {
      ...record,
      lastObservation: compact,
      observations: [
        ...record.observations,
        {
          step: record.step,
          observationDigest: compact.observationDigest,
          capturedAt: observation.capturedAt,
          evidenceRefs: refs,
        },
      ].slice(-GOAL_SESSION_MAX_ACTIONS),
      updatedAt: now(),
    };
    await store.save(next);
    return compact;
  };

  const run = async (
    starting: GoalSessionRecord,
    callSignal?: AbortSignal,
  ): Promise<GoalSessionResult> => {
    // Loop-level cancellation checks; the provider call itself is bounded by
    // its own retry/timeout policy.
    const signal = callSignal ?? options.signal;
    const provider = options.decisionProvider ?? createOpenRouterDecisionProvider();
    let record = starting;
    if (record.pendingAction) {
      record = stop(
        record,
        "uncertain",
        "resume-review-required",
        "A mutation was recorded as intended before the worker stopped. Review the target before resuming; Relay will not replay it.",
        now(),
      );
      await persist(record);
      return result(record);
    }
    if (record.status !== "running") return result(record);

    let observation: CompactGoalObservation;
    try {
      observation = await capture(record);
      record = (await store.load(record.id)) ?? record;
    } catch (error) {
      record = stop(record, "blocked", "observation-unavailable", normalizeError(error), now());
      await persist(record);
      return result(record);
    }

    for (;;) {
      if (signal?.aborted || cancelRequested.has(record.id)) {
        record = stop(
          record,
          "cancelled",
          "cancelled",
          cancelRequested.has(record.id)
            ? "The goal session was cancelled by request before this step."
            : "The goal session was cancelled before this step.",
          now(),
        );
        await persist(record);
        return result(record);
      }
      const elapsed = now() - record.createdAt;
      if (elapsed >= record.budget.maxDurationMs || record.step >= record.budget.maxSteps) {
        record = stop(
          record,
          "blocked",
          "budget-exhausted",
          `Goal worker budget exhausted after ${record.step} action(s).`,
          now(),
        );
        await persist(record);
        return result(record);
      }

      const tapCandidates = observation.candidates.filter(
        (candidate) => safeCandidate(observation, candidate.id) !== undefined,
      );
      const taskValues = record.values ?? {};
      const valueRefs = Object.keys(taskValues).filter((key) => taskValues[key] !== undefined);
      const fillCandidates = valueRefs.length
        ? observation.candidates.filter(
            (candidate) => fillCandidate(observation, candidate.id) !== undefined,
          )
        : [];
      const systemCandidates = observation.candidates.filter(
        (candidate) => systemCandidate(observation, candidate.id) !== undefined,
      );
      const criteria: Record<string, string | null> = {
        none: "No safe action should be executed from this observation.",
        ...Object.fromEntries(
          tapCandidates.map((candidate) => [
            candidate.id,
            `Tap ${candidate.label ?? candidate.text ?? candidate.role ?? "control"} (${candidate.id})`,
          ]),
        ),
        ...Object.fromEntries(
          fillCandidates.map((candidate) => [
            candidate.id,
            `Fill ${candidate.label ?? candidate.role ?? "field"} (${candidate.id}) using one provided value`,
          ]),
        ),
        ...Object.fromEntries(
          systemCandidates.map((candidate) => [
            candidate.id,
            `${candidate.label ?? candidate.id} (${candidate.id})`,
          ]),
        ),
      };
      const request = {
        schemaVersion: 1 as const,
        provider: "openrouter",
        model: record.model ?? DEFAULT_OPENROUTER_DECISION_MODEL,
        state: observation,
        observationDigest: observation.observationDigest,
        evidenceRefs: record.observations.at(-1)?.evidenceRefs,
        questions: {
          progress: {
            type: "choice" as const,
            instructions:
              "Classify only what is supported by the current observation: complete if the goal is visibly achieved; continue if one safe control should be tried; blocked if the goal cannot proceed; uncertain if the evidence is insufficient.",
            criteria: {
              complete: "The stated goal is visibly achieved.",
              continue: "One safe control may advance the goal.",
              blocked: "The goal cannot proceed from this screen.",
              uncertain: "Evidence is insufficient to choose safely.",
            },
          },
          next_action: {
            type: "choice" as const,
            instructions:
              "Choose one control from this exact observation, or none. Never invent a selector, type text, run code, or use a credential.",
            criteria,
          },
          ...(fillCandidates.length > 0
            ? {
                value_ref: {
                  type: "choice" as const,
                  instructions:
                    "If the next action fills a field, choose which provided value reference to use; otherwise none.",
                  criteria: {
                    none: "No value is needed for the selected action.",
                    ...Object.fromEntries(
                      Object.keys(record.values ?? {}).map((key) => [
                        key,
                        `Use the provided task value "${key}".`,
                      ]),
                    ),
                  },
                },
              }
            : {}),
        },
      };
      let decision: ModelDecisionRecord;
      try {
        decision = await provider.decide(request);
      } catch (error) {
        record = stop(record, "blocked", "provider-unavailable", normalizeError(error), now());
        await persist(record);
        return result(record);
      }
      record = { ...record, lastDecision: decision, updatedAt: now() };
      await persist(record);
      // A decision is bound to the exact observation it judged. If the
      // provider returns one stamped with a different digest, it did not judge
      // this observation and can never authorize input against it.
      if (
        decision.observationDigest &&
        decision.observationDigest !== observation.observationDigest
      ) {
        record = stop(
          record,
          "blocked",
          "action-rejected",
          "The provider decision was bound to a different observation; it cannot authorize input.",
          now(),
        );
        await persist(record);
        return result(record);
      }
      if (decision.status !== "ok") {
        const code = decision.status === "invalid" ? "provider-invalid" : "provider-unavailable";
        record = stop(
          record,
          "blocked",
          code,
          decision.error?.message ?? "OpenRouter did not return a usable decision.",
          now(),
        );
        await persist(record);
        return result(record);
      }
      const progress = choiceAnswer(decision, "progress")?.choice;
      if (progress === "complete") {
        record = stop(
          record,
          "completed",
          "goal-achieved",
          "OpenRouter suggested completion from the current observation; no stronger deterministic verifier was supplied.",
          now(),
        );
        await persist(record);
        return result(record);
      }
      if (progress === "blocked" || progress === "uncertain") {
        record = stop(
          record,
          progress === "uncertain" ? "uncertain" : "blocked",
          "no-action",
          progress === "uncertain"
            ? "OpenRouter could not establish a safe next action from the current evidence."
            : "OpenRouter judged that the goal cannot proceed from the current observation.",
          now(),
        );
        await persist(record);
        return result(record);
      }
      const candidateId = choiceAnswer(decision, "next_action")?.choice;
      if (!candidateId || candidateId === "none") {
        record = stop(record, "blocked", "no-action", "No safe next action was selected.", now());
        await persist(record);
        return result(record);
      }
      const candidate =
        safeCandidate(observation, candidateId) ??
        fillCandidate(observation, candidateId) ??
        systemCandidate(observation, candidateId);
      if (!candidate) {
        record = stop(
          record,
          "blocked",
          "action-rejected",
          "The selected control was not authorized by the current observation.",
          now(),
        );
        await persist(record);
        return result(record);
      }
      const availableValueRefs = Object.keys(record.values ?? {});
      let interaction: GoalSessionAction["interaction"];
      if (candidate.kind === "control" && isEditableGoalControl(candidate.role, candidate.target.identifier)) {
        const valueRef = choiceAnswer(decision, "value_ref")?.choice;
        const value = valueRef ? taskValues[valueRef] : undefined;
        if (typeof value !== "string" || !value) {
          record = stop(
            record,
            "blocked",
            "needs-input",
            `The selected field needs a task value. Provide one of [${availableValueRefs.join(", ") || "no values configured"}] and resume.`,
            now(),
          );
          await persist(record);
          return result(record);
        }
        interaction = {
          kind: "fill",
          target: { ...candidate.target },
          value,
          mode: "replace",
        };
      } else if (candidate.id === "sys-back") {
        interaction = { kind: "key", key: "back" };
      } else if (candidate.id === "sys-wait") {
        interaction = { kind: "wait", ms: 1_500 };
      } else if (candidate.id === "sys-capture") {
        interaction = { kind: "capture", label: "capture" };
      } else if (candidate.kind === "scroll" && candidate.target.point) {
        const point = candidate.target.point;
        const down = candidate.id === "sys-scroll-down";
        interaction = {
          kind: "swipe",
          from: { x: point.x, y: point.y },
          to: { x: point.x, y: Math.max(0, point.y + (down ? 400 : -400)) },
        };
      } else {
        interaction = interactionFor(candidate);
      }
      const remainingBudget = record.budget.maxDurationMs - (now() - record.createdAt);
      if (signal?.aborted || remainingBudget <= 0) {
        record = stop(
          record,
          signal?.aborted ? "cancelled" : "blocked",
          signal?.aborted ? "cancelled" : "budget-exhausted",
          signal?.aborted
            ? "The goal session was cancelled before dispatching the selected control."
            : `Goal worker budget exhausted before dispatching action ${record.step + 1}.`,
          now(),
        );
        await persist(record);
        return result(record);
      }
      const action: GoalSessionAction = {
        id: `action-${record.actions.length + 1}`,
        step: record.step + 1,
        candidateId: candidate.id,
        label: candidate.label ?? candidate.text ?? candidate.role ?? candidate.id,
        interaction,
        status: "intended",
        observationDigestBefore: observation.observationDigest,
        evidenceRefs: record.observations.at(-1)?.evidenceRefs ?? [],
        at: now(),
      };
      record = {
        ...record,
        actions: [...record.actions, action],
        pendingAction: {
          actionId: action.id,
          candidateId: action.candidateId,
          observationDigest: action.observationDigestBefore,
          intendedAt: action.at,
        },
        updatedAt: now(),
      };
      await persist(record);
      try {
        if (interaction.kind === "wait") {
          await new Promise((resolve) => setTimeout(resolve, Math.min(interaction.ms, 10_000)));
        } else {
          try {
            await dispatchGoalAction(options.operations, record, action, browserFrame);
          } catch (error) {
            // A stale frame is provably pre-dispatch (rejected by sequence CAS
            // before any input): one bounded retry against the current frame.
            if (error instanceof Error && /BROWSER_STALE_INPUT/u.test(error.message)) {
              const fresh = await currentBrowserFrame(options.operations, record.target.targetId);
              await dispatchGoalAction(options.operations, record, action, fresh);
            } else {
              throw error;
            }
          }
        }
        const acknowledged = { ...action, status: "acknowledged" as const, at: now() };
        record = {
          ...record,
          actions: record.actions.map((item) => (item.id === action.id ? acknowledged : item)),
          pendingAction: undefined,
          step: action.step,
          updatedAt: now(),
        };
        await persist(record);
        // A browser interaction can trigger navigation; capturing in the same
        // tick would observe the pre-action page. A bounded settle keeps the
        // next observation honest without inventing a navigation verifier.
        if (record.target.platform === "browser") {
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
      } catch (error) {
        const unknown = isOutcomeUnknown(error) || !isProvablePreDispatchRejection(error);
        const failed = {
          ...action,
          status: unknown ? ("unknown" as const) : ("rejected" as const),
          error: normalizeError(error),
          at: now(),
        };
        record = {
          ...record,
          actions: record.actions.map((item) => (item.id === action.id ? failed : item)),
          pendingAction: undefined,
          updatedAt: now(),
        };
        record = stop(
          record,
          unknown ? "uncertain" : "blocked",
          unknown ? "action-uncertain" : "action-rejected",
          unknown
            ? "The target interaction may have been applied. Review the current target before any resume."
            : `The selected control was rejected: ${failed.error}`,
          now(),
        );
        await persist(record);
        return result(record);
      }
      try {
        observation = await capture(record);
        record = (await store.load(record.id)) ?? record;
        const afterEvidence = record.observations.at(-1)?.evidenceRefs ?? [];
        record = {
          ...record,
          actions: record.actions.map((item) =>
            item.id === action.id
              ? {
                  ...item,
                  observationDigestAfter: observation.observationDigest,
                  evidenceRefs: [...new Set([...item.evidenceRefs, ...afterEvidence])].slice(
                    0,
                    MAX_EVIDENCE_REFS,
                  ),
                }
              : item,
          ),
        };
        await persist(record);
      } catch (error) {
        record = stop(record, "blocked", "observation-unavailable", normalizeError(error), now());
        await persist(record);
        return result(record);
      }
    }
  };

  const exclusive = (sessionId: string, operation: () => Promise<GoalSessionResult>) => {
    const previous =
      locks.get(sessionId) ?? Promise.resolve(undefined as unknown as GoalSessionResult);
    const next = previous.catch(() => undefined).then(operation);
    locks.set(sessionId, next);
    void next.then(
      () => {
        if (locks.get(sessionId) === next) locks.delete(sessionId);
      },
      () => {
        if (locks.get(sessionId) === next) locks.delete(sessionId);
      },
    );
    return next;
  };

  return {
    async start(input, call) {
      const sessionId = input.sessionId ?? id();
      assertSessionId(sessionId);
      const goal = boundedGoal(input.goal);
      const budget = boundedBudget(input);
      const resolved = await resolveTarget(options.operations, input, sessionId);
      const at = now();
      const record: GoalSessionRecord = {
        schemaVersion: GOAL_SESSION_SCHEMA_VERSION,
        id: sessionId,
        goal,
        target: resolved.target,
        budget,
        ...(resolved.laneId ? { laneId: resolved.laneId } : {}),
        ...(input.model?.trim() ? { model: input.model.trim() } : {}),
        ...(input.values && Object.keys(input.values).length > 0
          ? { values: input.values }
          : {}),
        status: "running",
        step: 0,
        createdAt: at,
        updatedAt: at,
        observations: [],
        actions: [],
        findings: [],
      };
      await store.save(record);
      return exclusive(sessionId, () => run(record, call?.signal));
    },
    async resume(sessionId, call) {
      assertSessionId(sessionId);
      const record = await store.load(sessionId);
      if (!record) throw new TypeError(`Goal session ${sessionId} was not found.`);
      return exclusive(sessionId, async () => {
        const current = (await store.load(sessionId)) ?? record;
        const awaitingExplicitReview =
          current.stopReason?.code === "action-uncertain" ||
          current.stopReason?.code === "resume-review-required";
        if (current.pendingAction !== undefined && !awaitingExplicitReview) {
          return run(current, call?.signal);
        }
        if (current.status !== "running" && !awaitingExplicitReview) return result(current);

        // An explicit resume is the human review boundary for an uncertain
        // mutation. Preserve the original action and finding as evidence, but
        // clear only the replay fence so the next run captures the current
        // target and chooses from fresh evidence. The uncertain mutation is
        // never dispatched again.
        const resumed = awaitingExplicitReview
          ? {
              ...current,
              status: "running" as const,
              pendingAction: undefined,
              stopReason: undefined,
              updatedAt: now(),
            }
          : current;
        if (resumed !== current) await persist(resumed);
        return run(resumed, call?.signal);
      });
    },
    async reproduce(sessionId, call) {
      assertSessionId(sessionId);
      const loaded = await store.load(sessionId);
      if (!loaded) throw new TypeError(`Goal session ${sessionId} was not found.`);
      const reproSignal = call?.signal;
      return exclusive(sessionId, async () => {
        let record = (await store.load(sessionId)) ?? loaded;
        if (record.reproduction && record.reproduction.status !== "running") {
          return result(record);
        }
        if (record.pendingAction) {
          record = stop(
            record,
            "uncertain",
            "resume-review-required",
            "The original goal still has an in-flight mutation. Review it before attempting reproduction.",
            now(),
          );
          await persist(record);
          return result(record);
        }
        if (record.target.platform !== "browser" || !record.target.startUrl) {
          throw new TypeError(
            "Fresh reproduction currently requires a browser goal with a durable startUrl.",
          );
        }
        if (record.target.laneId) {
          throw new TypeError(
            "Fresh reproduction cannot reuse a shared Lane; use a signed-out or fixture-bound browser target.",
          );
        }
        if (record.status !== "completed") {
          throw new TypeError("Fresh reproduction requires a completed goal session.");
        }
        const sourceActions = record.actions.filter((action) => action.status === "acknowledged");
        if (sourceActions.length === 0 || sourceActions.length !== record.actions.length) {
          throw new TypeError(
            "Fresh reproduction requires a goal path whose every recorded action was acknowledged.",
          );
        }
        const reproductionId = record.reproduction?.id ?? `repro-${record.id.slice(0, 120)}`;
        const targetId = `goal-repro-${record.id.slice(0, 110)}`;
        const ensured = await ensureFreshBrowserTarget(
          options.operations,
          targetId,
          record.target.startUrl,
          reproductionId,
          record.target.authenticationFixtureReference,
        );
        let reproduction: GoalReproductionRecord = {
          id: reproductionId,
          sourceSessionId: record.id,
          target: ensured.target,
          status: "running",
          startedAt: record.reproduction?.startedAt ?? now(),
          updatedAt: now(),
          actions: record.reproduction?.actions ?? [],
          observations: record.reproduction?.observations ?? [],
          findings: record.reproduction?.findings ?? [],
          // An interrupted reproduction keeps its exact unresolved mutation:
          // the fence below must see it after a restart, not skip it.
          ...(record.reproduction?.pendingAction
            ? { pendingAction: record.reproduction.pendingAction }
            : {}),
          ...(record.reproduction?.lastObservation
            ? { lastObservation: record.reproduction.lastObservation }
            : {}),
        };
        const saveReproduction = async (): Promise<void> => {
          reproduction = { ...reproduction, updatedAt: now() };
          record = { ...record, reproduction };
          await persist(record);
        };
        const finish = async (
          status: GoalReproductionRecord["status"],
          code: GoalSessionStopCode,
          message: string,
        ): Promise<GoalSessionResult> => {
          const at = now();
          const finding: GoalFinding = {
            schemaVersion: GOAL_FINDING_SCHEMA_VERSION,
            id: `finding-${record.id}-reproduction-${status}`,
            sessionId: record.id,
            kind:
              status === "reproduced"
                ? "reproduction-lead"
                : status === "uncertain" || status === "unresolved"
                  ? "possible-issue"
                  : "missing-evidence",
            status:
              status === "reproduced" ? "reproduced" : status === "uncertain" ? "open" : "blocked",
            title:
              status === "reproduced"
                ? "Fresh path replayed; review before saving a Test"
                : status === "uncertain"
                  ? "Possible issue needs fresh-target review"
                  : "Fresh reproduction needs more evidence",
            summary: message.slice(0, MAX_ERROR_CHARS),
            evidenceRefs: [
              ...(reproduction.actions.at(-1)?.evidenceRefs ?? []),
              ...(reproduction.observations.at(-1)?.evidenceRefs ?? []),
            ].slice(0, MAX_EVIDENCE_REFS),
            source: "fresh-reproduction",
            createdAt: at,
            updatedAt: at,
            requiresReview: true,
          };
          reproduction = {
            ...reproduction,
            status,
            // An unresolved mutation survives an uncertain finish — it is the
            // thing being fenced. Only a settled outcome clears it.
            pendingAction: status === "uncertain" ? reproduction.pendingAction : undefined,
            findings: [
              ...(reproduction.findings ?? []).filter((item) => item.id !== finding.id),
              finding,
            ],
            stopReason: { code, message: message.slice(0, MAX_ERROR_CHARS), at },
            updatedAt: at,
          };
          record = { ...record, reproduction };
          await persist(record);
          return result(record);
        };
        if (reproduction.pendingAction) {
          return finish(
            "uncertain",
            "resume-review-required",
            "A reproduction mutation was recorded as intended before the worker stopped. Review the fresh target; Relay will not replay it.",
          );
        }
        let replayedSignedOut = false;
        if (!ensured.exists || reproduction.actions.length === 0) {
          // Account fixtures are bound to the browser they were issued for.
          // A fresh reproduction target is a different browser: when the
          // fixture cannot bind there, replay signed-out and say so — never
          // silently claim the same account identity.
          let opened;
          try {
            opened = await options.operations.invoke("target.open", {
              targetId,
              ...(record.target.authenticationFixtureReference
                ? { authenticationFixtureReference: record.target.authenticationFixtureReference }
                : { signedOut: true as const }),
              presentation: "embedded",
            });
          } catch (error) {
            if (
              record.target.authenticationFixtureReference &&
              error &&
              typeof error === "object" &&
              "status" in error &&
              error.status === 409
            ) {
              replayedSignedOut = true;
              opened = await options.operations.invoke("target.open", {
                targetId,
                signedOut: true,
                presentation: "embedded",
              });
            } else {
              throw error;
            }
          }
          assertOpenedTarget(opened, targetId);
          // Reproduction observations and frame-bound input flow through the
          // browser-device session, exactly like the original goal run.
          await options.operations.invoke("target.browser-device.open", { targetId });
          if (replayedSignedOut) {
            reproduction = {
              ...reproduction,
              target: { ...reproduction.target, authenticationFixtureReference: undefined },
            };
            await saveReproduction();
          }
        }
        await saveReproduction();

        const captureReproduction = async (): Promise<CompactGoalObservation> => {
          const observation = await options.operations.invoke("target.observation.capture", {
            serial: targetId,
          });
          const compact = compactGoalObservation({
            goal: record.goal,
            sessionId: reproduction.id,
            targetId,
            platform: "browser",
            app: observation.foregroundApp,
            ...(reproduction.target.runtimeSessionId
              ? { runtimeSessionId: reproduction.target.runtimeSessionId }
            : {}),
            observation,
            recentActions: recentActions({
              ...record,
              id: reproduction.id,
              target: reproduction.target,
              actions: reproduction.actions,
            }),
            signals: observationSignals(observation),
            capabilities: observationCapabilities(observation),
            missingEvidence: [
              ...(observation.pixels.status === "captured" ? [] : ["pixels"]),
              ...(observation.semantics.status === "current" ? [] : ["current semantics"]),
            ],
          });
          const refs = reproductionEvidenceRefs(
            record.id,
            reproduction.id,
            observation,
            compact.observationDigest,
          );
          reproduction = {
            ...reproduction,
            lastObservation: compact,
            observations: [
              ...reproduction.observations,
              {
                step: reproduction.actions.length,
                observationDigest: compact.observationDigest,
                capturedAt: observation.capturedAt,
                evidenceRefs: refs,
              },
            ].slice(-GOAL_SESSION_MAX_ACTIONS),
          };
          await saveReproduction();
          return compact;
        };

        try {
          if (!reproduction.lastObservation) await captureReproduction();
        } catch (error) {
          return finish("blocked", "observation-unavailable", normalizeError(error));
        }
        for (let index = reproduction.actions.length; index < sourceActions.length; index += 1) {
          const sourceAction = sourceActions[index]!;
          const before = reproduction.lastObservation;
          if (!before)
            return finish(
              "blocked",
              "observation-unavailable",
              "Reproduction has no current observation.",
            );
          const reproductionElapsed = now() - reproduction.startedAt;
          if (reproSignal?.aborted || reproductionElapsed >= record.budget.maxDurationMs) {
            return finish(
              "cancelled",
              reproSignal?.aborted ? "cancelled" : "budget-exhausted",
              reproSignal?.aborted
                ? "The reproduction was cancelled before replaying its next action."
                : "The reproduction exceeded the session duration budget before replaying its next action.",
            );
          }
          const action: GoalSessionAction = {
            ...sourceAction,
            id: `repro-action-${index + 1}`,
            step: index + 1,
            status: "intended",
            observationDigestBefore: before.observationDigest,
            observationDigestAfter: undefined,
            evidenceRefs: reproduction.observations.at(-1)?.evidenceRefs ?? [],
            at: now(),
            error: undefined,
          };
          reproduction = {
            ...reproduction,
            actions: [...reproduction.actions, action],
            pendingAction: {
              actionId: action.id,
              candidateId: action.candidateId,
              observationDigest: action.observationDigestBefore,
              intendedAt: action.at,
            },
          };
          await saveReproduction();
          try {
            await dispatchGoalAction(
              options.operations,
              { ...record, target: reproduction.target },
              action,
              await currentBrowserFrame(options.operations, reproduction.target.targetId),
            );
            reproduction = {
              ...reproduction,
              actions: reproduction.actions.map((item) =>
                item.id === action.id ? { ...item, status: "acknowledged", at: now() } : item,
              ),
              pendingAction: undefined,
            };
            await saveReproduction();
          } catch (error) {
            const unknown = isOutcomeUnknown(error) || !isProvablePreDispatchRejection(error);
            reproduction = {
              ...reproduction,
              actions: reproduction.actions.map((item) =>
                item.id === action.id
                  ? {
                      ...item,
                      status: unknown ? ("unknown" as const) : ("rejected" as const),
                      error: normalizeError(error),
                      at: now(),
                    }
                  : item,
              ),
            };
            await saveReproduction();
            return finish(
              unknown ? "uncertain" : "unresolved",
              unknown ? "action-uncertain" : "action-rejected",
              unknown
                ? "The fresh reproduction interaction may have been applied. Review the target before any retry."
                : `The fresh reproduction could not replay the selected control: ${normalizeError(error)}`,
            );
          }
          try {
            const after = await captureReproduction();
            const refs = reproduction.observations.at(-1)?.evidenceRefs ?? [];
            reproduction = {
              ...reproduction,
              actions: reproduction.actions.map((item) =>
                item.id === action.id
                  ? {
                      ...item,
                      observationDigestAfter: after.observationDigest,
                      evidenceRefs: [...new Set([...item.evidenceRefs, ...refs])].slice(
                        0,
                        MAX_EVIDENCE_REFS,
                      ),
                    }
                  : item,
              ),
            };
            await saveReproduction();
          } catch (error) {
            return finish("blocked", "observation-unavailable", normalizeError(error));
          }
        }
        return finish(
          "reproduced",
          "goal-achieved",
          "Fresh target replayed every acknowledged goal action and captured each result. Human review is still required before promotion.",
        );
      });
    },
    async inspect(sessionId) {
      assertSessionId(sessionId);
      const record = await store.load(sessionId);
      if (!record) throw new TypeError(`Goal session ${sessionId} was not found.`);
      // Inspect is an observation surface: task values never leave the store.
      const { values: _values, ...safe } = record;
      return {
        ...safe,
        ...(record.values ? { valueRefs: Object.keys(record.values) } : {}),
      };
    },
    async cancel(sessionId) {
      assertSessionId(sessionId);
      const record = await store.load(sessionId);
      if (!record) throw new TypeError(`Goal session ${sessionId} was not found.`);
      if (record.status !== "running") return record;
      if (record.pendingAction) {
        throw new TypeError(
          "The goal session has an unresolved in-flight mutation. Review the target before cancelling.",
        );
      }
      if (locks.has(sessionId)) {
        // The loop checks this flag at its next checkpoint (before any
        // mutation) and persists the cancelled terminal record itself.
        cancelRequested.add(sessionId);
        return record;
      }
      const cancelled = stop(
        record,
        "cancelled",
        "cancelled",
        "The goal session was cancelled while not executing in this process.",
        now(),
      );
      await persist(cancelled);
      return cancelled;
    },
  };
}
