import assert from "node:assert/strict";
import test from "node:test";
import type { ChangeVerification, OperationId } from "@relay/protocol";
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
          proof: {
            id: "proof-1",
            version: 1,
            state: "planning",
            smallestNextVerification: {
              kind: "provide-build",
              reason: "Provide the exact build.",
            },
          },
        };
      },
      events: async () => {},
    },
  });

  assert.equal(invoked.length, 1);
  assert.equal(invoked[0]?.id, "proof.start");
  assert.equal(
    result.proof && typeof result.proof === "object" && "id" in result.proof
      ? result.proof.id
      : undefined,
    "proof-1",
  );
  assert.equal(result.execution.proofStarted, true);
  assert.equal(result.execution.pilot.attempted, false);
  assert.equal(result.execution.nextAction.kind, "provide-build");
  const baseCall = calls.find((args) => args[0] === "rev-parse" && args.at(-1)?.includes("main;"));
  assert.deepEqual(baseCall?.slice(0, 3), ["rev-parse", "--verify", "--end-of-options"]);
});

test("verify-change records a persisted error job so the server decides rejection", async () => {
  const calls: Array<{ id: OperationId; input: unknown }> = [];
  const config = executableConfig();
  let startInput: Record<string, unknown> | undefined;
  let jobPolls = 0;
  const client = {
    async invoke(id: OperationId, input: unknown) {
      calls.push({ id, input });
      if (id === "proof.start") {
        startInput = input as Record<string, unknown>;
        return { proof: proofFixture("planning", 1, startInput) };
      }
      if (id === "proof.plan.approve") {
        return { proof: proofFixture("ready", 2, startInput!) };
      }
      if (id === "proof.continue") {
        const action = (input as { action: string }).action;
        if (action === "start-pilot") {
          return { proof: proofFixture("running-pilot", 3, startInput!) };
        }
        if (action === "record-runs") {
          return { proof: proofFixture("rejected", 4, startInput!, ["job-failed"]) };
        }
      }
      if (id === "app-map.get") return { appMap: { id: "settings", revision: 7 } };
      if (id === "app-map.test.run") {
        return {
          planIdentity: { appMapId: "settings", testId: "language", appMapRevision: 7 },
          job: { id: "job-failed", status: "queued" },
        };
      }
      if (id === "job.get") {
        jobPolls += 1;
        return { job: { id: "job-failed", status: "error", persisted: jobPolls > 1 } };
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
      jobId: "job-failed",
      runId: "job-failed",
    },
  ]);
  assert.equal(result.execution.nextAction.kind, "complete");
  const recordCall = calls.find(
    ({ id, input }) =>
      id === "proof.continue" && (input as { action: string }).action === "record-runs",
  );
  assert.deepEqual(recordCall?.input, {
    proofId: "proof-live-cli",
    expectedVersion: 3,
    action: "record-runs",
    runIds: ["job-failed"],
  });
  assert.equal(calls.filter(({ id }) => id === "app-map.test.run").length, 1);
  assert.ok(startInput);
  assert.equal(
    (
      (startInput.selection as ChangeVerification["selection"]).affectedJourneys[0] as {
        appMapRevision?: number;
      }
    ).appMapRevision,
    7,
  );
  assert.equal(jobPolls, 2);
});

test("verify-change does not self-approve a complete plan for an agent actor", async () => {
  const calls: OperationId[] = [];
  const config = executableConfig();
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
          if (id === "app-map.get") return { appMap: { id: "settings", revision: 7 } };
          return { proof: proofFixture("planning", 1, {}) };
        },
        events: async () => {},
      },
    }),
    /human actor/u,
  );
  assert.deepEqual(calls, ["app-map.get", "proof.start"]);
});

test("verify-change resumes a dispatched pilot with stable transport identity", async () => {
  const config = executableConfig();
  let startInput: Record<string, unknown> | undefined;
  let crashOnce = true;
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
      if (id === "app-map.get") return { appMap: { id: "settings", revision: 7 } };
      if (id === "proof.start") {
        startInput = input as Record<string, unknown>;
        return { proof: proofFixture("running-pilot", 3, startInput) };
      }
      if (id === "app-map.test.run") {
        return {
          planIdentity: { appMapId: "settings", testId: "language", appMapRevision: 7 },
          job: { id: "job-adopted", status: "queued" },
        };
      }
      if (id === "job.get") {
        if (crashOnce) {
          crashOnce = false;
          throw new Error("simulated CLI interruption after dispatch");
        }
        return { job: { id: "job-adopted", status: "error", persisted: true } };
      }
      if (id === "proof.continue") {
        assert.equal((input as { action: string }).action, "record-runs");
        return { proof: proofFixture("rejected", 4, startInput!, ["job-adopted"]) };
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

  await assert.rejects(run(), /simulated CLI interruption/u);
  const resumed = await run();
  assert.equal(
    resumed.proof && typeof resumed.proof === "object"
      ? (resumed.proof as { state: string }).state
      : undefined,
    "rejected",
  );
  assert.equal(
    identities.filter(({ id }) => id === "proof.plan.approve" || id === "proof.continue").length,
    1,
    "resume records the adopted Run without approving or restarting the pilot",
  );
  const starts = identities.filter(({ id }) => id === "proof.start");
  const runs = identities.filter(({ id }) => id === "app-map.test.run");
  assert.equal(starts.length, 2);
  assert.equal(runs.length, 2);
  assert.equal(starts[0]?.requestId, starts[1]?.requestId);
  assert.equal(starts[0]?.idempotencyKey, starts[1]?.idempotencyKey);
  assert.equal(runs[0]?.requestId, runs[1]?.requestId);
  assert.equal(runs[0]?.idempotencyKey, runs[1]?.idempotencyKey);
  assert.match(runs[0]?.requestId ?? "", /^verify-change-run-case-/u);
});
