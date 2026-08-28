import type {
  CombineCampaign,
  DurableWorkflowOperationOutput,
  OfflineTestPreflightFinding,
  OperationOutput,
} from "@relay/protocol";
import { repeatSpecSchema } from "@relay/protocol";
import { parseCanonicalJob } from "./job-projection.js";
import type { RelayOperationPort } from "./operation-port.js";
import { snapshotFromRepeatRecord } from "./repeat-projection.js";
import type {
  FrozenRepeatTestIdentity,
  DurableRepeatTestDecision,
  DurableWorkflowHandle,
  RepeatOutcomeCounts,
  RepeatTestDecision,
  RepeatTestIntent,
  RepeatTestRecoveryIntent,
  RepeatTestSnapshot,
  WorkflowProblem,
  WorkflowRef,
} from "./types.js";
import { executionRiskPreflightProblem, isExecutionRisk } from "./execution-risk-preflight.js";
import {
  decodeRepeatWorkflowRef,
  encodeRepeatWorkflowRef,
  type RepeatWorkflowReference,
} from "./workflow-ref.js";
import {
  RepeatSpecResolutionError,
  resolveRepeatSpec,
  resolvedRepeatSelection,
} from "./repeat-spec.js";

type ValidCompile = {
  preflight: OperationOutput<"app-map.test.compile">["preflight"];
  blockers: OfflineTestPreflightFinding[];
};

const emptyOutcomes = (selected: number): RepeatOutcomeCounts => ({
  selected,
  observed: 0,
  untouched: 0,
  running: 0,
  passed: 0,
  failed: 0,
  needsReview: 0,
  cancelled: 0,
});

function publicDetail(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Relay did not return a usable response.";
}

function sourceCode(error: unknown): string | undefined {
  if (error instanceof RepeatSpecResolutionError) return error.code;
  if (!error || typeof error !== "object") return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === "string") return direct;
  const body = (error as { body?: unknown }).body;
  if (!body || typeof body !== "object") return undefined;
  const code = (body as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function unavailableProblem(stage: string, error: unknown): WorkflowProblem {
  return {
    code: "operation-unavailable",
    title: `Relay could not ${stage}`,
    detail: publicDetail(error),
    recovery: "Resolve the reported Relay problem, then explicitly inspect or start again.",
    retryable: true,
    ...(sourceCode(error) ? { sourceCode: sourceCode(error) } : {}),
  };
}

function mutationUnknownProblem(action: string, error: unknown): WorkflowProblem {
  return {
    code: "mutation-outcome-unknown",
    title: `Relay cannot prove whether ${action}`,
    detail: publicDetail(error),
    recovery:
      "Inspect durable Repeat state before taking another action. Relay will not retry this mutation.",
    retryable: false,
  };
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validId(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value === value.trim();
}

function validateIntent(intent: RepeatTestIntent): string | undefined {
  if (!validId(intent.appMapId) || !validId(intent.testId) || !validId(intent.target.targetId)) {
    return "App Map, Test, and target identifiers must be non-empty and must not have surrounding whitespace.";
  }
  if (!repeatSpecSchema.safeParse(intent.repeat).success)
    return "The Repeat specification is invalid.";
  const screenIds = intent.capture?.fullSurfaceScreenIds;
  if (
    screenIds &&
    (!screenIds.length ||
      screenIds.some((id) => !validId(id)) ||
      new Set(screenIds).size !== screenIds.length)
  ) {
    return "Full-surface screen identifiers must be non-empty and unique.";
  }
  return undefined;
}

function initialProblem(input: {
  intent: RepeatTestIntent;
  problem: WorkflowProblem;
  frozen?: FrozenRepeatTestIdentity;
  phase?: RepeatTestSnapshot["phase"];
}): RepeatTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "repeat-test",
    title: `Repeat ${input.intent.testId || "Test"}`,
    phase: input.phase ?? "blocked",
    stage: "unstarted",
    version: "unstarted",
    ...(input.frozen ? { frozen: input.frozen } : {}),
    outcomes: emptyOutcomes(0),
    results: [],
    progress: { label: input.problem.title },
    allowedNextActions: [],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

function readCompile(
  output: OperationOutput<"app-map.test.compile">,
  identity: { appMapId: string; appMapRevision: number; testId: string },
): ValidCompile | undefined {
  const preflight = output.preflight;
  if (
    !preflight ||
    preflight.schemaVersion !== 1 ||
    preflight.mode !== "offline-test-preflight" ||
    preflight.appMapId !== identity.appMapId ||
    preflight.appMapRevision !== identity.appMapRevision ||
    preflight.testId !== identity.testId ||
    typeof preflight.planDigest !== "string" ||
    !preflight.planDigest ||
    !preflight.summary ||
    !validRevision(preflight.summary.blockers) ||
    !isExecutionRisk(preflight.executionRisk) ||
    !Array.isArray(preflight.findings)
  ) {
    return undefined;
  }
  const blockers = preflight.findings.filter((finding): finding is OfflineTestPreflightFinding =>
    Boolean(
      finding &&
      typeof finding === "object" &&
      finding.severity === "blocker" &&
      typeof finding.code === "string" &&
      typeof finding.message === "string",
    ),
  );
  if (blockers.length !== preflight.summary.blockers) return undefined;
  return { preflight, blockers };
}

function unknownSnapshot(input: {
  ref: WorkflowRef;
  reference: RepeatWorkflowReference;
  problem: WorkflowProblem;
}): RepeatTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "repeat-test",
    title: `Repeat ${input.reference.frozen.testId}`,
    phase: "needs-attention",
    stage: "unknown",
    version: "unavailable",
    ref: input.ref,
    frozen: input.reference.frozen,
    repeat: { id: input.reference.repeatId },
    outcomes: emptyOutcomes(input.reference.selectedCaseIds.length),
    results: [],
    progress: { label: input.problem.title },
    allowedNextActions: ["inspect"],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

function unavailableDurableRepeat(input: {
  workflow: DurableWorkflowHandle;
  problem: WorkflowProblem;
  frozen?: FrozenRepeatTestIdentity;
}): RepeatTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "repeat-test",
    title: `Repeat ${input.frozen?.testId ?? "Test"}`,
    phase: "needs-attention",
    stage: "unknown",
    version: "unavailable",
    workflow: input.workflow,
    ...(input.frozen ? { frozen: input.frozen } : {}),
    outcomes: emptyOutcomes(0),
    results: [],
    progress: { label: input.problem.title },
    allowedNextActions: ["inspect"],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

function durableRepeatSnapshot(output: DurableWorkflowOperationOutput): RepeatTestSnapshot {
  const record = output.workflow.record;
  const frozen = record.frozenIdentity as FrozenRepeatTestIdentity;
  const campaign = output.campaign as CombineCampaign | undefined;
  const repeat = campaign?.execution?.repeat;
  if (
    record.kind !== "repeat-test" ||
    record.resource?.kind !== "campaign" ||
    !campaign ||
    !repeat ||
    campaign.id !== record.resource.id
  ) {
    return unavailableDurableRepeat({
      workflow: { workflowId: record.workflowId, expectedVersion: record.version },
      frozen,
      problem: {
        code: "malformed-response",
        title: "Relay could not inspect this durable Repeat",
        detail: "The workflow did not resolve to one matching canonical campaign.",
        recovery: "Inspect this workflow again. Do not start or resume another Repeat.",
        retryable: true,
      },
    });
  }
  const reference: RepeatWorkflowReference = {
    schemaVersion: 1,
    kind: "repeat-test",
    repeatId: campaign.id,
    pilotJobId: repeat.pilotJobId,
    selectedCaseIds: [...repeat.selectedCaseIds],
    frozen,
  };
  try {
    const snapshot = snapshotFromRepeatRecord({
      workflow: { workflowId: record.workflowId, expectedVersion: record.version },
      reference,
      record: campaign,
    });
    if (record.status !== "needs-attention") return snapshot;
    return {
      ...snapshot,
      phase: "needs-attention",
      stage: "unknown",
      progress: { label: "The Repeat mutation outcome needs inspection" },
      allowedNextActions: ["inspect"],
      problems: [
        ...snapshot.problems,
        {
          code: "mutation-outcome-unknown",
          title: "Relay cannot prove the last Repeat mutation",
          detail: `The durable workflow stopped at ${record.lastTransition}.`,
          recovery:
            "Inspect canonical campaign evidence and resolve this workflow before issuing another decision.",
          retryable: false,
        },
      ],
    };
  } catch (error) {
    return unavailableDurableRepeat({
      workflow: { workflowId: record.workflowId, expectedVersion: record.version },
      frozen,
      problem: {
        code: "malformed-response",
        title: "Relay rejected inconsistent durable Repeat identity",
        detail: publicDetail(error),
        recovery: "Inspect campaign evidence and resolve the identity mismatch before continuing.",
        retryable: false,
      },
    });
  }
}

export class CanonicalRepeatWorkflow {
  constructor(private readonly operations: RelayOperationPort) {}

  async start(intent: RepeatTestIntent): Promise<RepeatTestSnapshot> {
    const invalid = validateIntent(intent);
    if (invalid) {
      return initialProblem({
        intent,
        problem: {
          code: "invalid-intent",
          title: "The Repeat intent is invalid",
          detail: invalid,
          recovery: "Choose at least one Repeat dimension and valid values, then start again.",
          retryable: false,
        },
      });
    }

    let map: OperationOutput<"app-map.get">["appMap"];
    try {
      map = (await this.operations.invoke("app-map.get", { appMapId: intent.appMapId })).appMap;
    } catch (error) {
      return initialProblem({ intent, problem: unavailableProblem("read the current App", error) });
    }
    let requestedRevision: number;
    if (intent.revision && intent.revision !== "current") {
      requestedRevision = intent.revision.exact;
      if (!validRevision(requestedRevision)) {
        return initialProblem({
          intent,
          problem: {
            code: "invalid-intent",
            title: "The requested revision is invalid",
            detail: "An exact App Map revision must be a non-negative integer.",
            recovery: "Choose current or provide a valid exact revision.",
            retryable: false,
          },
        });
      }
    } else {
      requestedRevision = map.revision;
      if (!validRevision(requestedRevision)) {
        return initialProblem({
          intent,
          problem: unavailableProblem("read the current App", "The App has no valid revision."),
        });
      }
    }

    let resolved;
    try {
      resolved = resolveRepeatSpec(map, intent.repeat);
    } catch (error) {
      const code = sourceCode(error);
      return initialProblem({
        intent,
        problem: {
          code:
            code === "REPEAT_VALUE_NOT_FOUND"
              ? "repeat-value-unresolved"
              : code === "REPEAT_PILOT_CASE_INVALID"
                ? "repeat-pilot-invalid"
                : "repeat-dimension-unresolved",
          title: "Relay could not resolve this Repeat",
          detail: publicDetail(error),
          recovery: "Repair the saved dimension, values, or pilot selection, then start again.",
          retryable: false,
          ...(code ? { sourceCode: code } : {}),
        },
      });
    }
    const selection = resolvedRepeatSelection(resolved);

    let compiled: OperationOutput<"app-map.test.compile">;
    try {
      compiled = await this.operations.invoke("app-map.test.compile", {
        appMapId: intent.appMapId,
        testId: intent.testId,
      });
    } catch (error) {
      return initialProblem({ intent, problem: unavailableProblem("compile the Test", error) });
    }
    const checked = readCompile(compiled, {
      appMapId: intent.appMapId,
      appMapRevision: requestedRevision,
      testId: intent.testId,
    });
    if (!checked) {
      return initialProblem({
        intent,
        problem: {
          code: "malformed-response",
          title: "Relay could not verify the compiled Test",
          detail: "The compile result did not match the requested Test and frozen revision.",
          recovery: "Do not start this Repeat until the response or revision conflict is resolved.",
          retryable: false,
        },
      });
    }
    if (checked.blockers.length) {
      const primary = checked.blockers[0]!;
      return initialProblem({
        intent,
        problem: {
          code: "compile-blocked",
          title: `The Test has ${checked.blockers.length} compile blocker${checked.blockers.length === 1 ? "" : "s"}`,
          detail: primary.message,
          recovery: "Repair the reviewed Test evidence or selector, then start again.",
          retryable: false,
          sourceCode: primary.code,
        },
      });
    }

    const riskProblem = executionRiskPreflightProblem(
      checked.preflight.executionRisk,
      intent.confirmRisk,
    );
    if (riskProblem) return initialProblem({ intent, problem: riskProblem });

    const evidence = intent.evidence ?? "visual";
    let durable: DurableWorkflowHandle | undefined;
    if (intent.continuation === "durable") {
      if (!validId(intent.workflowRequestId) || !validId(intent.actorId)) {
        return initialProblem({
          intent,
          problem: {
            code: "invalid-intent",
            title: "The durable Repeat identity is incomplete",
            detail: "Durable Repeat requires one stable request ID and actor ID.",
            recovery: "Start through the outcome workflow so Relay can reserve the request.",
            retryable: false,
          },
        });
      }
      const requestIdentity = {
        actorId: intent.actorId,
        workflowRequestId: intent.workflowRequestId,
        appMapId: intent.appMapId,
        requestedAppMapRevision: requestedRevision,
        testId: intent.testId,
        testPlanDigest: checked.preflight.planDigest,
        target: { ...intent.target },
        repeat: structuredClone(intent.repeat),
        resolved: structuredClone(resolved),
        evidence,
        ...(intent.sourceRevision ? { sourceRevision: { ...intent.sourceRevision } } : {}),
        ...(intent.capture
          ? { capture: { fullSurfaceScreenIds: [...intent.capture.fullSurfaceScreenIds] } }
          : {}),
      };
      let created: OperationOutput<"workflow.create">;
      try {
        created = await this.operations.invoke("workflow.create", {
          workflowId: intent.workflowRequestId,
          kind: "repeat-test",
          frozenIdentity: requestIdentity,
        });
      } catch (error) {
        return initialProblem({
          intent,
          problem: unavailableProblem("reserve the durable Repeat workflow", error),
        });
      }
      if (created.disposition === "existing") {
        return this.inspectDurable(
          created.workflow.record.workflowId,
          created.workflow.record.version,
        );
      }
      try {
        const reserved = await this.operations.invoke("workflow.transition", {
          workflowId: created.workflow.record.workflowId,
          expectedVersion: created.workflow.record.version,
          action: "reserve-repeat-pilot",
        });
        durable = {
          workflowId: reserved.workflow.record.workflowId,
          expectedVersion: reserved.workflow.record.version,
        };
      } catch (error) {
        return unavailableDurableRepeat({
          workflow: {
            workflowId: created.workflow.record.workflowId,
            expectedVersion: created.workflow.record.version,
          },
          problem: mutationUnknownProblem("the pilot reservation completed", error),
        });
      }
    }
    let started: OperationOutput<"app-map.test.run">;
    try {
      started = await this.operations.invoke("app-map.test.run", {
        appMapId: intent.appMapId,
        testId: intent.testId,
        expectedRevision: requestedRevision,
        target: { ...intent.target },
        in: selection,
        strategy: resolved.strategy,
        ...(resolved.pilot.mode === "specified" ? { pilotCase: { ...resolved.pilot.case } } : {}),
        lens: evidence,
        executionMode: "pilot",
        repeatRecovery: {
          schemaVersion: 1,
          testPlanDigest: checked.preflight.planDigest,
          spec: structuredClone(intent.repeat),
          resolved: structuredClone(resolved),
          ...(durable
            ? {
                workflowMutation: {
                  schemaVersion: 1,
                  workflowId: durable.workflowId,
                  transitionVersion: durable.expectedVersion,
                  action: "repeat-pilot",
                  completedAt: Date.now(),
                },
              }
            : {}),
        },
        ...(intent.sourceRevision ? { sourceRevision: { ...intent.sourceRevision } } : {}),
        ...(intent.capture
          ? {
              surfaceCapture: { forceRecaptureScreenIds: [...intent.capture.fullSurfaceScreenIds] },
            }
          : {}),
      });
    } catch (error) {
      if (durable) return this.inspectDurable(durable.workflowId, durable.expectedVersion);
      return initialProblem({
        intent,
        phase: "needs-attention",
        problem: mutationUnknownProblem("the pilot started", error),
      });
    }

    const job = parseCanonicalJob(started.job);
    const jobs = Array.isArray(started.jobs) ? started.jobs.map(parseCanonicalJob) : [];
    const repeat = started.campaign;
    const generated = started.combine;
    const identity = started.planIdentity;
    if (
      !job ||
      jobs.length !== 1 ||
      !jobs[0] ||
      jobs[0].id !== job.id ||
      !repeat ||
      !validId(repeat.id) ||
      !Array.isArray(repeat.selectedCellIds) ||
      repeat.selectedCellIds.some((id) => !validId(id)) ||
      !generated ||
      !validId(generated.id) ||
      !validRevision(generated.revision) ||
      identity.appMapId !== intent.appMapId ||
      identity.appMapRevision !== generated.revision ||
      identity.testId !== intent.testId ||
      !validId(identity.rootRecipeId)
    ) {
      if (durable) {
        return unavailableDurableRepeat({
          workflow: durable,
          problem: mutationUnknownProblem(
            "the pilot started",
            "The start response failed frozen execution identity validation.",
          ),
        });
      }
      return initialProblem({
        intent,
        phase: "needs-attention",
        problem: mutationUnknownProblem(
          "the pilot started",
          "The start response failed frozen execution identity validation.",
        ),
      });
    }
    if (
      repeat.selectedCellIds.length === 0 ||
      new Set(repeat.selectedCellIds).size !== repeat.selectedCellIds.length
    ) {
      if (durable) {
        return unavailableDurableRepeat({
          workflow: durable,
          problem: mutationUnknownProblem(
            "the pilot started",
            "The start response did not identify every selected Repeat case exactly once.",
          ),
        });
      }
      return initialProblem({
        intent,
        phase: "needs-attention",
        problem: mutationUnknownProblem(
          "the pilot started",
          "The start response did not identify every selected Repeat case exactly once.",
        ),
      });
    }

    const frozen: FrozenRepeatTestIdentity = {
      ...(intent.actorId ? { actorId: intent.actorId } : {}),
      ...(intent.workflowRequestId ? { workflowRequestId: intent.workflowRequestId } : {}),
      appMapId: intent.appMapId,
      requestedAppMapRevision: requestedRevision,
      executionAppMapRevision: generated.revision,
      testId: intent.testId,
      testPlanDigest: checked.preflight.planDigest,
      rootRecipeId: identity.rootRecipeId,
      target: { ...intent.target },
      repeat: structuredClone(intent.repeat),
      resolved: structuredClone(resolved),
      evidence,
      ...(intent.sourceRevision ? { sourceRevision: { ...intent.sourceRevision } } : {}),
      ...(intent.capture
        ? { capture: { fullSurfaceScreenIds: [...intent.capture.fullSurfaceScreenIds] } }
        : {}),
    };
    const reference: RepeatWorkflowReference = {
      schemaVersion: 1,
      kind: "repeat-test",
      repeatId: repeat.id,
      pilotJobId: job.id,
      selectedCaseIds: [...repeat.selectedCellIds],
      frozen,
    };
    if (durable) {
      try {
        return durableRepeatSnapshot(
          await this.operations.invoke("workflow.transition", {
            workflowId: durable.workflowId,
            expectedVersion: durable.expectedVersion,
            action: "attach-repeat",
            campaignId: repeat.id,
          }),
        );
      } catch {
        return this.inspectDurable(durable.workflowId, durable.expectedVersion);
      }
    }
    const ref = encodeRepeatWorkflowRef(reference);
    return this.readRecord(ref, reference);
  }

  async recover(intent: RepeatTestRecoveryIntent): Promise<RepeatTestSnapshot> {
    let record: CombineCampaign | null;
    try {
      record = (
        await this.operations.invoke("job.combine.campaign.repeat.active", {
          appMapId: intent.appMapId,
          testId: intent.testId,
        })
      ).campaign;
    } catch (error) {
      return this.recoveryProblem(
        intent,
        unavailableProblem("look for unfinished Repeat work", error),
        "needs-attention",
      );
    }
    if (!record) {
      return this.recoveryProblem(intent, {
        code: "operation-unavailable",
        title: "No unfinished Repeat was found",
        detail: "Relay has no durable unfinished Repeat for this Test.",
        recovery: "Start a new Repeat explicitly when you are ready.",
        retryable: false,
      });
    }

    try {
      const identity = record.execution?.repeat;
      if (
        !identity ||
        record.appMapId !== intent.appMapId ||
        identity.testId !== intent.testId ||
        identity.executionAppMapRevision !== record.sourceRevision
      ) {
        throw new TypeError("The durable Repeat has no matching adoption identity");
      }
      const reference: RepeatWorkflowReference = {
        schemaVersion: 1,
        kind: "repeat-test",
        repeatId: record.id,
        pilotJobId: identity.pilotJobId,
        selectedCaseIds: [...identity.selectedCaseIds],
        frozen: {
          appMapId: record.appMapId,
          requestedAppMapRevision: identity.requestedAppMapRevision,
          executionAppMapRevision: identity.executionAppMapRevision,
          testId: identity.testId,
          testPlanDigest: identity.testPlanDigest,
          rootRecipeId: identity.rootRecipeId,
          target: structuredClone(identity.target),
          repeat: structuredClone(identity.spec),
          resolved: structuredClone(identity.resolved),
          evidence: identity.evidence,
          ...(identity.sourceRevision
            ? { sourceRevision: structuredClone(identity.sourceRevision) }
            : {}),
          ...(identity.capture ? { capture: structuredClone(identity.capture) } : {}),
        },
      };
      const ref = encodeRepeatWorkflowRef(reference);
      const decoded = decodeRepeatWorkflowRef(ref);
      if (!decoded) throw new TypeError("The durable Repeat adoption identity is malformed");
      return snapshotFromRepeatRecord({ ref, reference: decoded, record });
    } catch (error) {
      return this.recoveryProblem(
        intent,
        {
          code: "malformed-response",
          title: "Relay could not safely adopt this Repeat",
          detail: publicDetail(error),
          recovery: "Inspect Runs and resolve the inconsistent durable identity before continuing.",
          retryable: false,
        },
        "needs-attention",
      );
    }
  }

  async inspectDurable(workflowId: string, fallbackVersion = 1): Promise<RepeatTestSnapshot> {
    try {
      return durableRepeatSnapshot(await this.operations.invoke("workflow.get", { workflowId }));
    } catch (error) {
      return unavailableDurableRepeat({
        workflow: { workflowId, expectedVersion: fallbackVersion },
        problem: {
          ...unavailableProblem("inspect the durable Repeat workflow", error),
          recovery:
            "Restore Relay connectivity, then inspect this workflow ID again. Do not start another Repeat.",
        },
      });
    }
  }

  async advanceDurable(decision: DurableRepeatTestDecision): Promise<RepeatTestSnapshot> {
    const resume = decision.action !== "cancel";
    let reserved: DurableWorkflowOperationOutput;
    try {
      reserved = await this.operations.invoke("workflow.transition", {
        workflowId: decision.workflowId,
        expectedVersion: decision.expectedVersion,
        action: resume ? "reserve-repeat-resume" : "reserve-repeat-cancel",
        ...(decision.action === "confirm-and-continue" ? { reviewed: true } : {}),
      });
    } catch (error) {
      const inspected = await this.inspectDurable(decision.workflowId, decision.expectedVersion);
      return {
        ...inspected,
        problems: [
          ...inspected.problems,
          mutationUnknownProblem("the Repeat decision was reserved", error),
        ],
      };
    }
    const resource = reserved.workflow.record.resource;
    const frozen = reserved.workflow.record.frozenIdentity as FrozenRepeatTestIdentity;
    if (resource?.kind !== "campaign") {
      return unavailableDurableRepeat({
        workflow: {
          workflowId: decision.workflowId,
          expectedVersion: reserved.workflow.record.version,
        },
        frozen,
        problem: {
          code: "malformed-response",
          title: "Relay could not resolve the canonical Repeat campaign",
          detail: "The reserved workflow did not retain one campaign resource.",
          recovery: "Inspect this workflow. Do not issue the decision again.",
          retryable: false,
        },
      });
    }
    const mutation = {
      schemaVersion: 1 as const,
      workflowId: decision.workflowId,
      transitionVersion: reserved.workflow.record.version,
      action: resume ? ("repeat-resume" as const) : ("repeat-cancel" as const),
      completedAt: Date.now(),
    };
    try {
      if (resume) {
        await this.operations.invoke("job.combine.campaign.resume", {
          batchId: resource.id,
          expectedAppMapRevision: frozen.executionAppMapRevision,
          ...(decision.action === "confirm-and-continue" ? { reviewed: true } : {}),
          workflowMutation: mutation,
        });
      } else {
        await this.operations.invoke("job.combine.campaign.cancel", {
          batchId: resource.id,
          workflowMutation: mutation,
        });
      }
      return durableRepeatSnapshot(
        await this.operations.invoke("workflow.transition", {
          workflowId: decision.workflowId,
          expectedVersion: reserved.workflow.record.version,
          action: resume ? "complete-repeat-resume" : "complete-repeat-cancel",
        }),
      );
    } catch {
      return this.inspectDurable(decision.workflowId, reserved.workflow.record.version);
    }
  }

  async inspect(ref: WorkflowRef, reference: RepeatWorkflowReference) {
    return this.readRecord(ref, reference);
  }

  async adoptAndAdvance(
    decision: RepeatTestDecision,
    reference: RepeatWorkflowReference,
  ): Promise<RepeatTestSnapshot> {
    let adopted: DurableWorkflowOperationOutput;
    try {
      adopted = await this.operations.invoke("workflow.create", { legacyRef: decision.ref });
    } catch (error) {
      return unknownSnapshot({
        ref: decision.ref,
        reference,
        problem: {
          ...unavailableProblem("adopt this legacy Repeat safely", error),
          recovery:
            "Inspect this legacy Repeat only. Do not continue or cancel until Relay can create an authorized durable workflow.",
        },
      });
    }
    const current = durableRepeatSnapshot(adopted);
    if (!current.workflow || current.version === "unavailable") return current;
    if (current.version !== decision.expectedVersion) {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "stale-workflow-version",
            title: "This Repeat changed before the decision",
            detail: "The supplied workflow version no longer matches durable execution state.",
            recovery: "Review the latest snapshot and explicitly choose the next action again.",
            retryable: true,
          },
        ],
      };
    }
    if (!current.allowedNextActions.includes(decision.action)) {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "unexpected-authoring-state",
            title: "This Repeat is not ready for that decision",
            detail: `${decision.action} is not allowed while the Repeat is ${current.stage}.`,
            recovery: "Use a decision listed in allowedNextActions on the latest snapshot.",
            retryable: false,
          },
        ],
      };
    }
    return this.advanceDurable({
      action: decision.action,
      workflowId: current.workflow.workflowId,
      expectedVersion: current.workflow.expectedVersion,
    });
  }

  private async readRecord(
    ref: WorkflowRef,
    reference: RepeatWorkflowReference,
  ): Promise<RepeatTestSnapshot> {
    try {
      const output = await this.operations.invoke("job.combine.campaign.get", {
        batchId: reference.repeatId,
      });
      return snapshotFromRepeatRecord({ ref, reference, record: output.campaign });
    } catch (error) {
      return unknownSnapshot({
        ref,
        reference,
        problem: unavailableProblem("inspect durable Repeat state", error),
      });
    }
  }

  private recoveryProblem(
    intent: RepeatTestRecoveryIntent,
    problem: WorkflowProblem,
    phase: RepeatTestSnapshot["phase"] = "blocked",
  ): RepeatTestSnapshot {
    return {
      schemaVersion: 1,
      kind: "repeat-test",
      title: `Repeat ${intent.testId}`,
      phase,
      stage: phase === "blocked" ? "unstarted" : "unknown",
      version: phase === "blocked" ? "unstarted" : "unavailable",
      outcomes: emptyOutcomes(0),
      results: [],
      progress: { label: problem.title },
      allowedNextActions: [],
      problems: [problem],
      evidenceRefs: [],
    };
  }
}
