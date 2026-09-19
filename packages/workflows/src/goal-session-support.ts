import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { findWorkspaceRoot, isEditableGoalControl } from "@relay/core";
import type {
  CompactGoalObservation,
  GoalFinding,
  GoalObservationAction,
  GoalSessionAction,
  GoalSessionBudget,
  GoalSessionInteractionTarget,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStartInput,
  GoalSessionStopCode,
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

export const MAX_ERROR_CHARS = 1_024;
export const MAX_EVIDENCE_REFS = 8;
const MAX_GOAL_CHARS = 2_048;

export type GoalSessionStore = {
  load(id: string): Promise<GoalSessionRecord | null>;
  save(record: GoalSessionRecord): Promise<void>;
};

export function goalStoreRoot(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  return join(state, "goals");
}

export function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
}

export function normalizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, MAX_ERROR_CHARS) || "Relay operation failed";
}

export function boundedGoal(value: string): string {
  const goal = value.trim();
  if (!goal || goal.length > MAX_GOAL_CHARS) {
    throw new TypeError(`goal must be between 1 and ${MAX_GOAL_CHARS} characters.`);
  }
  return goal;
}

export function boundedBudget(input: GoalSessionStartInput): GoalSessionBudget {
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

export function assertSessionId(id: string): void {
  if (!validId(id)) throw new TypeError("Invalid goal session id.");
}

export function parseStoredRecord(value: unknown, expectedId: string): GoalSessionRecord {
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

export function createFileStore(): GoalSessionStore {
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

export function targetPlatform(platform: "android" | "ios" | "browser") {
  return platform;
}

export function assertOpenedTarget(
  result: { session: { targetId: string } },
  targetId: string,
): void {
  if (result.session.targetId !== targetId) {
    throw new TypeError(
      `Relay opened target ${result.session.targetId}, but the goal requested ${targetId}.`,
    );
  }
}

export function evidenceRefs(
  sessionId: string,
  observation: TargetObservation,
  digest: string,
): string[] {
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

export function recentActions(record: GoalSessionRecord): GoalObservationAction[] {
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

export function observationSignals(observation: TargetObservation) {
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

export function observationCapabilities(observation: TargetObservation) {
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

export function choiceAnswer(
  decision: ModelDecisionRecord | undefined,
  id: string,
): ModelChoiceAnswer | undefined {
  const answer = decision?.answers?.[id];
  return answer?.type === "choice" ? answer : undefined;
}

export function findCandidate(observation: CompactGoalObservation, candidateId: string) {
  if (observation.screen.semantics !== "current") return undefined;
  return observation.candidates.find((item) => item.id === candidateId);
}

export function hasSelector(
  target: CompactGoalObservation["candidates"][number]["target"],
): boolean {
  return Boolean(target.identifier || target.ref || target.label || target.point);
}

/** Tap admission: a proven-enabled, non-editable control with a selector. */
export function safeCandidate(observation: CompactGoalObservation, candidateId: string) {
  const candidate = findCandidate(observation, candidateId);
  if (!candidate || candidate.kind !== "control" || !candidate.enabled) return undefined;
  // Assumed-enabled is presentation data, not proven actionability (GOAL-04).
  if (candidate.enabledAssumed) return undefined;
  if (isEditableGoalControl(candidate.role, candidate.target.identifier)) return undefined;
  if (!hasSelector(candidate.target)) return undefined;
  return candidate;
}

/** Fill admission: a proven-enabled editable control with a selector. */
export function fillCandidate(observation: CompactGoalObservation, candidateId: string) {
  const candidate = findCandidate(observation, candidateId);
  if (!candidate || candidate.kind !== "control" || !candidate.enabled) return undefined;
  if (candidate.enabledAssumed) return undefined;
  if (!isEditableGoalControl(candidate.role, candidate.target.identifier)) return undefined;
  if (!hasSelector(candidate.target)) return undefined;
  return candidate;
}

/** Synthetic loop primitives are always offered with current semantics. */
export function systemCandidate(observation: CompactGoalObservation, candidateId: string) {
  const candidate = findCandidate(observation, candidateId);
  if (!candidate || !candidate.id.startsWith("sys-")) return undefined;
  return candidate;
}

/** Frame binding for browser-device control inputs. Stale sequences are
 * rejected server-side BEFORE dispatch, which is what makes a bounded retry
 * safe. */
export type BrowserFrameBinding = { sessionId: string; pageId: string; sequence: number };

export async function currentBrowserFrame(
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
export async function dispatchGoalAction(
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
      input: {
        ...bound,
        expectedSequence: binding.sequence,
        kind: "click",
        x: point.x,
        y: point.y,
      },
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

export function interactionFor(candidate: {
  target: GoalSessionInteractionTarget;
  /** iOS accessibility identifiers are sparse and often not uniquely
   * resolvable (system Settings rows carry none); its reliable selector is
   * the localized label. Other platforms keep identifier-first. */
  platform?: string;
}): GoalSessionAction["interaction"] {
  // Keep every observed targeting fact: the semantic selector drives native
  // dispatch, and the observed point drives frame-bound browser control.
  const target = { ...candidate.target };
  if (candidate.platform === "ios") {
    if (candidate.target.label) return { kind: "label", target };
    if (candidate.target.identifier) return { kind: "identifier", target };
  } else {
    if (candidate.target.identifier) return { kind: "identifier", target };
    if (candidate.target.ref) return { kind: "ref", target };
    if (candidate.target.label) return { kind: "label", target };
  }
  if (candidate.target.ref) return { kind: "ref", target };
  if (candidate.target.label) return { kind: "label", target };
  if (candidate.target.point) return { kind: "point", target };
  throw new TypeError("Goal candidate has no actionable selector.");
}

export function interactionInput(
  record: GoalSessionRecord,
  action: GoalSessionAction,
  targetId?: string,
) {
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
    ...(selector.point ? { point: { x: selector.point.x, y: selector.point.y } } : {}),
  };
}

export function isOutcomeUnknown(error: unknown): boolean {
  const message = normalizeError(error).toLowerCase();
  return message.includes("outcome-unknown") || message.includes("outcome unknown");
}

/** Classify a dispatch failure that arrived after intent was persisted. Only
 * a server admission/validation refusal (HTTP 4xx) proves the input never
 * reached the target. Transport failures, overloads, aborts, and anything
 * ambiguous stay unknown until reconciled — a socket that closed after a
 * request was submitted is not evidence of rejection. */
export function isProvablePreDispatchRejection(error: unknown): boolean {
  if (error && typeof error === "object" && "status" in error) {
    const status = error.status;
    if (typeof status === "number") return status >= 400 && status < 500;
  }
  return false;
}

export function result(record: GoalSessionRecord): GoalSessionResult {
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

export function stop(
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

export async function resolveTarget(
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
    const runtimeSessionId = device.session.sessionId ?? opened.session.sessionId ?? undefined;
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
        ...(opened.session.sessionId ? { runtimeSessionId: opened.session.sessionId } : {}),
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

export async function ensureFreshBrowserTarget(
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

export function reproductionEvidenceRefs(
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

export function findingEvidenceRefs(record: GoalSessionRecord): string[] {
  return [
    ...(record.actions.at(-1)?.evidenceRefs ?? []),
    ...(record.observations.at(-1)?.evidenceRefs ?? []),
  ].slice(0, MAX_EVIDENCE_REFS);
}

export function findingForStop(
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

export function appendFinding(
  record: GoalSessionRecord,
  finding: GoalFinding | undefined,
): GoalSessionRecord {
  if (!finding) return record;
  const findings = [...(record.findings ?? []).filter((item) => item.id !== finding.id), finding];
  return { ...record, findings };
}
