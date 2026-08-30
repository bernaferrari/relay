import assert from "node:assert/strict";
import test from "node:test";
import { VERIFY_CHANGE_POLICY, type ChangeVerification, type OperationId } from "@relay/protocol";
import {
  canonicalSha256,
  compileVerificationPlan,
  proofStartInputFromVerificationPlan,
  verificationCellId,
} from "@relay/core";
import { runVerifyChangeCommand, type VerifyChangeGitRunner } from "./verify-change-command.js";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);

function reviewedConfig() {
  return {
    repository: "acme/relay",
    changed: { localizationKeys: ["settings.language.title"], files: [] },
    associations: [
      {
        id: "settings-language-copy",
        appMapId: "settings",
        testId: "language",
        signals: {
          files: ["src/settings"],
          symbols: [],
          routes: [],
          resources: [],
          localizationKeys: ["settings.language.title"],
          apiContracts: [],
        },
        confidence: "definite",
        reason: "Reviewed Settings language coverage.",
        review: {
          status: "reviewed",
          revision: 1,
          reviewedBy: "human:reviewer",
          reviewedAt: 10,
        },
      },
    ],
    builds: [],
    targetCases: [],
  };
}

function executableConfig() {
  return {
    ...reviewedConfig(),
    builds: [
      {
        id: "web-build",
        platform: "web",
        artifactDigest: `sha256:${"c".repeat(64)}`,
        sourceSha: headSha,
        configuration: "production",
        environmentRevision: "fixture-v1",
      },
    ],
    targetCases: [
      {
        id: "local-browser-ar",
        executionTarget: {
          schemaVersion: 1,
          kind: "local-browser",
          provider: { key: "relay.local.browser", scope: "local" },
          targetId: "browser-1",
          platform: "browser",
          identity: { kind: "browser-target", value: "browser-1" },
        },
        targetProfile: {
          id: "browser-profile-ar",
          targetId: "browser-1",
          source: "browser",
          platform: "browser",
          name: "Browser AR",
          viewport: { width: 390, height: 844 },
          browserCaseProfile: {
            schemaVersion: 1,
            engine: "chromium",
            viewport: { width: 390, height: 844 },
            deviceScaleFactor: 2,
            mobile: true,
            touch: true,
            locale: "ar",
            timezoneId: "UTC",
            colorScheme: "light",
            reducedMotion: "no-preference",
            permissions: [],
            offline: false,
            environmentRevision: "fixture-v1",
          },
          capabilities: ["snapshot", "screenshot", "tap"],
          observedAt: 10,
        },
        dimensions: { locale: "ar" },
        required: true,
      },
    ],
  };
}

const safeExecutionRisk = {
  schemaVersion: 1 as const,
  level: "safe" as const,
  reasons: [],
  externalEffects: [],
  confirmation: "none" as const,
  expectedAppBoundaries: [],
  cleanupRequired: false,
};

function preparedPlan(
  config: ReturnType<typeof reviewedConfig> | ReturnType<typeof executableConfig>,
) {
  const plan = compileVerificationPlan({
    change: {
      repository: config.repository,
      baseSha,
      headSha,
      baseTipSha: baseSha,
      mergeBaseSha: baseSha,
      requestedHeadSha: headSha,
      testedSha: headSha,
      testedKind: "head",
      repositoryId: config.repository,
    },
    changed: {
      files: ["src/settings/Language.tsx"],
      symbols: [],
      routes: [],
      resources: [],
      localizationKeys: config.changed.localizationKeys,
      apiContracts: [],
    },
    associations: config.associations,
    builds: config.builds,
    targetCases: config.targetCases,
    policy: VERIFY_CHANGE_POLICY,
  });
  const cells = plan.selection.cells?.map((cell) => ({
    ...cell,
    id: verificationCellId({
      appMapId: cell.journey.appMapId,
      testId: cell.journey.testId,
      appMapRevision: 7,
      targetCaseId: cell.targetCaseId,
      buildId: cell.buildId,
    }),
    journey: { ...cell.journey, appMapRevision: 7 },
    executionRisk: safeExecutionRisk,
    executionRiskDigest: canonicalSha256(safeExecutionRisk),
    evidencePolicyDigest: `sha256:${"e".repeat(64)}`,
    cleanupRequired: false,
  }));
  const idMap = new Map(
    (plan.selection.cells ?? []).map((cell, index) => [cell.id, cells?.[index]?.id ?? cell.id]),
  );
  const pilotCellId = plan.selection.pilotCellId
    ? idMap.get(plan.selection.pilotCellId)
    : undefined;
  return {
    ...plan,
    selection: {
      ...plan.selection,
      affectedJourneys: plan.selection.affectedJourneys.map((journey) => ({
        ...journey,
        appMapRevision: 7,
      })),
      cells,
      ...(pilotCellId ? { pilotCellId } : {}),
    },
    ...(pilotCellId ? { pilotCellId } : {}),
    expansion: {
      ...plan.expansion,
      ...(plan.expansion.cellIds
        ? { cellIds: plan.expansion.cellIds.map((id) => idMap.get(id) ?? id) }
        : {}),
    },
  };
}

function proofFixture(
  state: ChangeVerification["state"],
  version: number,
  start: Record<string, unknown>,
  runIds: readonly string[] = [],
): ChangeVerification {
  return {
    schemaVersion: 2,
    id: "proof-live-cli",
    organizationId: "acme",
    projectId: "relay",
    version,
    state,
    change: start.change as ChangeVerification["change"],
    builds: start.builds as ChangeVerification["builds"],
    selection: start.selection as ChangeVerification["selection"],
    ...(state !== "planning" && state !== "awaiting-build"
      ? {
          planApproval: {
            decisionId: "human-approved",
            approvedBy: "human:reviewer",
            approvedAt: 20,
            reason: "Reviewed exact plan.",
          },
        }
      : {}),
    policy: start.policy as ChangeVerification["policy"],
    runIds,
    evidenceDigests: [],
    coverageGaps: [],
    residualRisk: [],
    smallestNextVerification: {
      kind: state === "rejected" ? "none" : "run-pilot",
      reason: state === "rejected" ? "Proof rejected by trusted evidence." : "Run pilot.",
    },
    requestedBy: "human:reviewer",
    updatedBy: "human:reviewer",
    lastMutation: {
      schemaVersion: 1,
      requestId: `request-${version}`,
      requestDigest: `sha256:${"d".repeat(64)}`,
      action: state === "ready" ? "approve-plan" : state === "rejected" ? "record-runs" : "start",
      actorId: "human:reviewer",
      proofId: "proof-live-cli",
      previousVersion: Math.max(0, version - 1),
      version,
      at: version,
    },
    createdAt: 1,
    updatedAt: version,
  };
}

function fakeGit(calls: string[][]): VerifyChangeGitRunner {
  return async (args, options) => {
    calls.push([...args]);
    assert.equal(options.maxBuffer, 4 * 1024 * 1024);
    if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
      return { stdout: "/tmp/reviewed-repo\n" };
    }
    if (args[0] === "rev-parse" && args.at(-1) === "main^{commit}") {
      return { stdout: `${baseSha}\n` };
    }
    if (args[0] === "rev-parse" && args.at(-1) === "HEAD^{commit}") {
      return { stdout: `${headSha}\n` };
    }
    if (args[0] === "merge-base") return { stdout: `${baseSha}\n` };
    if (args[0] === "diff") return { stdout: "src/settings/Language.tsx\0" };
    throw new Error(`unexpected git call: ${args.join(" ")}`);
  };
}

test("verify-change compiles exact local Git provenance without mutating when unconfirmed", async () => {
  const calls: string[][] = [];
  let invoked = false;
  const result = await runVerifyChangeCommand({
    base: "main",
    configFile: ".relay/change-proof.json",
    confirm: false,
    cwd: "/tmp/workspace",
    readConfig: (path) => {
      assert.equal(path, "/tmp/workspace/.relay/change-proof.json");
      return reviewedConfig();
    },
    git: fakeGit(calls),
    client: {
      invoke: async () => {
        invoked = true;
        return {};
      },
      events: async () => {},
    },
  });

  assert.equal(invoked, false);
  assert.deepEqual(result.git, {
    repositoryRoot: "/tmp/reviewed-repo",
    baseRef: "main",
    baseSha,
    headSha,
    changedFiles: ["src/settings/Language.tsx"],
  });
  assert.equal(result.plan.selection.affectedJourneys[0]?.testId, "language");
  assert.equal(result.execution.proofStarted, false);
  assert.equal(result.execution.nextAction.kind, "confirm");
  assert.match(result.execution.nextAction.command ?? "", /--confirm/u);
  assert.equal(calls[1]?.[3], "main^{commit}");
  assert.equal(calls[3]?.[0], "merge-base");
  assert.equal(calls[4]?.[0], "diff");
});

test("verify-change safely passes an untrusted base ref to execFile and starts one Proof only when confirmed", async () => {
  const calls: string[][] = [];
  const invoked: Array<{ id: OperationId; input: unknown }> = [];
  const plan = preparedPlan(reviewedConfig());
  const start = proofStartInputFromVerificationPlan(plan);
  const result = await runVerifyChangeCommand({
    base: "main; echo NOT_EXECUTED",
    configFile: "reviewed.json",
    confirm: true,
    cwd: "/tmp/workspace",
    readConfig: () => reviewedConfig(),
    git: async (args, options) => {
      calls.push([...args]);
      assert.equal(
        options.cwd,
        args[0] === "rev-parse" && args[1] === "--show-toplevel"
          ? "/tmp/workspace"
          : "/tmp/reviewed-repo",
      );
      if (args[0] === "rev-parse" && args[1] === "--show-toplevel") {
        return { stdout: "/tmp/reviewed-repo\n" };
      }
      if (args[0] === "rev-parse" && args.at(-1)?.endsWith("^{commit}")) {
        return { stdout: args.at(-1) === "HEAD^{commit}" ? `${headSha}\n` : `${baseSha}\n` };
      }
      if (args[0] === "merge-base") return { stdout: `${baseSha}\n` };
      return { stdout: "src/settings/Language.tsx\0" };
    },
    client: {
      invoke: async (id, input) => {
        invoked.push({ id, input });
        return {
          proof: proofFixture("planning", 1, start),
          plan,
          disposition: "created",
          nextAction: {
            kind: "provide-build",
            reason: "Provide the exact build.",
          },
          blockers: [],
        };
      },
      events: async () => {},
    },
  });

  assert.equal(invoked.length, 1);
  assert.equal(invoked[0]?.id, "proof.prepare");
  assert.equal(
    result.proof && typeof result.proof === "object" && "id" in result.proof
      ? result.proof.id
      : undefined,
    "proof-live-cli",
  );
  assert.equal(result.execution.proofStarted, true);
  assert.equal(result.execution.pilot.attempted, false);
  assert.equal(result.execution.nextAction.kind, "provide-build");
  const baseCall = calls.find((args) => args[0] === "rev-parse" && args.at(-1)?.includes("main;"));
  assert.deepEqual(baseCall?.slice(0, 3), ["rev-parse", "--verify", "--end-of-options"]);
});

test("verify-change delegates the complete Proof decision to one server-owned proof.run", async () => {
  const calls: Array<{ id: OperationId; input: unknown }> = [];
  const config = executableConfig();
  const plan = preparedPlan(config);
  const startInput = proofStartInputFromVerificationPlan(plan) as Record<string, unknown>;
  const client = {
    async invoke(id: OperationId, input: unknown) {
      calls.push({ id, input });
      if (id === "proof.prepare") {
        return {
          proof: proofFixture("planning", 1, startInput),
          plan,
          disposition: "created",
          nextAction: { kind: "approve-plan", reason: "Review the exact plan." },
          blockers: [],
        };
      }
      if (id === "proof.plan.approve") {
        return { proof: proofFixture("ready", 2, startInput!) };
      }
      if (id === "proof.run") {
        return {
          proof: proofFixture("rejected", 3, startInput!, ["run-failed"]),
          execution: {
            id: "proof-execution-1",
            proofId: "proof-live-cli",
            status: "completed",
            cursor: 1,
            total: 1,
            runIds: ["run-failed"],
            deadlineAt: 100,
            nextAction: "complete",
          },
        };
      }
      throw new Error(`unexpected operation ${id}`);
    },
    events: async () => {},
  };
  const result = await runVerifyChangeCommand({
    base: "main",
    configFile: "reviewed.json",
    confirm: true,
    actorKind: "human",
    cwd: "/tmp/workspace",
    readConfig: () => config,
    git: fakeGit([]),
    client,
    pollIntervalMs: 0,
    pollTimeoutMs: 1_000,
    sleep: async () => {},
  });

  assert.equal(
    result.proof && typeof result.proof === "object"
      ? (result.proof as { state: string }).state
      : undefined,
    "rejected",
  );
  assert.equal(result.execution.pilot.attempted, true);
  assert.deepEqual(result.execution.runs, [
    {
      appMapId: "settings",
      testId: "language",
      targetCaseId: "local-browser-ar",
      jobId: "run-failed",
      runId: "run-failed",
    },
  ]);
  assert.equal(result.execution.nextAction.kind, "complete");
  assert.deepEqual(
    calls.map(({ id }) => id),
    ["proof.prepare", "proof.plan.approve", "proof.run"],
    "the CLI must not dispatch App Map runs, poll jobs, or mutate Proof state client-side",
  );
  assert.deepEqual(calls[0]?.input, {
    baseRef: "main",
    policy: VERIFY_CHANGE_POLICY,
    targetIds: ["local-browser-ar"],
    buildIds: ["web-build"],
  });
  assert.deepEqual(calls.at(-1)?.input, { proofId: "proof-live-cli", wait: true });
  assert.ok(startInput);
});

test("verify-change does not self-approve a complete plan for an agent actor", async () => {
  const calls: OperationId[] = [];
  const config = executableConfig();
  const plan = preparedPlan(config);
  const start = proofStartInputFromVerificationPlan(plan) as Record<string, unknown>;
  await assert.rejects(
    runVerifyChangeCommand({
      base: "main",
      configFile: "reviewed.json",
      confirm: true,
      actorKind: "agent",
      cwd: "/tmp/workspace",
      readConfig: () => config,
      git: fakeGit([]),
      client: {
        async invoke(id) {
          calls.push(id);
          return {
            proof: proofFixture("planning", 1, start),
            plan,
            disposition: "created",
            nextAction: { kind: "approve-plan", reason: "Review the exact plan." },
            blockers: [],
          };
        },
        events: async () => {},
      },
    }),
    /human actor/u,
  );
  assert.deepEqual(calls, ["proof.prepare"]);
});

test("verify-change resumes server-owned Proof execution with one stable proof.run identity", async () => {
  const config = executableConfig();
  const plan = preparedPlan(config);
  const startInput = proofStartInputFromVerificationPlan(plan) as Record<string, unknown>;
  const identities: Array<{
    id: OperationId;
    requestId?: string;
    idempotencyKey?: string;
  }> = [];
  const client = {
    async invoke(
      id: OperationId,
      input: unknown,
      options?: { requestId?: string; idempotencyKey?: string },
    ) {
      identities.push({ id, ...options });
      if (id === "proof.prepare") {
        return {
          proof: proofFixture(
            identities.filter(({ id: candidate }) => candidate === "proof.prepare").length === 1
              ? "planning"
              : "running",
            identities.filter(({ id: candidate }) => candidate === "proof.prepare").length === 1
              ? 1
              : 3,
            startInput,
            identities.filter(({ id: candidate }) => candidate === "proof.prepare").length === 1
              ? []
              : ["job-adopted"],
          ),
          plan,
          disposition:
            identities.filter(({ id: candidate }) => candidate === "proof.prepare").length === 1
              ? "created"
              : "existing",
          nextAction: { kind: "approve-plan", reason: "Review the exact plan." },
          blockers: [],
        };
      }
      if (id === "proof.plan.approve") {
        return { proof: proofFixture("ready", 2, startInput!) };
      }
      if (id === "proof.run") {
        const runCount = identities.filter(({ id: candidate }) => candidate === "proof.run").length;
        return {
          proof: proofFixture(
            runCount === 1 ? "running" : "rejected",
            runCount === 1 ? 3 : 4,
            startInput!,
            runCount === 1 ? [] : ["job-adopted"],
          ),
          execution: {
            id: "proof-execution-1",
            proofId: "proof-live-cli",
            status: runCount === 1 ? "running" : "completed",
            cursor: runCount === 1 ? 0 : 1,
            total: 1,
            runIds: runCount === 1 ? [] : ["job-adopted"],
            deadlineAt: 100,
            nextAction: runCount === 1 ? "run-pilot" : "complete",
          },
        };
      }
      throw new Error(`unexpected operation ${id}`);
    },
    events: async () => {},
  };
  const run = () =>
    runVerifyChangeCommand({
      base: "main",
      configFile: "reviewed.json",
      confirm: true,
      actorKind: "human",
      cwd: "/tmp/workspace",
      readConfig: () => config,
      git: fakeGit([]),
      client,
      pollIntervalMs: 0,
      pollTimeoutMs: 1_000,
      sleep: async () => {},
    });

  const first = await run();
  assert.equal(first.execution.nextAction.kind, "run-pilot");
  const resumed = await run();
  assert.equal(
    resumed.proof && typeof resumed.proof === "object"
      ? (resumed.proof as { state: string }).state
      : undefined,
    "rejected",
  );
  const starts = identities.filter(({ id }) => id === "proof.prepare");
  const runs = identities.filter(({ id }) => id === "proof.run");
  assert.equal(starts.length, 2);
  assert.equal(runs.length, 2);
  assert.equal(starts[0]?.requestId, starts[1]?.requestId);
  assert.equal(starts[0]?.idempotencyKey, starts[1]?.idempotencyKey);
  assert.equal(runs[0]?.requestId, runs[1]?.requestId);
  assert.equal(runs[0]?.idempotencyKey, runs[1]?.idempotencyKey);
  assert.match(runs[0]?.requestId ?? "", /^verify-change-proof-run-/u);
  assert.deepEqual(
    identities.map(({ id }) => id),
    ["proof.prepare", "proof.plan.approve", "proof.run", "proof.prepare", "proof.run"],
  );
});
