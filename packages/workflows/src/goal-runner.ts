import { randomUUID } from "node:crypto";
import {
  compactGoalObservation,
  createOpenRouterDecisionProvider,
  DEFAULT_OPENROUTER_DECISION_MODEL,
  isEditableGoalControl,
  type ModelDecisionProvider,
} from "@relay/core";
import type {
  CompactGoalObservation,
  GoalSessionAction,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStartInput,
  ModelDecisionRecord,
} from "@relay/protocol";
import {
  GOAL_SESSION_MAX_ACTIONS,
  GOAL_SESSION_MAX_DURATION_MS,
  GOAL_SESSION_MAX_STEPS,
  GOAL_SESSION_SCHEMA_VERSION,
} from "@relay/protocol";
import { runGoalReproduction } from "./goal-reproduction-runner.js";
import {
  assertSessionId,
  boundedBudget,
  boundedGoal,
  choiceAnswer,
  createFileStore,
  currentBrowserFrame,
  dispatchGoalAction,
  evidenceRefs,
  fillCandidate,
  isOutcomeUnknown,
  isProvablePreDispatchRejection,
  interactionFor,
  normalizeError,
  observationCapabilities,
  observationSignals,
  recentActions,
  resolveTarget,
  result,
  safeCandidate,
  stop,
  systemCandidate,
  MAX_EVIDENCE_REFS,
} from "./goal-session-support.js";
import type { BrowserFrameBinding, GoalSessionStore } from "./goal-session-support.js";
export type { GoalSessionStore } from "./goal-session-support.js";
import type { RelayOperationPort } from "./operation-port.js";

export type GoalSessionRunnerOptions = {
  operations: RelayOperationPort;
  decisionProvider?: ModelDecisionProvider;
  store?: GoalSessionStore;
  now?: () => number;
  id?: () => string;
  signal?: AbortSignal;
};

export type GoalSessionCallOptions = {
  signal?: AbortSignal;
};

export type GoalSessionRunner = {
  start(input: GoalSessionStartInput, call?: GoalSessionCallOptions): Promise<GoalSessionResult>;
  resume(sessionId: string, call?: GoalSessionCallOptions): Promise<GoalSessionResult>;
  reproduce(sessionId: string, call?: GoalSessionCallOptions): Promise<GoalSessionResult>;
  inspect(sessionId: string): Promise<GoalSessionRecord & { valueRefs?: string[] }>;
  cancel(sessionId: string): Promise<GoalSessionRecord>;
};

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
      if (
        candidate.kind === "control" &&
        isEditableGoalControl(candidate.role, candidate.target.identifier)
      ) {
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
        ...(input.values && Object.keys(input.values).length > 0 ? { values: input.values } : {}),
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
      const record = await store.load(sessionId);
      if (!record) throw new TypeError(`Goal session ${sessionId} was not found.`);
      return exclusive(sessionId, async () =>
        runGoalReproduction({
          record: (await store.load(sessionId)) ?? record,
          operations: options.operations,
          now,
          persist,
          signal: call?.signal,
        }),
      );
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
