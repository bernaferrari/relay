import assert from "node:assert/strict";
import test from "node:test";
import type { TargetPreflight } from "@relay/protocol";
import { createRelayOutcomeJobs } from "./outcome-jobs.js";
import type { RelayInvokeClient } from "./operation-port.js";
import { createScriptedRelayClient } from "./testing.js";

const pixel = {
  id: "pixel-9",
  serial: "pixel-9",
  name: "Pixel 9",
  kind: "emulator",
  booted: true,
  platform: "android",
  createdAt: 1,
  updatedAt: 1,
};

const managedBrowser = {
  id: "browser-checkout",
  serial: "browser-checkout",
  name: "Checkout browser",
  kind: "Managed browser",
  booted: true,
  platform: "browser" as const,
};

const managedBrowserDefinition = {
  id: "browser-checkout",
  name: "Checkout browser",
  kind: "browser" as const,
  createdAt: 1,
  updatedAt: 1,
  browser: {
    startUrl: "https://example.test/checkout",
    headless: true,
  },
};

const managedBrowserPreflight: TargetPreflight = {
  targetId: "browser-checkout",
  ok: true,
  checkedAt: 1,
  capabilities: ["snapshot", "screenshot", "recording", "tap", "type", "scroll", "network", "logs"],
  checks: [
    { id: "executable", label: "Browser executable", status: "pass" as const, message: "Chrome" },
    { id: "profile", label: "Isolated profile", status: "pass" as const, message: "Writable" },
    {
      id: "navigation",
      label: "Start page",
      status: "pass" as const,
      message: "Reached https://example.test",
    },
  ],
};

function browserDiscoverySteps(
  preflight = managedBrowserPreflight,
  devices = [managedBrowser],
  targets = [managedBrowserDefinition],
) {
  return [
    { id: "target.devices.list" as const, output: { devices } },
    { id: "target.list" as const, output: { targets } },
    { id: "target.preflight" as const, output: { preflight } },
  ];
}

function artifact(digit: string, mime: string, kind: "image" | "structured-data") {
  const sha256 = digit.repeat(64);
  return {
    status: "available" as const,
    artifact: {
      schemaVersion: 1 as const,
      id: `sha256:${sha256}`,
      integrity: { algorithm: "sha256" as const, sha256, bytes: 3 },
      media: { kind, mime },
      capturedAt: 10,
      provenance: { source: "authoring-evidence" as const, capture: "recorded" as const },
      retention: {
        scope: "workspace-content-addressed" as const,
        recoverability: "content-addressed" as const,
      },
      locations: [{ store: "authoring-evidence" as const, opaque: `evidence-${digit}` }],
    },
  };
}

function tracePackExport(runId: string) {
  const digest = `sha256:${"a".repeat(64)}` as const;
  return {
    tracePack: {
      schemaVersion: 1 as const,
      kind: "relay-trace-pack" as const,
      digest,
      createdAt: 1,
      source: {
        runId,
        runSchemaVersion: 5,
        status: "ok",
        action: "test",
        inputDigest: "b".repeat(64),
        writtenAt: 1,
      },
      redaction: { status: "applied-at-persistence" as const, redactedChannels: [] },
      completeness: { status: "complete" as const, channels: {}, missing: [], artifacts: [] },
      objects: [
        {
          path: "run.json",
          kind: "frozen-run" as const,
          mediaType: "application/json",
          encoding: "json" as const,
          digest,
          bytes: 2,
          content: {},
        },
      ],
    },
    analysis: {
      schemaVersion: 1 as const,
      mode: "trace-pack-offline-analysis" as const,
      tracePackDigest: digest,
      sourceRunId: runId,
      historicalVerdict: "insufficient-evidence" as const,
      futureTransitionVerdict: "unknown" as const,
      proved: [],
      unknown: [
        {
          code: "MISSING_EVIDENCE",
          statement: "The fixture intentionally has no verified evidence.",
          resolution: "Use a content-addressed TracePack.",
        },
      ],
      smallestLiveVerification: {
        kind: "recapture-frozen-plan" as const,
        reason: "The fixture requires fresh evidence.",
        requiresTarget: true as const,
      },
    },
  };
}

test("connect selects the sole ready device without exposing leases or profiles", async () => {
  const scripted = createScriptedRelayClient([
    { id: "target.devices.list", output: { devices: [pixel] } },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  assert.deepEqual(await jobs.connect(), {
    targets: [{ kind: "device", platform: "android", targetId: "pixel-9" }],
    current: { kind: "device", platform: "android", targetId: "pixel-9" },
  });
  assert.deepEqual(scripted.invocations, [{ id: "target.devices.list", input: {} }]);
});

test("connect leaves multiple devices explicit instead of guessing", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "target.devices.list",
      output: {
        devices: [pixel, { ...pixel, id: "ipad", serial: "ipad", platform: "ios" }],
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.connect();
  assert.equal(result.current, undefined);
  assert.equal(result.targets.length, 2);
});

test("connect excludes Android targets that are listed but offline or unauthorized", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "target.devices.list",
      output: {
        devices: [
          pixel,
          { ...pixel, id: "offline", serial: "offline", connectionState: "offline" },
          { ...pixel, id: "unauthorized", serial: "unauthorized", connectionState: "unauthorized" },
        ],
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.connect();
  assert.deepEqual(result.targets, [{ kind: "device", platform: "android", targetId: "pixel-9" }]);
  assert.deepEqual(result.current, {
    kind: "device",
    platform: "android",
    targetId: "pixel-9",
  });
});

test("connect selects a ready managed browser only after canonical preflight", async () => {
  const scripted = createScriptedRelayClient(browserDiscoverySteps());
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  assert.deepEqual(await jobs.connect(), {
    targets: [{ kind: "browser", platform: "browser", targetId: "browser-checkout" }],
    current: { kind: "browser", platform: "browser", targetId: "browser-checkout" },
  });
  assert.deepEqual(
    scripted.invocations.map(({ id, input }) => ({ id, input })),
    [
      { id: "target.devices.list", input: {} },
      { id: "target.list", input: {} },
      { id: "target.preflight", input: { targetId: "browser-checkout" } },
    ],
  );
});

test("connect excludes a browser whose executable or start page failed preflight", async () => {
  const scripted = createScriptedRelayClient(
    browserDiscoverySteps({
      ...managedBrowserPreflight,
      ok: false,
      checks: [
        {
          id: "navigation",
          label: "Start page",
          status: "fail" as const,
          message: "The start page could not be reached",
        },
      ],
    }),
  );
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.connect();
  assert.deepEqual(result.targets, []);
  assert.equal(result.current, undefined);
});

test("connect keeps two ready managed browsers explicit instead of guessing", async () => {
  const second = {
    ...managedBrowser,
    id: "browser-payments",
    serial: "browser-payments",
    name: "Payments browser",
  };
  const secondDefinition = {
    ...managedBrowserDefinition,
    id: "browser-payments",
    name: "Payments browser",
    browser: { ...managedBrowserDefinition.browser, startUrl: "https://example.test/payments" },
  };
  const scripted = createScriptedRelayClient(
    browserDiscoverySteps(
      managedBrowserPreflight,
      [managedBrowser, second],
      [managedBrowserDefinition, secondDefinition],
    ).flatMap((step, index) =>
      index === 2
        ? [
            step,
            {
              ...step,
              output: { preflight: { ...managedBrowserPreflight, targetId: "browser-payments" } },
            },
          ]
        : [step],
    ),
  );
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.connect();
  assert.equal(result.current, undefined);
  assert.deepEqual(result.targets, [
    { kind: "browser", platform: "browser", targetId: "browser-checkout" },
    { kind: "browser", platform: "browser", targetId: "browser-payments" },
  ]);
});

test("record freezes the selected browser target before reserving its durable workflow", async () => {
  let durableIdentity: Record<string, unknown> | undefined;
  const scripted = createScriptedRelayClient([
    ...browserDiscoverySteps(),
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    {
      id: "lease.list",
      output: {
        leases: [
          {
            id: "browser-lease",
            projectId: "default",
            poolId: "local",
            deviceSerial: "browser-checkout",
            ownerId: "system:local-control:bG9jYWwAZGVmYXVsdA",
            controlScope: "local-project",
            status: "leased",
            leasedAt: 1,
            expiresAt: 10_000,
          },
        ],
      },
    },
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    {
      id: "workflow.create",
      error: new Error("workflow store unavailable"),
      checkInput: (input) => {
        durableIdentity = (input as { frozenIdentity: Record<string, unknown> }).frozenIdentity;
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.record({
    kind: "record-test",
    appMapId: "settings",
    title: "Checkout smoke path",
    confirmControl: true,
  });

  assert.equal(result.phase, "blocked");
  assert.deepEqual(durableIdentity?.target, {
    kind: "browser",
    platform: "browser",
    targetId: "browser-checkout",
  });
  const durableInvocation = scripted.invocations.at(-1);
  assert.equal(durableInvocation?.id, "workflow.create");
  assert.ok(durableInvocation);
  assert.deepEqual(
    (durableInvocation.input as { frozenIdentity?: unknown }).frozenIdentity,
    durableIdentity,
  );
});

test("explicit workflow target reports the precise iOS runtime recovery", async () => {
  const unavailable = {
    mode: "accessibility" as const,
    state: "unavailable" as const,
    freshness: "unproven" as const,
    reason: "probe-failed" as const,
  };
  const provenPixels = {
    mode: "pixels" as const,
    state: "proven" as const,
    freshness: "current" as const,
    proof: { at: 1 },
  };
  const provenEvidence = {
    mode: "evidence" as const,
    state: "proven" as const,
    freshness: "current" as const,
    proof: { at: 1 },
  };
  const ipad = {
    id: "ipad",
    serial: "ipad",
    name: "iPad",
    kind: "Physical device",
    booted: true,
    platform: "ios" as const,
    readiness: {
      previewPixels: provenPixels,
      semanticControl: unavailable,
      evidenceCapture: provenEvidence,
    },
  };
  const scripted = createScriptedRelayClient([
    { id: "target.devices.list", output: { devices: [ipad] } },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  await assert.rejects(
    () => jobs.observe({ kind: "observe-target", targetId: "ipad" }),
    /Reconnect the iOS target and capture a fresh observation/,
  );
});

test("inspect-failure returns bounded public projections from canonical repair summaries", async () => {
  const repair = {
    schemaVersion: 1 as const,
    id: "repair-run-1-usage",
    status: "pending" as const,
    defaultAction: "continue-and-report" as const,
    source: {
      runId: "run-1",
      runInputDigest: "digest-1",
      checkId: "usage",
      checkTitle: "Usage stays visible",
      action: "test",
      capturedAt: 3,
    },
    error: "Usage was not visible",
    priorAttemptCount: 1,
  };
  const scripted = createScriptedRelayClient([
    {
      id: "run.get",
      output: {
        run: {
          id: "run-1",
          action: "test",
          status: "failed",
          queuedAt: 1,
          startedAt: 2,
          finishedAt: 4,
          error: "Usage was not visible",
          artifacts: [{ private: "advanced-only" }],
          result: { private: "advanced-only" },
        },
      },
    },
    {
      id: "run.evidence.get",
      output: {
        evidence: {
          runId: "run-1",
          events: [{ private: "advanced-only" }, { private: "advanced-only" }],
          channels: { screenshot: {}, accessibility: {} },
          logs: [{ private: "advanced-only" }],
        },
      },
    },
    {
      id: "run.repair.list",
      output: {
        repairs: [
          repair,
          {
            ...repair,
            id: "repair-run-2-usage",
            source: { ...repair.source, runId: "run-2" },
          },
        ],
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  assert.deepEqual(await jobs.inspectFailure({ kind: "inspect-failure", runId: "run-1" }), {
    runId: "run-1",
    run: {
      id: "run-1",
      action: "test",
      status: "failed",
      queuedAt: 1,
      startedAt: 2,
      finishedAt: 4,
      error: "Usage was not visible",
    },
    evidence: {
      runId: "run-1",
      eventCount: 2,
      channels: ["accessibility", "screenshot"],
    },
    repairProposals: [
      {
        id: "repair-run-1-usage",
        runId: "run-1",
        checkId: "usage",
        checkTitle: "Usage stays visible",
        error: "Usage was not visible",
        priorAttemptCount: 1,
      },
    ],
  });
  assert.equal(scripted.remaining(), 0);
});

test("inspect-failure rejects legacy repair envelopes instead of guessing", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "run.get",
      output: { run: { id: "run-1", action: "test", status: "failed", queuedAt: 1 } },
    },
    {
      id: "run.evidence.get",
      output: { evidence: { runId: "run-1", events: [], channels: {} } },
    },
    { id: "run.repair.list", output: { proposals: [] } },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  await assert.rejects(
    jobs.inspectFailure({ kind: "inspect-failure", runId: "run-1" }),
    /run repairs must be an array/u,
  );
});

test("propose-repair returns a review-only identity projection", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "run.repair.propose",
      output: {
        proposalId: "proposal-1",
        repair: {
          schemaVersion: 1,
          id: "repair-1",
          source: { runId: "run-1", checkId: "usage" },
          actions: [],
        },
        appMap: { id: "map-1", revision: 8, private: "advanced-only" },
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  assert.deepEqual(
    await jobs.proposeRepair({
      kind: "propose-repair",
      runId: "run-1",
      checkId: "usage",
      proposal: "disable",
      reason: "The check is obsolete",
    }),
    {
      proposalId: "proposal-1",
      repairTargetId: "repair-1",
      runId: "run-1",
      checkId: "usage",
      proposal: "disable",
      reviewRequired: true,
    },
  );
});

test("export-evidence returns the strict TracePack envelope and verifies Run identity", async () => {
  const exported = tracePackExport("run-1");
  const scripted = createScriptedRelayClient([
    { id: "run.trace-pack.get", output: exported },
    { id: "run.trace-pack.get", output: tracePackExport("run-other") },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  assert.deepEqual(
    await jobs.exportEvidence({ kind: "export-evidence", runId: "run-1" }),
    exported,
  );
  await assert.rejects(
    jobs.exportEvidence({ kind: "export-evidence", runId: "run-1" }),
    /different Run/u,
  );
});

test("verify-change fails closed when source metadata selects no frozen Runs", async () => {
  const scripted = createScriptedRelayClient([
    {
      id: "run.list",
      checkInput: (input) => assert.deepEqual(input, { limit: 129 }),
      output: { runs: [] },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.verifyChange({
    kind: "verify-change",
    selection: {
      kind: "source-revision",
      sourceRevision: { vcs: "git", sha: "abcdef0" },
    },
  });

  assert.notEqual(result.decision, "approve");
  assert.ok(
    result.unresolvedUncertainty.includes(
      "affected-test-selection-unavailable:source-revision:abcdef0",
    ),
  );
  assert.equal(result.mutation, "none");
  assert.equal(result.checkPosting, "none");
  assert.equal(scripted.remaining(), 0);
});

test("verify-change bounds direct Run selections before transport", async () => {
  let invoked = false;
  const client: RelayInvokeClient = {
    async invoke() {
      invoked = true;
      throw new Error("transport must not be reached");
    },
  };
  const jobs = createRelayOutcomeJobs(client, { actorId: "agent:test" });

  await assert.rejects(
    jobs.verifyChange({
      kind: "verify-change",
      selection: {
        kind: "runs",
        runIds: Array.from({ length: 129 }, (_, index) => `run-${index}`),
      },
    }),
    /128/u,
  );
  assert.equal(invoked, false);
});

test("verify-change reads immutable Run evidence with bounded concurrency", async () => {
  let active = 0;
  let maximumActive = 0;
  let calls = 0;
  const client: RelayInvokeClient = {
    async invoke(id, input) {
      assert.equal(id, "run.trace-pack.get");
      const runId = (input as { runId: string }).runId;
      calls += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return tracePackExport(runId);
    },
  };
  const jobs = createRelayOutcomeJobs(client, { actorId: "agent:test" });

  await assert.rejects(
    jobs.verifyChange({
      kind: "verify-change",
      selection: {
        kind: "runs",
        runIds: Array.from({ length: 9 }, (_, index) => `run-${index}`),
      },
    }),
    /integrity/u,
  );
  assert.equal(calls, 9);
  assert.equal(maximumActive, 4);
});

test("observe projects pixels and current semantics through one bounded outcome", async () => {
  const output = {
    schemaVersion: 1 as const,
    target: { kind: "device" as const, platform: "android" as const, targetId: "pixel-9" },
    capturedAt: 11,
    pixels: {
      status: "captured" as const,
      capturedAt: 10,
      mime: "image/png" as const,
      bytes: 3,
      artifact: artifact("a", "image/png", "image"),
      presentationBase64: "cG5n",
      width: 1080,
      height: 2400,
      fingerprint: "visual-1",
    },
    semantics: {
      status: "current" as const,
      capturedAt: 11,
      artifact: artifact("b", "application/json", "structured-data"),
      source: "android-system" as const,
      inspectionState: "active" as const,
      fingerprint: "semantic-1",
      nodeCount: 1,
      controls: [{ label: "Settings", role: "button", enabled: true }],
    },
    foregroundApp: "com.example.app",
    screenCandidate: { fingerprint: "visual-1", confidence: "observed" as const },
  };
  const scripted = createScriptedRelayClient([
    { id: "target.devices.list", output: { devices: [pixel] } },
    {
      id: "target.observation.capture",
      checkInput: (input) => assert.deepEqual(input, { serial: "pixel-9" }),
      output,
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const observed = await jobs.observe();

  assert.equal(
    observed.pixels.status === "captured" ? observed.pixels.presentationBase64 : undefined,
    "cG5n",
  );
  const serialized = JSON.parse(JSON.stringify(observed)) as Record<string, unknown>;
  const expected = structuredClone(output);
  if (expected.pixels.status === "captured") {
    delete (expected.pixels as { presentationBase64?: string }).presentationBase64;
  }
  assert.deepEqual(serialized, expected);
  assert.equal(JSON.stringify(observed).includes("presentationBase64"), false);
  assert.equal(JSON.stringify(observed).includes("/private/temporary"), false);
  assert.equal(scripted.remaining(), 0);
});

test("observe keeps pixels useful when semantics are unavailable", async () => {
  const semanticArtifact = artifact("c", "application/json", "structured-data");
  const scripted = createScriptedRelayClient([
    { id: "target.devices.list", output: { devices: [pixel] } },
    {
      id: "target.observation.capture",
      output: {
        schemaVersion: 1,
        target: { kind: "device", platform: "android", targetId: "pixel-9" },
        capturedAt: 21,
        pixels: {
          status: "captured",
          capturedAt: 20,
          mime: "image/png",
          bytes: 3,
          artifact: artifact("d", "image/png", "image"),
          presentationBase64: "cG5n",
          fingerprint: "visual-only",
        },
        semantics: {
          status: "unavailable",
          capturedAt: 21,
          artifact: semanticArtifact,
          source: "pixels-only",
          inspectionState: "unavailable",
          nodeCount: 0,
          controls: [],
          message: "Accessibility is temporarily unavailable.",
        },
        screenCandidate: { fingerprint: "visual-only", confidence: "observed" },
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const observed = await jobs.observe({ kind: "observe-target", targetId: "pixel-9" });

  assert.equal(observed.pixels.status, "captured");
  assert.equal(JSON.stringify(observed).includes("presentationBase64"), false);
  assert.deepEqual(observed.semantics, {
    status: "unavailable",
    capturedAt: 21,
    artifact: semanticArtifact,
    source: "pixels-only",
    inspectionState: "unavailable",
    nodeCount: 0,
    controls: [],
    message: "Accessibility is temporarily unavailable.",
  });
  assert.deepEqual(observed.screenCandidate, {
    fingerprint: "visual-only",
    confidence: "observed",
  });
});

test("record preserves the CLI and MCP title as the canonical Authoring Session testName", async () => {
  const recording = {
    schemaVersion: 1,
    id: "authoring-settings-localization",
    organizationId: "local",
    projectId: "default",
    actorId: "agent:test",
    actorKind: "agent",
    appMapId: "settings",
    workflowRequestId: "author-request",
    testName: "Settings localization",
    state: "recording",
    target: { kind: "device", platform: "android", targetId: "pixel-9" },
    leaseId: "lease-1",
    expectedAppMapRevision: 7,
    createdAt: 1,
    updatedAt: 2,
    take: {
      id: "take-1",
      state: "recording",
      createdAt: 1,
      updatedAt: 2,
      currentRevision: 1,
      revisions: [
        {
          id: "take-1:revision:1",
          takeId: "take-1",
          revision: 1,
          createdAt: 2,
          createdBy: "agent:test",
          reason: "recording",
          actions: [],
          evidence: [],
        },
      ],
      replayAttempts: [],
    },
  } as const;
  const scripted = createScriptedRelayClient([
    { id: "target.devices.list", output: { devices: [pixel] } },
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    {
      id: "lease.list",
      output: {
        leases: [
          {
            id: "lease-1",
            projectId: "default",
            poolId: "local",
            deviceSerial: "pixel-9",
            ownerId: "agent:test",
            status: "leased",
            leasedAt: 1,
            expiresAt: 10_000,
          },
        ],
      },
    },
    { id: "app-map.get", output: { appMap: { revision: 7 } } },
    {
      id: "workflow.create",
      output: {
        disposition: "created",
        workflow: {
          record: {
            schemaVersion: 1,
            workflowId: "author-workflow",
            organizationId: "local",
            projectId: "default",
            kind: "author-test",
            version: 1,
            status: "active",
            frozenIdentity: {
              title: "Settings localization",
              actorId: "agent:test",
              appMapId: "settings",
              appMapRevision: 7,
              workflowRequestId: "author-request",
              target: { kind: "device", platform: "android", targetId: "pixel-9" },
            },
            createdBy: "agent:test",
            lastActorId: "agent:test",
            createdAt: 1,
            updatedAt: 1,
            expiresAt: 10_000,
            lastTransition: "created",
          },
          audit: [],
        },
      },
      checkInput: (input) => {
        const value = input as { workflowId?: unknown; kind?: unknown };
        assert.equal(value.kind, "author-test");
        assert.equal(typeof value.workflowId, "string");
      },
    },
    {
      id: "workflow.transition",
      output: {
        workflow: {
          record: {
            schemaVersion: 1,
            workflowId: "author-workflow",
            organizationId: "local",
            projectId: "default",
            kind: "author-test",
            version: 3,
            status: "active",
            frozenIdentity: {
              title: "Settings localization",
              actorId: "agent:test",
              appMapId: "settings",
              appMapRevision: 7,
              workflowRequestId: "author-request",
              target: { kind: "device", platform: "android", targetId: "pixel-9" },
            },
            resource: { kind: "authoring-session", id: recording.id },
            createdBy: "agent:test",
            lastActorId: "agent:test",
            createdAt: 1,
            updatedAt: 2,
            expiresAt: 10_000,
            lastTransition: "authoring-started",
          },
          audit: [],
        },
        session: recording,
      },
      checkInput: (input) => {
        assert.deepEqual(input, {
          workflowId: "author-workflow",
          expectedVersion: 1,
          action: "start-authoring",
          leaseId: "lease-1",
        });
      },
    },
  ]);
  const jobs = createRelayOutcomeJobs(scripted.client, { actorId: "agent:test" });

  const result = await jobs.record({
    kind: "record-test",
    appMapId: "settings",
    title: "Settings localization",
    confirmControl: true,
  });

  assert.equal(result.kind, "author-test");
  assert.equal(result.title, "Settings localization");
  assert.equal(result.stage, "recording");
  assert.deepEqual(result.workflow, { workflowId: "author-workflow", expectedVersion: 3 });
  assert.equal(result.ref, undefined);
  assert.equal(scripted.remaining(), 0);
});
