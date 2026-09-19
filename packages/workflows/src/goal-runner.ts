import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  compactGoalObservation,
  createOpenRouterDecisionProvider,
  DEFAULT_OPENROUTER_DECISION_MODEL,
  findWorkspaceRoot,
  type ModelDecisionProvider,
} from "@relay/core";
import type {
  CompactGoalObservation,
  GoalSessionAction,
  GoalSessionBudget,
  GoalSessionInteractionTarget,
  GoalSessionRecord,
  GoalSessionResult,
  GoalSessionStartInput,
  GoalSessionStopCode,
  ModelChoiceAnswer,
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
  appendFinding,
  evidenceRefs,
  findingForStop,
  interactionInput,
  isOutcomeUnknown,
  normalizeError,
  observationCapabilities,
  observationSignals,
  recentActions,
  result,
  MAX_ERROR_CHARS,
  MAX_EVIDENCE_REFS,
} from "./goal-session-support.js";
import type { RelayOperationPort } from "./operation-port.js";

const MAX_GOAL_CHARS = 2_048;

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
};

export type GoalSessionRunner = {
  start(input: GoalSessionStartInput): Promise<GoalSessionResult>;
  resume(sessionId: string): Promise<GoalSessionResult>;
  reproduce(sessionId: string): Promise<GoalSessionResult>;
  inspect(sessionId: string): Promise<GoalSessionRecord>;
};

function goalStoreRoot(): string {
  const state = process.env.RELAY_STATE_DIR?.trim() || join(findWorkspaceRoot(), ".relay");
  return join(state, "goals");
}

function validId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u.test(value);
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

function choiceAnswer(
  decision: ModelDecisionRecord | undefined,
  id: string,
): ModelChoiceAnswer | undefined {
  const answer = decision?.answers?.[id];
  return answer?.type === "choice" ? answer : undefined;
}

function safeCandidate(observation: CompactGoalObservation, candidateId: string) {
  if (observation.screen.semantics !== "current") return undefined;
  const candidate = observation.candidates.find((item) => item.id === candidateId);
  if (!candidate || candidate.kind !== "control" || !candidate.enabled) return undefined;
  if (
    /(?:text(?:box|field)?|textarea|input|editable|password|email)/iu.test(candidate.role ?? "")
  ) {
    return undefined;
  }
  const target = candidate.target;
  if (!target.identifier && !target.ref && !target.label && !target.point) return undefined;
  return candidate;
}

function interactionFor(candidate: {
  target: GoalSessionInteractionTarget;
}): GoalSessionAction["interaction"] {
  if (candidate.target.identifier) {
    return { kind: "identifier", target: { identifier: candidate.target.identifier } };
  }
  if (candidate.target.ref) return { kind: "ref", target: { ref: candidate.target.ref } };
  if (candidate.target.label) return { kind: "label", target: { label: candidate.target.label } };
  if (candidate.target.point) return { kind: "point", target: { point: candidate.target.point } };
  throw new TypeError("Goal candidate has no actionable selector.");
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
    return {
      target: {
        targetId,
        platform: targetPlatform("browser"),
        startUrl: url.toString(),
        ...(input.laneId ? { laneId: input.laneId } : {}),
        ...(input.authenticationFixtureReference
          ? { authenticationFixtureReference: input.authenticationFixtureReference }
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

export function createGoalSessionRunner(options: GoalSessionRunnerOptions): GoalSessionRunner {
  const store = options.store ?? createFileStore();
  const provider = options.decisionProvider ?? createOpenRouterDecisionProvider();
  const now = options.now ?? Date.now;
  const id = options.id ?? randomUUID;
  const locks = new Map<string, Promise<GoalSessionResult>>();

  const persist = async (record: GoalSessionRecord): Promise<void> => {
    await store.save({ ...record, updatedAt: now() });
  };

  const capture = async (record: GoalSessionRecord): Promise<CompactGoalObservation> => {
    const observation = await options.operations.invoke("target.observation.capture", {
      serial: record.target.targetId,
    });
    const compact = compactGoalObservation({
      goal: record.goal,
      sessionId: record.id,
      targetId: record.target.targetId,
      platform: record.target.platform,
      app: observation.foregroundApp,
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

  const run = async (starting: GoalSessionRecord): Promise<GoalSessionResult> => {
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

      const candidates = observation.candidates.filter((candidate) =>
        safeCandidate(observation, candidate.id),
      );
      const criteria: Record<string, string | null> = {
        none: "No safe action should be executed from this observation.",
        ...Object.fromEntries(
          candidates.map((candidate) => [
            candidate.id,
            `${candidate.label ?? candidate.text ?? candidate.role ?? "control"} (${candidate.id})`,
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
      const candidate = safeCandidate(observation, candidateId);
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
      const interaction = interactionFor(candidate);
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
        const interactionResult = await options.operations.invoke(
          "target.interact",
          interactionInput(record, action),
        );
        if (
          "iosMutation" in interactionResult &&
          interactionResult.iosMutation?.outcome === "outcome-unknown"
        ) {
          throw new Error("target interaction outcome-unknown; review required before resume");
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
      } catch (error) {
        const unknown = isOutcomeUnknown(error);
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
    async start(input) {
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
        status: "running",
        step: 0,
        createdAt: at,
        updatedAt: at,
        observations: [],
        actions: [],
        findings: [],
      };
      await store.save(record);
      return exclusive(sessionId, () => run(record));
    },
    async resume(sessionId) {
      assertSessionId(sessionId);
      const record = await store.load(sessionId);
      if (!record) throw new TypeError(`Goal session ${sessionId} was not found.`);
      return exclusive(sessionId, async () => {
        const current = (await store.load(sessionId)) ?? record;
        const awaitingExplicitReview =
          current.stopReason?.code === "action-uncertain" ||
          current.stopReason?.code === "resume-review-required";
        if (current.pendingAction !== undefined && !awaitingExplicitReview) {
          return run(current);
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
        return run(resumed);
      });
    },
    async reproduce(sessionId) {
      assertSessionId(sessionId);
      const loaded = await store.load(sessionId);
      if (!loaded) throw new TypeError(`Goal session ${sessionId} was not found.`);
      return exclusive(sessionId, async () =>
        runGoalReproduction({
          record: (await store.load(sessionId)) ?? loaded,
          operations: options.operations,
          now,
          persist,
        }),
      );
    },
    async inspect(sessionId) {
      assertSessionId(sessionId);
      const record = await store.load(sessionId);
      if (!record) throw new TypeError(`Goal session ${sessionId} was not found.`);
      return record;
    },
  };
}
