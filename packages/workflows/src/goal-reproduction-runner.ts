import { compactGoalObservation } from "@relay/core";
import type {
  CompactGoalObservation,
  GoalFinding,
  GoalReproductionRecord,
  GoalSessionAction,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStopCode,
} from "@relay/protocol";
import { GOAL_FINDING_SCHEMA_VERSION, GOAL_SESSION_MAX_ACTIONS } from "@relay/protocol";
import {
  appendFinding,
  findingForStop,
  findingEvidenceRefs,
  interactionInput,
  isOutcomeUnknown,
  normalizeError,
  observationCapabilities,
  observationSignals,
  recentActions,
  reproductionEvidenceRefs,
  result,
  MAX_ERROR_CHARS,
} from "./goal-session-support.js";
import type { RelayOperationPort } from "./operation-port.js";

export type GoalReproductionRunnerOptions = {
  record: GoalSessionRecord;
  operations: RelayOperationPort;
  now: () => number;
  persist: (record: GoalSessionRecord) => Promise<void>;
};

function assertOpenedTarget(
  resultValue: { session: { targetId: string } },
  targetId: string,
): void {
  if (resultValue.session.targetId !== targetId) {
    throw new TypeError(
      `Relay opened target ${resultValue.session.targetId}, but the goal requested ${targetId}.`,
    );
  }
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

export async function runGoalReproduction(
  options: GoalReproductionRunnerOptions,
): Promise<GoalSessionResult> {
  let record = options.record;
  const { operations, now, persist } = options;
  if (record.reproduction && record.reproduction.status !== "running") return result(record);
  if (record.pendingAction) {
    record = stopGoal(
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
    operations,
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
      status: status === "reproduced" ? "reproduced" : status === "uncertain" ? "open" : "blocked",
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
      ].slice(0, 8),
      source: "fresh-reproduction",
      createdAt: at,
      updatedAt: at,
      requiresReview: true,
    };
    reproduction = {
      ...reproduction,
      status,
      pendingAction: undefined,
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
  if (!ensured.exists || reproduction.actions.length === 0) {
    const opened = await operations.invoke("target.open", {
      targetId,
      ...(record.target.authenticationFixtureReference
        ? { authenticationFixtureReference: record.target.authenticationFixtureReference }
        : { signedOut: true as const }),
      presentation: "embedded",
    });
    assertOpenedTarget(opened, targetId);
  }
  await saveReproduction();

  const captureReproduction = async (): Promise<CompactGoalObservation> => {
    const observation = await operations.invoke("target.observation.capture", { serial: targetId });
    const compact = compactGoalObservation({
      goal: record.goal,
      sessionId: reproduction.id,
      targetId,
      platform: "browser",
      app: observation.foregroundApp,
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
    reproduction = {
      ...reproduction,
      lastObservation: compact,
      observations: [
        ...reproduction.observations,
        {
          step: reproduction.actions.length,
          observationDigest: compact.observationDigest,
          capturedAt: observation.capturedAt,
          evidenceRefs: reproductionEvidenceRefs(
            record.id,
            reproduction.id,
            observation,
            compact.observationDigest,
          ),
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
      const interactionResult = await operations.invoke(
        "target.interact",
        interactionInput({ ...record, target: reproduction.target }, action, targetId),
      );
      if (
        "iosMutation" in interactionResult &&
        interactionResult.iosMutation?.outcome === "outcome-unknown"
      ) {
        throw new Error("target interaction outcome-unknown; review required before resume");
      }
      reproduction = {
        ...reproduction,
        actions: reproduction.actions.map((item) =>
          item.id === action.id ? { ...item, status: "acknowledged", at: now() } : item,
        ),
        pendingAction: undefined,
      };
      await saveReproduction();
    } catch (error) {
      const unknown = isOutcomeUnknown(error);
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
                evidenceRefs: [...new Set([...item.evidenceRefs, ...refs])].slice(0, 8),
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
}

function stopGoal(
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
