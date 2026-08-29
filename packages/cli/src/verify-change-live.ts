import { changeProofRequiredRunCases, type ChangeProofRunCase } from "@relay/core";
import type { OperationInput, VerificationPlan } from "@relay/protocol";
import { invokeOperation, type OperationInvoker } from "./invoke.js";
import { CliError, ExitCode, UsageError } from "./errors.js";
import {
  VERIFY_CHANGE_DEFAULT_POLL_INTERVAL_MS,
  VERIFY_CHANGE_DEFAULT_POLL_TIMEOUT_MS,
  VERIFY_CHANGE_MAX_POLL_ATTEMPTS,
  VERIFY_CHANGE_MAX_POLL_TIMEOUT_MS,
  type VerifyChangeActorKind,
  type VerifyChangeJobPoller,
  type VerifyChangeNextAction,
  type VerifyChangePlanResult,
  type VerifyChangeSleep,
} from "./verify-change-types.js";
import { boundedText, record, verifyChangeRequestIdentity } from "./verify-change-utils.js";

const terminalProofStates = new Set([
  "proved",
  "rejected",
  "needs-review",
  "insufficient-evidence",
  "cancelled",
  "superseded",
]);
const knownJobStatuses = new Set([
  "queued",
  "running",
  "paused",
  "ok",
  "error",
  "healed",
  "cancelled",
]);
const terminalJobStatuses = new Set(["ok", "error", "healed", "cancelled"]);

export function proofRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const proof = (value as Record<string, unknown>).proof;
  return proof && typeof proof === "object" && !Array.isArray(proof)
    ? (proof as Record<string, unknown>)
    : undefined;
}

function proofState(proof: Record<string, unknown>): string | undefined {
  return typeof proof.state === "string" ? proof.state : undefined;
}

function proofVersion(proof: Record<string, unknown>): number {
  if (
    !Number.isSafeInteger(proof.version) ||
    typeof proof.version !== "number" ||
    proof.version < 1
  ) {
    throw new UsageError("Relay returned a Proof without a positive version");
  }
  return proof.version;
}

function jobRecord(value: unknown, label: string): Record<string, unknown> {
  const response = record(value, label);
  return record(response.job, `${label} job`);
}

function jobStatus(value: unknown, label: string): string {
  const job = jobRecord(value, label);
  if (typeof job.status !== "string" || !knownJobStatuses.has(job.status)) {
    throw new UsageError(`${label} returned an unknown job status`);
  }
  return job.status;
}

function jobId(value: unknown, label: string): string {
  const job = jobRecord(value, label);
  if (typeof job.id !== "string" || !job.id.trim()) {
    throw new UsageError(`${label} returned a job without an id`);
  }
  return job.id;
}

function completedRunId(value: unknown, label: string): string {
  const job = jobRecord(value, label);
  if (job.persisted !== true) {
    throw new UsageError(
      `${label} is terminal but not persisted; refusing to record a non-durable Run`,
    );
  }
  if (typeof job.id !== "string" || !job.id.trim()) {
    throw new UsageError(`${label} persisted a Run without its durable job id`);
  }
  if (job.runId !== undefined && job.runId !== job.id) {
    throw new UsageError(`${label} returned a runId different from its durable job id`);
  }
  return job.id;
}

function defaultSleep(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(new DOMException("cancelled", "AbortError"));
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(finish, milliseconds);
    signal.addEventListener("abort", cancel, { once: true });
    function finish(): void {
      signal.removeEventListener("abort", cancel);
      resolve();
    }
    function cancel(): void {
      clearTimeout(timer);
      reject(new DOMException("cancelled", "AbortError"));
    }
  });
}

async function pollVerificationJob(
  client: OperationInvoker,
  id: string,
  options: {
    signal: AbortSignal;
    timeoutMs: number;
    intervalMs: number;
    sleep: VerifyChangeSleep;
    now: () => number;
  },
): Promise<unknown> {
  const deadline = options.now() + options.timeoutMs;
  for (let attempt = 0; attempt < VERIFY_CHANGE_MAX_POLL_ATTEMPTS; attempt += 1) {
    const response = await invokeOperation(client, "job.get", { jobId: id }, options.signal);
    const status = jobStatus(response, "job.get");
    if (terminalJobStatuses.has(status) && jobRecord(response, "job.get").persisted === true) {
      // A terminal error can still have trusted failure evidence. Return it
      // once persisted so the server, not this client, derives the Proof state.
      return response;
    }
    const remaining = deadline - options.now();
    if (remaining <= 0) {
      throw new CliError(
        `Timed out waiting for pilot job ${id} after ${options.timeoutMs}ms`,
        ExitCode.connection,
        response,
      );
    }
    await options.sleep(Math.min(options.intervalMs, remaining), options.signal);
  }
  throw new CliError(
    `Exceeded ${VERIFY_CHANGE_MAX_POLL_ATTEMPTS} polls waiting for job ${id} to persist`,
    ExitCode.connection,
  );
}

function executionTargetForCase(
  targetCase: VerificationPlan["selection"]["targetCases"][number],
): OperationInput<"app-map.test.run">["target"] {
  const target = targetCase.executionTarget;
  if (target.kind === "provider-session") {
    throw new UsageError(
      `Target case ${targetCase.id} uses provider-session ${target.provider.key}; verify-change only executes local-device and local-browser targets`,
    );
  }
  return target.kind === "local-device"
    ? { kind: "device", platform: target.platform, targetId: target.targetId }
    : { kind: "browser", platform: "browser", targetId: target.targetId };
}

export function isExecutableVerificationPlan(plan: VerificationPlan): boolean {
  return (
    plan.status === "ready-for-approval" &&
    plan.coverageGaps.length === 0 &&
    plan.builds.length > 0 &&
    plan.selection.affectedJourneys.length > 0 &&
    plan.selection.targetCases.some(({ required }) => required) &&
    (plan.selection.cells?.length ?? 0) > 0 &&
    plan.pilotCellId !== undefined
  );
}

export function assertExecutablePlanTargets(plan: VerificationPlan): void {
  for (const targetCase of plan.selection.targetCases) {
    if (targetCase.required) executionTargetForCase(targetCase);
  }
  for (const targetCase of plan.selection.targetCases.filter(({ required }) => required)) {
    const platform =
      targetCase.executionTarget.platform === "browser"
        ? "web"
        : targetCase.executionTarget.platform;
    const matchingBuilds = plan.builds.filter(
      ({ platform: buildPlatform }) => buildPlatform === platform,
    );
    if (matchingBuilds.length !== 1) {
      throw new UsageError(
        `Target case ${targetCase.id} requires exactly one frozen ${platform} build; found ${matchingBuilds.length}`,
      );
    }
  }
}

function planTargetCase(
  plan: VerificationPlan,
  targetCaseId: string,
): VerificationPlan["selection"]["targetCases"][number] {
  const targetCase = plan.selection.targetCases.find(({ id }) => id === targetCaseId);
  if (!targetCase) {
    throw new UsageError(`Proof required case ${targetCaseId} is not in the reviewed plan`);
  }
  return targetCase;
}

function planBuild(plan: VerificationPlan, buildId: string): VerificationPlan["builds"][number] {
  const build = plan.builds.find(({ id }) => id === buildId);
  if (!build) throw new UsageError(`Proof required case references unknown build ${buildId}`);
  return build;
}

async function invokeProofContinue(
  client: OperationInvoker,
  proof: Record<string, unknown>,
  action: "start-pilot" | "start-required-coverage" | "record-runs",
  signal: AbortSignal,
  reason?: string,
  runIds?: readonly string[],
): Promise<{ response: unknown; proof: Record<string, unknown> }> {
  const input = {
    proofId: boundedText(proof.id, "Proof id", 256),
    expectedVersion: proofVersion(proof),
    action,
    ...(reason ? { reason } : {}),
    ...(runIds ? { runIds: [...runIds] } : {}),
  };
  const response = await invokeOperation(
    client,
    "proof.continue",
    input,
    signal,
    verifyChangeRequestIdentity(`proof-${action}`, String(proof.id), ...(runIds ?? [])),
  );
  const next = proofRecord(response);
  if (!next) throw new UsageError(`proof.continue ${action} returned no durable Proof`);
  return { response, proof: next };
}

async function invokePlanApproval(
  client: OperationInvoker,
  proof: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ response: unknown; proof: Record<string, unknown> }> {
  const proofId = boundedText(proof.id, "Proof id", 256);
  const response = await invokeOperation(
    client,
    "proof.plan.approve",
    {
      proofId,
      expectedVersion: proofVersion(proof),
      decisionId: `verify-change-${proofId}-plan-approval`.slice(0, 256),
      reason:
        "Human approval of the exact Git change, builds, affected journeys, targets, and policy.",
      confirm: true,
    },
    signal,
    verifyChangeRequestIdentity("proof-approve", proofId),
  );
  const next = proofRecord(response);
  if (!next) throw new UsageError("proof.plan.approve returned no durable Proof");
  return { response, proof: next };
}

async function runRequiredCase(input: {
  client: OperationInvoker;
  plan: VerificationPlan;
  proof: Record<string, unknown>;
  runCase: ChangeProofRunCase;
  signal: AbortSignal;
  poll?: VerifyChangeJobPoller;
  sleep: VerifyChangeSleep;
  now: () => number;
  pollIntervalMs: number;
  pollTimeoutMs: number;
}): Promise<{
  appMapId: string;
  testId: string;
  targetCaseId: string;
  jobId: string;
  runId: string;
}> {
  const targetCase = planTargetCase(input.plan, input.runCase.targetCaseId);
  const build = planBuild(input.plan, input.runCase.buildId);
  const selection = record(input.proof.selection, "Proof selection");
  const journeys = Array.isArray(selection.affectedJourneys) ? selection.affectedJourneys : [];
  const persistedJourneyValue = journeys.find((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const journey = value as Record<string, unknown>;
    return journey.appMapId === input.runCase.appMapId && journey.testId === input.runCase.testId;
  });
  if (!persistedJourneyValue || typeof persistedJourneyValue !== "object") {
    throw new UsageError("Proof required case is not present in its persisted affected journeys");
  }
  const persistedJourney = persistedJourneyValue as Record<string, unknown>;
  if (
    persistedJourney.appMapRevision !== input.runCase.appMapRevision ||
    !Number.isSafeInteger(persistedJourney.appMapRevision)
  ) {
    throw new UsageError("Proof affected journey has no matching frozen App Map revision");
  }
  const runInput: OperationInput<"app-map.test.run"> = {
    appMapId: input.runCase.appMapId,
    testId: input.runCase.testId,
    expectedRevision: input.runCase.appMapRevision,
    target: executionTargetForCase(targetCase),
    targetProfileId: targetCase.targetProfile.id,
    sourceRevision: {
      vcs: "git",
      sha: build.sourceSha,
      artifactDigest: build.artifactDigest,
      ...(targetCase.executionTarget.platform === "browser" ? {} : { buildId: build.id }),
    },
  };
  const response = await invokeOperation(
    input.client,
    "app-map.test.run",
    runInput,
    input.signal,
    verifyChangeRequestIdentity(
      "run-case",
      String(input.proof.id),
      input.runCase.appMapId,
      input.runCase.testId,
      input.runCase.appMapRevision,
      input.runCase.targetCaseId,
      input.runCase.buildId,
    ),
  );
  const responseRecord = record(response, "app-map.test.run");
  const identity = record(responseRecord.planIdentity, "app-map.test.run plan identity");
  if (
    identity.appMapId !== input.runCase.appMapId ||
    identity.testId !== input.runCase.testId ||
    identity.appMapRevision !== input.runCase.appMapRevision
  ) {
    throw new UsageError(
      "app-map.test.run returned a plan identity different from the exact request",
    );
  }
  const startedJobId = jobId(response, "app-map.test.run");
  const final = await (input.poll ?? pollVerificationJob)(input.client, startedJobId, {
    signal: input.signal,
    timeoutMs: input.pollTimeoutMs,
    intervalMs: input.pollIntervalMs,
    sleep: input.sleep,
    now: input.now,
  });
  const finalStatus = jobStatus(final, "job.get");
  if (!terminalJobStatuses.has(finalStatus)) {
    throw new UsageError(`job.get did not return a terminal job for ${startedJobId}`);
  }
  const finalJob = jobRecord(final, "job.get");
  if (finalJob.id !== startedJobId) {
    throw new UsageError(
      `job.get returned job ${String(finalJob.id)} while polling ${startedJobId}`,
    );
  }
  return {
    appMapId: input.runCase.appMapId,
    testId: input.runCase.testId,
    targetCaseId: input.runCase.targetCaseId,
    jobId: startedJobId,
    runId: completedRunId(final, "job.get"),
  };
}

export function nextVerifyChangeAction(
  plan: VerificationPlan,
  base: string,
  configFile: string,
  proof: Record<string, unknown> | undefined,
): VerifyChangeNextAction {
  if (!proof) {
    return {
      kind: "confirm",
      reason:
        "Review the exact Git change and Verification Plan, then explicitly authorize Proof creation.",
      command: `relay verify-change --base ${shellArgument(base)} --config-file ${shellArgument(configFile)} --confirm`,
    };
  }
  const state = proofState(proof);
  if (state && terminalProofStates.has(state)) {
    return {
      kind: "complete",
      reason: `The durable Proof reached terminal state ${state}.`,
      ...(typeof proof.id === "string"
        ? { command: `relay proof inspect ${shellArgument(proof.id)}` }
        : {}),
    };
  }
  const proofId = typeof proof.id === "string" ? proof.id : undefined;
  const smallest =
    proof.smallestNextVerification && typeof proof.smallestNextVerification === "object"
      ? (proof.smallestNextVerification as Record<string, unknown>)
      : undefined;
  const kind = typeof smallest?.kind === "string" ? smallest.kind : undefined;
  const reason = typeof smallest?.reason === "string" ? smallest.reason : undefined;
  if (kind === "provide-build" || plan.status === "awaiting-build") {
    return {
      kind: "provide-build",
      reason: reason ?? "Provide an exact build whose source revision matches the Proof head.",
      ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
    };
  }
  if (kind === "review" || plan.status === "needs-review") {
    return {
      kind: "review",
      reason: reason ?? "Resolve every Verification Plan coverage gap before approval.",
      ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
    };
  }
  if (kind === "run-pilot") {
    return {
      kind: "run-pilot",
      reason: "The frozen Proof is approved and ready for its deterministic pilot.",
      ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
    };
  }
  return {
    kind: "approve-plan",
    reason: reason ?? "Review and approve the exact builds, journeys, targets, and policy.",
    ...(proofId ? { command: `relay proof inspect ${shellArgument(proofId)}` } : {}),
  };
}

function shellArgument(value: string): string {
  return /^[A-Za-z0-9_./:@-]+$/u.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

export type VerifyChangeLiveExecution = {
  proof: Record<string, unknown>;
  proofApprovalResponse?: unknown;
  planApproved: boolean;
  pilot: VerifyChangePlanResult["execution"]["pilot"];
  runs: VerifyChangePlanResult["execution"]["runs"];
  terminalState?: string;
};

function recordedRunCount(proof: Record<string, unknown>): number {
  if (!Array.isArray(proof.runIds) || proof.runIds.some((id) => typeof id !== "string")) {
    throw new UsageError("Relay returned a Proof without its durable Run identities");
  }
  return proof.runIds.length;
}

function nextRequiredCaseIndex(
  proof: Record<string, unknown>,
  requiredCases: readonly ChangeProofRunCase[],
): number {
  const recorded = recordedRunCount(proof);
  if (recorded > requiredCases.length) {
    throw new UsageError("Proof records more Runs than its frozen required case matrix");
  }
  if (proofState(proof) !== "running" || recorded === requiredCases.length) return recorded;
  const next =
    proof.smallestNextVerification && typeof proof.smallestNextVerification === "object"
      ? (proof.smallestNextVerification as Record<string, unknown>)
      : undefined;
  const declared = requiredCases.findIndex(
    (item) =>
      (!next?.appMapId || next.appMapId === item.appMapId) &&
      (!next?.testId || next.testId === item.testId) &&
      (!next?.targetCaseId || next.targetCaseId === item.targetCaseId),
  );
  if (declared < 0 || declared !== recorded) {
    throw new UsageError(
      "Running Proof does not expose one deterministic next required case; refusing duplicate target control",
    );
  }
  return declared;
}

/** Execute one approved plan through pilot and required expansion. */
export async function executeVerifyChangeLive(input: {
  client: OperationInvoker;
  plan: VerificationPlan;
  proof: Record<string, unknown>;
  actorKind?: VerifyChangeActorKind;
  signal: AbortSignal;
  poll?: VerifyChangeJobPoller;
  sleep?: VerifyChangeSleep;
  now?: () => number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}): Promise<VerifyChangeLiveExecution> {
  let currentProof = input.proof;
  if (terminalProofStates.has(proofState(currentProof) ?? "")) {
    return {
      proof: currentProof,
      planApproved: false,
      pilot: {
        available: false,
        attempted: false,
        reason: `The durable Proof was already terminal (${proofState(currentProof)}); no target was controlled.`,
      },
      runs: [],
      terminalState: proofState(currentProof),
    };
  }
  let proofApprovalResponse: unknown;
  const initialState = proofState(currentProof);
  if (initialState === "planning" || initialState === "awaiting-build") {
    if ((input.actorKind ?? "human") !== "human") {
      throw new CliError(
        "Live verify-change execution requires a human actor to approve the Verification Plan; no pilot was started",
        ExitCode.auth,
        { proof: currentProof, nextAction: "human-plan-approval" },
      );
    }
    const approval = await invokePlanApproval(input.client, currentProof, input.signal);
    proofApprovalResponse = approval.response;
    currentProof = approval.proof;
  }
  if (!currentProof.planApproval) {
    throw new UsageError("Live Proof execution requires an approved frozen Verification Plan");
  }
  if (
    !["ready", "running-pilot", "awaiting-expansion", "running"].includes(
      proofState(currentProof) ?? "",
    )
  ) {
    throw new UsageError(
      `Proof state ${proofState(currentProof) ?? "unknown"} cannot resume live execution`,
    );
  }
  const requiredCases = (() => {
    try {
      return changeProofRequiredRunCases(currentProof);
    } catch (error) {
      throw new UsageError(
        `Proof has no executable required cases: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();
  if (!requiredCases.length) {
    throw new UsageError("The approved Proof has no policy-required run cases");
  }
  if (requiredCases.length > input.plan.expansion.maxCases) {
    throw new UsageError(
      `The approved Proof materializes ${requiredCases.length} Verification Cells, exceeding the plan limit of ${input.plan.expansion.maxCases}; no target was controlled`,
    );
  }
  const pollIntervalMs = input.pollIntervalMs ?? VERIFY_CHANGE_DEFAULT_POLL_INTERVAL_MS;
  const pollTimeoutMs = input.pollTimeoutMs ?? VERIFY_CHANGE_DEFAULT_POLL_TIMEOUT_MS;
  if (
    !Number.isSafeInteger(pollIntervalMs) ||
    pollIntervalMs < 0 ||
    !Number.isSafeInteger(pollTimeoutMs) ||
    pollTimeoutMs < 1 ||
    pollTimeoutMs > VERIFY_CHANGE_MAX_POLL_TIMEOUT_MS
  ) {
    throw new UsageError(
      `verify-change poll interval must be non-negative and timeout must be 1-${VERIFY_CHANGE_MAX_POLL_TIMEOUT_MS}ms`,
    );
  }
  if (proofState(currentProof) === "ready") {
    const startedPilot = await invokeProofContinue(
      input.client,
      currentProof,
      "start-pilot",
      input.signal,
      "Start the first deterministic policy-required Proof pilot case.",
    );
    currentProof = startedPilot.proof;
  }
  if (proofState(currentProof) === "running-pilot" && recordedRunCount(currentProof) !== 0) {
    throw new UsageError("Running pilot already records a Run but has no terminal transition");
  }
  const sleep = input.sleep ?? defaultSleep;
  const now = input.now ?? Date.now;
  const startedAt = now();
  const assertDurationBudget = (): void => {
    if (now() - startedAt >= input.plan.expansion.maxDurationMs) {
      throw new UsageError(
        `The Verification Plan duration budget of ${input.plan.expansion.maxDurationMs}ms expired before target control`,
      );
    }
  };
  const runSummaries: Array<VerifyChangePlanResult["execution"]["runs"][number]> = [];
  let pilot: VerifyChangePlanResult["execution"]["pilot"] = {
    available: false,
    attempted: false,
    reason: "The deterministic pilot was not completed.",
  };
  const startIndex = nextRequiredCaseIndex(currentProof, requiredCases);
  for (let index = startIndex; index < requiredCases.length; index += 1) {
    const runCase = requiredCases[index]!;
    if (index > 0) {
      const state = proofState(currentProof);
      if (terminalProofStates.has(state ?? "")) break;
      if (state === "awaiting-expansion") {
        const startedExpansion = await invokeProofContinue(
          input.client,
          currentProof,
          "start-required-coverage",
          input.signal,
          "Start the smallest remaining policy-required Proof coverage.",
        );
        currentProof = startedExpansion.proof;
      }
      if (proofState(currentProof) !== "running") {
        throw new UsageError(
          `Proof did not enter running state before required case ${runCase.targetCaseId}`,
        );
      }
    }
    assertDurationBudget();
    const run = await runRequiredCase({
      client: input.client,
      plan: input.plan,
      proof: currentProof,
      runCase,
      signal: input.signal,
      poll: input.poll,
      sleep,
      now,
      pollIntervalMs,
      pollTimeoutMs,
    });
    runSummaries.push(run);
    currentProof = (
      await invokeProofContinue(
        input.client,
        currentProof,
        "record-runs",
        input.signal,
        undefined,
        [run.runId],
      )
    ).proof;
    if (index === 0) {
      pilot = {
        available: true,
        attempted: true,
        reason: "The deterministic pilot was executed and recorded server-side.",
        targetCaseId: run.targetCaseId,
        runId: run.runId,
      };
    }
    if (terminalProofStates.has(proofState(currentProof) ?? "")) break;
  }
  const terminalState = proofState(currentProof);
  if (!terminalState || !terminalProofStates.has(terminalState)) {
    throw new UsageError(
      "Required Proof cases were exhausted without a terminal server decision; no client verdict was accepted",
    );
  }
  return {
    proof: currentProof,
    ...(proofApprovalResponse === undefined ? {} : { proofApprovalResponse }),
    planApproved: true,
    pilot,
    runs: runSummaries,
    terminalState,
  };
}
