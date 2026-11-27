import {
  accountFixtureIdsFromListed,
  bindRequestedBrowserIdentity,
} from "@relay/protocol/browser/browser-execution-identity";
import type { AuthoringTarget, OperationInput, OperationOutput } from "@relay/protocol";
import type { RelayOperationPort } from "./operation-port.js";
import { parseCanonicalJob, snapshotFromJob } from "./job-projection.js";
import type {
  FrozenRunTestIdentity,
  RunTestIntent,
  RunTestSnapshot,
  WorkflowProblem,
  WorkflowSnapshot,
} from "./types.js";
import { encodeRunWorkflowRef } from "./workflow-ref.js";
import { executionRiskPreflightProblem } from "./execution-risk-preflight.js";
import { queuedRunIdentityFromJob } from "./run-workflow-execution-identity.js";
import {
  mutationUnknownWorkflowProblem as mutationUnknownProblem,
  unavailableWorkflowProblem as unavailableProblem,
} from "./workflow-problems.js";
import {
  authoritativePreDispatch,
  durableRunSnapshot,
  frozenIdentity,
  unavailableDurableRun,
  preDispatchProblem,
  preDispatchProblemReason,
  readCompile,
  resolveRunTestLane,
  selectBrowserTargetProfile,
  skipsBrowserEvidenceProfileSelection,
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

export async function startRunTest(
  operations: RelayOperationPort,
  rawIntent: RunTestIntent,
): Promise<RunTestSnapshot> {
  let intent = rawIntent;
  if (rawIntent.laneId && !rawIntent.target) {
    const resolved = await resolveRunTestLane(operations, rawIntent);
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
  let appMapDocument: OperationOutput<"app-map.get">["appMap"] | undefined;
  const readAppMapDocument = async () => {
    if (!appMapDocument) {
      appMapDocument = (await operations.invoke("app-map.get", { appMapId: intent.appMapId }))
        .appMap;
    }
    return appMapDocument;
  };
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
      revision = (await readAppMapDocument()).revision;
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
    compiled = await operations.invoke("app-map.test.compile", {
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
    // A plain-English Test carries no recorded screen evidence, so no saved
    // evidence profile can ever match it. Server admission derives the
    // managed browser environment for the exact target instead, but only
    // when the Run arrives without an explicit profile, account, or engine.
    let runsEntirelyFromText = false;
    if (!intent.account && !intent.engine) {
      try {
        runsEntirelyFromText = skipsBrowserEvidenceProfileSelection(
          intent,
          (await readAppMapDocument()).tests[intent.testId],
        );
      } catch (error) {
        return initialProblem({
          intent,
          compiled: checkedCompile,
          problem: unavailableProblem("read the current App Map", error),
        });
      }
    }
    try {
      if (!runsEntirelyFromText) {
        targetProfileId = await selectBrowserTargetProfile(
          operations,
          checkedCompile,
          target.targetId,
        );
      }
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
      exactCompiled = await operations.invoke("app-map.test.compile", {
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
            await operations.invoke("target.browser-auth.list", {
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
      durable = await operations.invoke("workflow.create", {
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
        const existing = await operations.invoke("workflow.get", {
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
    run = await operations.invoke("app-map.test.run", runInput);
  } catch (error) {
    if (authoritativePreDispatch(error)) {
      const problem = preDispatchProblem(error);
      if (durable) {
        try {
          const abandoned = await operations.invoke("workflow.transition", {
            workflowId: durable.workflow.record.workflowId,
            expectedVersion: durable.workflow.record.version,
            action: "abandon-run",
            reason: preDispatchProblemReason(problem),
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
      const attached = await operations.invoke("workflow.transition", {
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
