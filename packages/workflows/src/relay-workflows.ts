import {
  accountFixtureIdsFromListed,
  bindRequestedBrowserIdentity,
} from "@relay/core/browser-execution-identity";
import type { AuthoringTarget, OperationInput, OperationOutput } from "@relay/protocol";
import {
  createRelayOperationPort,
  type RelayInvokeClient,
  type RelayOperationPort,
} from "./operation-port.js";
import { parseCanonicalJob, snapshotFromJob } from "./job-projection.js";
import { CanonicalAuthoringWorkflow } from "./authoring-workflow.js";
import { CanonicalRepeatWorkflow } from "./repeat-workflow.js";
import type {
  AuthorTestDecision,
  AuthorTestIntent,
  AuthorTestRecoveryIntent,
  AuthorTestSnapshot,
  DurableWorkflowHandle,
  FrozenRunTestIdentity,
  RelayWorkflows,
  RepeatTestDecision,
  RepeatTestIntent,
  RepeatTestRecoveryIntent,
  RepeatTestSnapshot,
  RunTestRecoveryIntent,
  RunTestIntent,
  RunTestSnapshot,
  WorkflowDecision,
  WorkflowIntent,
  WorkflowProblem,
  WorkflowRecoveryIntent,
  WorkflowRef,
  WorkflowSnapshot,
} from "./types.js";
import {
  decodeAuthoringWorkflowRef,
  decodeRepeatWorkflowRef,
  decodeRunWorkflowRef,
  encodeRunWorkflowRef,
  type RunWorkflowReference,
} from "./workflow-ref.js";
import { executionRiskPreflightProblem } from "./execution-risk-preflight.js";
import { invalidRefSnapshot } from "./invalid-workflow-snapshot.js";
import { readRunJob } from "./run-workflow-job-inspection.js";
import { queuedRunIdentityFromJob } from "./run-workflow-execution-identity.js";
import {
  mutationUnknownWorkflowProblem as mutationUnknownProblem,
  unavailableWorkflowProblem as unavailableProblem,
  workflowErrorDetail as errorDetail,
} from "./workflow-problems.js";
import {
  authoritativePreDispatch,
  durableRunSnapshot,
  frozenIdentity,
  unavailableDurableRun,
  preDispatchProblem,
  readCompile,
  resolveRunTestLane,
  selectBrowserTargetProfile,
  type ValidCompile,
  validRevision,
  BrowserTargetProfileSelectionError,
} from "./run-workflow-support.js";

function initialProblem(input: {
  intent: RunTestIntent;
  problem: WorkflowProblem;
  frozen?: FrozenRunTestIdentity;
  phase?: WorkflowSnapshot["phase"];
  compiled?: ValidCompile;
}): RunTestSnapshot {
  return {
    schemaVersion: 1,
    kind: "run-test",
    title: `Run ${input.intent.testId}`,
    phase: input.phase ?? "blocked",
    version: "unstarted",
    ...(input.frozen ? { frozen: input.frozen } : {}),
    ...(input.compiled
      ? { compiled: { plan: input.compiled.plan, preflight: input.compiled.preflight } }
      : {}),
    progress: { label: input.problem.title },
    allowedNextActions: [],
    problems: [input.problem],
    evidenceRefs: [],
  };
}

class CanonicalRelayWorkflows implements RelayWorkflows {
  private readonly authoring: CanonicalAuthoringWorkflow;
  private readonly repeat: CanonicalRepeatWorkflow;

  constructor(private readonly operations: RelayOperationPort) {
    this.authoring = new CanonicalAuthoringWorkflow(operations);
    this.repeat = new CanonicalRepeatWorkflow(operations);
  }

  async start(intent: RunTestIntent): Promise<RunTestSnapshot>;
  async start(intent: AuthorTestIntent): Promise<AuthorTestSnapshot>;
  async start(intent: RepeatTestIntent): Promise<RepeatTestSnapshot>;
  async start(intent: WorkflowIntent): Promise<WorkflowSnapshot> {
    if (intent.kind === "author-test") return this.authoring.start(intent);
    if (intent.kind === "repeat-test") return this.repeat.start(intent);
    return this.startRunTest(intent);
  }

  async recover(intent: AuthorTestRecoveryIntent): Promise<AuthorTestSnapshot>;
  async recover(intent: RepeatTestRecoveryIntent): Promise<RepeatTestSnapshot>;
  async recover(intent: RunTestRecoveryIntent): Promise<RunTestSnapshot>;
  async recover(intent: WorkflowRecoveryIntent): Promise<WorkflowSnapshot> {
    if (intent.kind === "run-test") return this.recoverRunTest(intent);
    return intent.kind === "author-test"
      ? this.authoring.recover(intent)
      : this.repeat.recover(intent);
  }

  private async recoverRunTest(intent: RunTestRecoveryIntent): Promise<RunTestSnapshot> {
    const unavailable = (problem: WorkflowProblem): RunTestSnapshot => ({
      schemaVersion: 1,
      kind: "run-test",
      title: `Run ${intent.frozen.testId}`,
      phase: "needs-attention",
      version: "recovery-needed",
      frozen: intent.frozen,
      progress: { label: problem.title },
      allowedNextActions: [],
      problems: [problem],
      evidenceRefs: [],
    });
    let summaries: OperationOutput<"job.list">["jobs"];
    try {
      ({ jobs: summaries } = await this.operations.invoke("job.list", { limit: 100 }));
    } catch (error) {
      return unavailable({
        ...unavailableProblem("inspect canonical jobs", error),
        recovery:
          "Restore Relay connectivity, then inspect this uncertain Run again. Do not start another Run.",
      });
    }
    const recent = summaries.filter((job) => job.queuedAt >= intent.startedAfter - 1_000);
    const matches: Array<{
      job: NonNullable<ReturnType<typeof parseCanonicalJob>>;
      frozen: FrozenRunTestIdentity;
      compiled?: ValidCompile;
    }> = [];
    for (const summary of recent) {
      try {
        const output = await this.operations.invoke("job.get", { jobId: summary.id });
        const raw = output.job as unknown as Record<string, unknown>;
        const job = parseCanonicalJob(raw);
        if (!job) continue;
        const identity = queuedRunIdentityFromJob({
          frozen: intent.frozen,
          job: raw,
          matchPlanDigest: !intent.frozen.workflowRequestId,
        });
        if (identity.status !== "verified") continue;
        matches.push({ job, frozen: identity.frozen, compiled: identity.compiled });
      } catch {
        // One unreadable candidate cannot justify retrying a possibly completed mutation.
      }
    }
    if (matches.length !== 1) {
      return unavailable({
        code: "mutation-outcome-unknown",
        title:
          matches.length > 1
            ? "More than one canonical Run matches this request"
            : "Relay has not found the uncertain Run yet",
        detail:
          matches.length > 1
            ? "Relay cannot choose one Run without risking attribution to the wrong execution."
            : "The enqueue may still be persisting, or its canonical job is not currently readable.",
        recovery:
          "Inspect this uncertain Run again after Relay is available. Do not start another Run.",
        retryable: false,
      });
    }
    const match = matches[0]!;
    const frozen = match.frozen;
    const ref = encodeRunWorkflowRef({
      schemaVersion: 1,
      kind: "run-test",
      jobId: match.job.id,
      frozen,
    });
    return {
      ...snapshotFromJob({ ref, frozen, job: match.job }),
      ...(match.compiled
        ? { compiled: { plan: match.compiled.plan, preflight: match.compiled.preflight } }
        : {}),
    };
  }

  private async startRunTest(rawIntent: RunTestIntent): Promise<RunTestSnapshot> {
    let intent = rawIntent;
    if (rawIntent.laneId && !rawIntent.target) {
      const resolved = await resolveRunTestLane(this.operations, rawIntent);
      if ("problem" in resolved) {
        return initialProblem({ intent: rawIntent, problem: resolved.problem });
      }
      intent = resolved.intent;
    }
    const target = intent.target;
    if (!target) {
      return initialProblem({
        intent,
        problem: {
          code: "invalid-intent",
          title: "The Run has no target",
          detail: "Choose a device, a browser, or a saved Lane that carries the who-and-where.",
          recovery: "Start the Run again with --device or --lane.",
          retryable: false,
        },
      });
    }
    if (intent.continuation === "durable" && !intent.workflowRequestId) {
      return initialProblem({
        intent,
        problem: {
          code: "invalid-intent",
          title: "The durable Run has no stable request identity",
          detail: "Server-owned continuation requires one request ID before any Run mutation.",
          recovery: "Create a new Run workflow with one stable workflow request ID.",
          retryable: false,
        },
      });
    }
    let revision: number;
    if (intent.revision && intent.revision !== "current") {
      revision = intent.revision.exact;
      if (!validRevision(revision)) {
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
      try {
        const current = await this.operations.invoke("app-map.get", { appMapId: intent.appMapId });
        revision = current.appMap.revision;
        if (!validRevision(revision)) throw new TypeError("App Map response has no valid revision");
      } catch (error) {
        return initialProblem({
          intent,
          problem: unavailableProblem("read the current App Map", error),
        });
      }
    }

    let compiled: OperationOutput<"app-map.test.compile">;
    try {
      compiled = await this.operations.invoke("app-map.test.compile", {
        appMapId: intent.appMapId,
        testId: intent.testId,
        ...(intent.startup?.mode === "verified-checkpoint"
          ? { entryCheckpointScreenId: intent.startup.screenId }
          : {}),
        ...(intent.startup?.mode === "cold" || intent.startup?.mode === "warm"
          ? { startupMode: intent.startup.mode }
          : {}),
        ...(intent.targetProfileId ? { targetProfileId: intent.targetProfileId } : {}),
        ...(intent.capture
          ? { forceRecaptureScreenIds: [...intent.capture.fullSurfaceScreenIds] }
          : {}),
      });
    } catch (error) {
      return initialProblem({ intent, problem: unavailableProblem("compile the Test", error) });
    }

    let checkedCompile = readCompile(compiled, {
      appMapId: intent.appMapId,
      appMapRevision: revision,
      testId: intent.testId,
    });
    if (!checkedCompile) {
      return initialProblem({
        intent,
        problem: {
          code: "malformed-response",
          title: "Relay could not verify the compiled Test",
          detail:
            "The compile result did not match the requested App Map, Test, and frozen revision.",
          recovery:
            "Do not run this Test until the operation response or revision conflict is resolved.",
          retryable: false,
        },
      });
    }

    const deferNativeProfile = target.kind === "device" && !intent.targetProfileId;
    const requireNativeProfile =
      deferNativeProfile &&
      (checkedCompile.plan.rawAccessibilityTargetProfiles ?? []).some(
        (profile) => profile.targetId === target.targetId && profile.platform === target.platform,
      );
    if (requireNativeProfile && !intent.workflowRequestId) {
      intent = { ...intent, workflowRequestId: crypto.randomUUID() };
    }
    let targetProfileId = intent.targetProfileId;
    if (!targetProfileId && intent.account?.kind === "signed-out") {
      targetProfileId = undefined;
    } else if (!targetProfileId && target.kind === "browser") {
      try {
        targetProfileId = await selectBrowserTargetProfile(
          this.operations,
          checkedCompile,
          target.targetId,
        );
      } catch (error) {
        return initialProblem({
          intent,
          compiled: checkedCompile,
          problem:
            error instanceof BrowserTargetProfileSelectionError
              ? {
                  code: "compile-blocked",
                  title: error.setupChanged
                    ? "This browser’s setup changed since recording"
                    : error.ambiguous
                      ? "Relay can’t tell which saved setup to use"
                      : "This Test wasn’t recorded on this browser",
                  detail: error.message,
                  recovery: error.setupChanged
                    ? "Record the Test again on this browser, or restore the browser’s previous setup in Devices."
                    : error.ambiguous
                      ? "Record the Test again on this browser so it has one saved setup."
                      : error.recordedOn.length
                        ? `Run it on ${error.recordedOn[0]}, or record it once on this browser.`
                        : "Record it once on this browser, then run it again.",
                  retryable: false,
                  sourceCode: error.sourceCode,
                }
              : unavailableProblem("resolve the current browser evidence profile", error),
        });
      }
    }
    const effectiveIntent: RunTestIntent & { target: AuthoringTarget } = targetProfileId
      ? { ...intent, target, targetProfileId }
      : { ...intent, target };
    if (targetProfileId && targetProfileId !== intent.targetProfileId) {
      let exactCompiled: OperationOutput<"app-map.test.compile">;
      try {
        exactCompiled = await this.operations.invoke("app-map.test.compile", {
          appMapId: intent.appMapId,
          testId: intent.testId,
          targetProfileId,
          ...(intent.startup?.mode === "verified-checkpoint"
            ? { entryCheckpointScreenId: intent.startup.screenId }
            : {}),
          ...(intent.startup?.mode === "cold" || intent.startup?.mode === "warm"
            ? { startupMode: intent.startup.mode }
            : {}),
          ...(intent.capture
            ? { forceRecaptureScreenIds: [...intent.capture.fullSurfaceScreenIds] }
            : {}),
        });
      } catch (error) {
        return initialProblem({
          intent: effectiveIntent,
          problem: unavailableProblem("compile the Test for the selected target", error),
        });
      }
      const checkedExactCompile = readCompile(exactCompiled, {
        appMapId: intent.appMapId,
        appMapRevision: revision,
        testId: intent.testId,
      });
      if (!checkedExactCompile) {
        return initialProblem({
          intent: effectiveIntent,
          problem: {
            code: "malformed-response",
            title: "Relay could not verify the target-scoped Test",
            detail:
              "The exact target compile did not match the requested App Map, Test, and frozen revision.",
            recovery:
              "Do not run this Test until the selected evidence profile compiles canonically.",
            retryable: false,
          },
        });
      }
      checkedCompile = checkedExactCompile;
    }

    const provisionalFrozen = frozenIdentity(
      effectiveIntent,
      revision,
      checkedCompile.preflight.planDigest,
    );
    // The canonical Run selects the current native setup and repeats preflight
    // for that exact profile. Every other preliminary blocker stays a gate.
    const blockers = deferNativeProfile
      ? checkedCompile.blockers.filter(
          (finding) => finding.code !== "raw-evidence-variant-selection-required",
        )
      : checkedCompile.blockers;
    if (blockers.length) {
      const primary = blockers[0]!;
      return initialProblem({
        intent: effectiveIntent,
        frozen: provisionalFrozen,
        compiled: checkedCompile,
        problem: {
          code: "compile-blocked",
          title: `The Test has ${blockers.length} compile blocker${blockers.length === 1 ? "" : "s"}`,
          detail: primary.message,
          recovery: "Repair the reviewed Test evidence or selector, then start a new workflow.",
          retryable: false,
          sourceCode: primary.code,
        },
      });
    }

    const riskProblem = executionRiskPreflightProblem(
      checkedCompile.preflight.executionRisk,
      intent.confirmRisk,
    );
    if (riskProblem) {
      return initialProblem({
        intent: effectiveIntent,
        frozen: provisionalFrozen,
        compiled: checkedCompile,
        problem: riskProblem,
      });
    }

    if (intent.account || intent.engine) {
      const profiles = checkedCompile.plan.rawAccessibilityTargetProfiles ?? [];
      const profile = targetProfileId
        ? profiles.find((item) => item.id === targetProfileId)
        : profiles.length === 1
          ? profiles[0]
          : undefined;
      const saved = profile?.browserCaseProfile;
      const listed =
        target.kind === "browser" && intent.account?.kind === "fixture"
          ? (
              await this.operations.invoke("target.browser-auth.list", {
                targetId: target.targetId,
              })
            ).fixtures
          : [];
      const bound = bindRequestedBrowserIdentity({
        requested: {
          ...(intent.engine ? { engine: intent.engine } : {}),
          ...(intent.account ? { account: intent.account } : {}),
        },
        saved: {
          ...(saved?.engine ? { engine: saved.engine } : {}),
          ...(saved?.authenticationFixtureId
            ? { authenticationFixtureId: saved.authenticationFixtureId }
            : {}),
        },
        platform: target.kind === "browser" ? "browser" : target.platform,
        accountFixtureIds: accountFixtureIdsFromListed(listed),
      });
      if (bound.status === "blocked") {
        return initialProblem({
          intent: effectiveIntent,
          compiled: checkedCompile,
          problem: {
            code: "compile-blocked",
            title: "The selected account does not match the saved runtime profile",
            detail: bound.reason,
            recovery:
              "Use the exact saved account fixture revision, or capture a matching runtime profile before running.",
            retryable: false,
          },
        });
      }
    }

    const frozen = frozenIdentity(effectiveIntent, revision, checkedCompile.preflight.planDigest);

    let durable: OperationOutput<"workflow.create"> | undefined;
    if (intent.continuation === "durable" && intent.workflowRequestId) {
      try {
        durable = await this.operations.invoke("workflow.create", {
          workflowId: intent.workflowRequestId,
          kind: "run-test",
          frozenIdentity: frozen,
        });
      } catch (error) {
        return initialProblem({
          intent,
          frozen,
          compiled: checkedCompile,
          problem: unavailableProblem("reserve the durable Run workflow", error),
        });
      }
      if (durable.disposition === "existing") {
        try {
          const existing = await this.operations.invoke("workflow.get", {
            workflowId: durable.workflow.record.workflowId,
          });
          const snapshot = durableRunSnapshot(existing);
          const queuedIdentity = snapshot.frozen
            ? queuedRunIdentityFromJob({ frozen: snapshot.frozen, job: existing.job })
            : undefined;
          if (queuedIdentity?.status === "invalid") {
            return unavailableDurableRun({
              workflow: snapshot.workflow!,
              frozen: snapshot.frozen,
              ...(snapshot.execution ? { jobId: snapshot.execution.jobId } : {}),
              problem: mutationUnknownProblem(
                "the existing Run was reconciled",
                "The queued Run report failed identity validation.",
              ),
            });
          }
          const completedCompile =
            queuedIdentity?.status === "verified" && queuedIdentity.compiled
              ? queuedIdentity.compiled
              : checkedCompile;
          return {
            ...snapshot,
            compiled: { plan: completedCompile.plan, preflight: completedCompile.preflight },
          };
        } catch (error) {
          return {
            ...unavailableDurableRun({
              workflow: {
                workflowId: durable.workflow.record.workflowId,
                expectedVersion: durable.workflow.record.version,
              },
              frozen,
              problem: mutationUnknownProblem("the existing Run was reconciled", error),
            }),
            compiled: { plan: checkedCompile.plan, preflight: checkedCompile.preflight },
          };
        }
      }
    }

    const runInput: OperationInput<"app-map.test.run"> = {
      appMapId: intent.appMapId,
      testId: intent.testId,
      ...(intent.laneId
        ? { laneId: intent.laneId }
        : { expectedRevision: revision, target: { ...target } }),
      ...(intent.laneId
        ? {}
        : {
            ...(targetProfileId ? { targetProfileId } : {}),
            ...(intent.engine ? { engine: intent.engine } : {}),
            ...(intent.account ? { account: intent.account } : {}),
          }),
      ...(intent.startup ? { startup: { ...intent.startup } } : {}),
      ...(intent.variables ? { variables: { ...intent.variables } } : {}),
      ...(intent.sourceRevision ? { sourceRevision: { ...intent.sourceRevision } } : {}),
      ...(intent.capture
        ? { surfaceCapture: { forceRecaptureScreenIds: [...intent.capture.fullSurfaceScreenIds] } }
        : {}),
      ...(intent.workflowRequestId ? { workflowRequestId: intent.workflowRequestId } : {}),
    };
    let run: OperationOutput<"app-map.test.run">;
    try {
      run = await this.operations.invoke("app-map.test.run", runInput);
    } catch (error) {
      if (authoritativePreDispatch(error)) {
        const problem = preDispatchProblem(error);
        if (durable) {
          try {
            const abandoned = await this.operations.invoke("workflow.transition", {
              workflowId: durable.workflow.record.workflowId,
              expectedVersion: durable.workflow.record.version,
              action: "abandon-run",
              reason: problem.detail,
            });
            return {
              ...durableRunSnapshot(abandoned),
              ...(problem.sourceCode === "TARGET_VIEWPORT_UNAVAILABLE"
                ? { problems: [problem], progress: { label: problem.title } }
                : {}),
              compiled: { plan: checkedCompile.plan, preflight: checkedCompile.preflight },
            };
          } catch (transitionError) {
            return {
              ...unavailableDurableRun({
                workflow: {
                  workflowId: durable.workflow.record.workflowId,
                  expectedVersion: durable.workflow.record.version,
                },
                frozen,
                problem: mutationUnknownProblem(
                  "the rejected Test run was finalized",
                  transitionError,
                ),
              }),
              compiled: { plan: checkedCompile.plan, preflight: checkedCompile.preflight },
            };
          }
        }
        return initialProblem({ intent, frozen, problem });
      }
      if (durable) {
        return {
          ...unavailableDurableRun({
            workflow: {
              workflowId: durable.workflow.record.workflowId,
              expectedVersion: durable.workflow.record.version,
            },
            frozen,
            problem: mutationUnknownProblem("the Test run was queued", error),
          }),
          compiled: { plan: checkedCompile.plan, preflight: checkedCompile.preflight },
        };
      }
      return initialProblem({
        intent,
        frozen,
        phase: "needs-attention",
        problem: mutationUnknownProblem("the Test run was queued", error),
      });
    }

    const job = parseCanonicalJob(run.job);
    const identity = run.planIdentity;
    const queuedIdentity = queuedRunIdentityFromJob({
      frozen,
      job: run.job,
      requireNativeProfile,
    });
    const finalFrozen =
      queuedIdentity.status === "verified"
        ? queuedIdentity.frozen
        : queuedIdentity.status === "missing" && !requireNativeProfile
          ? { ...frozen, rootRecipeId: identity.rootRecipeId }
          : undefined;
    const responseProfile = run.plan.runtimeTargetProfile;
    const responseProfileMatches =
      !responseProfile ||
      (responseProfile.targetId === target.targetId &&
        responseProfile.platform === target.platform &&
        (!targetProfileId || responseProfile.id === targetProfileId) &&
        (queuedIdentity.status !== "verified" ||
          responseProfile.id === queuedIdentity.frozen.targetProfileId));
    if (
      !job ||
      !finalFrozen ||
      !responseProfileMatches ||
      identity.appMapId !== intent.appMapId ||
      identity.appMapRevision !== revision ||
      identity.testId !== intent.testId ||
      typeof identity.rootRecipeId !== "string" ||
      !identity.rootRecipeId ||
      finalFrozen.rootRecipeId !== identity.rootRecipeId
    ) {
      if (durable) {
        return {
          ...unavailableDurableRun({
            workflow: {
              workflowId: durable.workflow.record.workflowId,
              expectedVersion: durable.workflow.record.version,
            },
            frozen,
            ...(job ? { jobId: job.id } : {}),
            problem: mutationUnknownProblem(
              "the Test run was queued",
              "The run response failed identity validation.",
            ),
          }),
          compiled: { plan: checkedCompile.plan, preflight: checkedCompile.preflight },
        };
      }
      return initialProblem({
        intent,
        frozen,
        phase: "needs-attention",
        problem: mutationUnknownProblem(
          "the Test run was queued",
          "The run response failed identity validation.",
        ),
      });
    }

    const completedCompile =
      queuedIdentity.status === "verified" && queuedIdentity.compiled
        ? queuedIdentity.compiled
        : checkedCompile;
    if (durable) {
      try {
        const attached = await this.operations.invoke("workflow.transition", {
          workflowId: durable.workflow.record.workflowId,
          expectedVersion: durable.workflow.record.version,
          action: "attach-run",
          jobId: job.id,
        });
        return {
          ...durableRunSnapshot(attached),
          compiled: { plan: completedCompile.plan, preflight: completedCompile.preflight },
        };
      } catch (error) {
        return {
          ...unavailableDurableRun({
            workflow: {
              workflowId: durable.workflow.record.workflowId,
              expectedVersion: durable.workflow.record.version,
            },
            frozen: finalFrozen,
            jobId: job.id,
            problem: mutationUnknownProblem("the queued Run was attached", error),
          }),
          compiled: { plan: completedCompile.plan, preflight: completedCompile.preflight },
        };
      }
    }
    const ref = encodeRunWorkflowRef({
      schemaVersion: 1,
      kind: "run-test",
      jobId: job.id,
      frozen: finalFrozen,
    });
    return {
      ...snapshotFromJob({ ref, frozen: finalFrozen, job }),
      compiled: { plan: completedCompile.plan, preflight: completedCompile.preflight },
    };
  }

  async inspect(ref: WorkflowRef): Promise<WorkflowSnapshot> {
    const repeatReference = decodeRepeatWorkflowRef(ref);
    if (repeatReference) return this.repeat.inspect(ref, repeatReference);
    const authoringReference = decodeAuthoringWorkflowRef(ref);
    if (authoringReference) return this.authoring.inspect(ref, authoringReference);
    const reference = decodeRunWorkflowRef(ref);
    if (!reference) return invalidRefSnapshot(ref);
    return readRunJob(this.operations, ref, reference);
  }

  async inspectRun(workflowId: string): Promise<RunTestSnapshot> {
    try {
      return durableRunSnapshot(await this.operations.invoke("workflow.get", { workflowId }));
    } catch (error) {
      return unavailableDurableRun({
        workflow: { workflowId, expectedVersion: 1 },
        problem: {
          ...unavailableProblem("inspect the durable Run workflow", error),
          recovery:
            "Restore Relay connectivity, then inspect this workflow ID again. Do not start another Run.",
        },
      });
    }
  }

  async inspectDurable(
    workflowId: string,
  ): Promise<RunTestSnapshot | AuthorTestSnapshot | import("./types.js").RepeatTestSnapshot> {
    try {
      const output = await this.operations.invoke("workflow.get", { workflowId });
      if (output.workflow.record.kind === "author-test") {
        return this.authoring.snapshotDurable(output);
      }
      if (output.workflow.record.kind === "repeat-test") {
        return this.repeat.inspectDurable(workflowId);
      }
      return durableRunSnapshot(output);
    } catch (error) {
      return unavailableDurableRun({
        workflow: { workflowId, expectedVersion: 1 },
        problem: unavailableProblem("inspect the durable workflow", error),
      });
    }
  }

  inspectAuthoring(workflowId: string): Promise<AuthorTestSnapshot> {
    return this.authoring.inspectDurable(workflowId);
  }

  inspectRepeat(workflowId: string) {
    return this.repeat.inspectDurable(workflowId);
  }

  advanceAuthoring(decision: import("./types.js").DurableAuthorTestDecision) {
    return this.authoring.advanceDurable(decision);
  }

  advanceRepeat(decision: import("./types.js").DurableRepeatTestDecision) {
    return this.repeat.advanceDurable(decision);
  }

  async cancelRun(input: DurableWorkflowHandle): Promise<RunTestSnapshot> {
    try {
      return durableRunSnapshot(
        await this.operations.invoke("workflow.transition", {
          workflowId: input.workflowId,
          expectedVersion: input.expectedVersion,
          action: "cancel-run",
        }),
      );
    } catch (error) {
      try {
        const inspected = durableRunSnapshot(
          await this.operations.invoke("workflow.get", { workflowId: input.workflowId }),
        );
        return {
          ...inspected,
          problems: [
            ...inspected.problems,
            mutationUnknownProblem("the exact Run was cancelled", error),
          ],
        };
      } catch {
        // A failed read cannot justify issuing the cancellation again.
      }
      return unavailableDurableRun({
        workflow: input,
        problem: mutationUnknownProblem("the exact Run was cancelled", error),
      });
    }
  }

  async advance(decision: WorkflowDecision): Promise<WorkflowSnapshot> {
    const repeatReference = decodeRepeatWorkflowRef(decision.ref);
    if (repeatReference) {
      return this.repeat.adoptAndAdvance(decision as RepeatTestDecision, repeatReference);
    }
    const authoringReference = decodeAuthoringWorkflowRef(decision.ref);
    if (authoringReference) {
      return this.authoring.advance(decision as AuthorTestDecision, authoringReference);
    }
    const reference = decodeRunWorkflowRef(decision.ref);
    if (!reference) return invalidRefSnapshot(decision.ref);
    const current = await readRunJob(this.operations, decision.ref, reference);
    if (!current.execution || current.version === "unavailable") return current;
    if (current.version !== decision.expectedVersion) {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "stale-workflow-version",
            title: "This run changed before cancellation",
            detail: "The supplied workflow version no longer matches the canonical job.",
            recovery:
              "Review the latest snapshot and explicitly cancel again only if it is still active.",
            retryable: true,
          },
        ],
      };
    }
    if (decision.action !== "cancel") {
      return {
        ...current,
        problems: [
          ...current.problems,
          {
            code: "unexpected-authoring-state",
            title: "This decision does not apply to a Test run",
            detail: `The ${decision.action} decision belongs to an Authoring Session.`,
            recovery: "Use a decision allowed by the latest workflow snapshot.",
            retryable: false,
          },
        ],
      };
    }
    if (!current.allowedNextActions.includes("cancel")) return current;

    try {
      const cancelled = await this.operations.invoke("job.cancel", { jobId: reference.jobId });
      const job = parseCanonicalJob(cancelled.job);
      if (!job || job.id !== reference.jobId) {
        throw new TypeError("Cancellation response does not identify the requested job");
      }
      return snapshotFromJob({ ref: decision.ref, frozen: reference.frozen, job });
    } catch (error) {
      return {
        ...current,
        phase: "needs-attention",
        allowedNextActions: ["inspect"],
        problems: [
          ...current.problems,
          mutationUnknownProblem("the exact run was cancelled", error),
        ],
        progress: { label: "Cancellation outcome needs inspection" },
      };
    }
  }
}

export function createRelayWorkflows(client: RelayInvokeClient): RelayWorkflows {
  return new CanonicalRelayWorkflows(createRelayOperationPort(client));
}
