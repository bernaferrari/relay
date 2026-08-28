import assert from "node:assert/strict";
import test from "node:test";
import { createRelayOutcomeJobs } from "./index.js";
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
      id: "authoring.session.begin",
      output: { session: recording },
      checkInput: (input) =>
        assert.deepEqual(input, {
          appMapId: "settings",
          testName: "Settings localization",
          target: { kind: "device", platform: "android", targetId: "pixel-9" },
          leaseId: "lease-1",
          expectedAppMapRevision: 7,
        }),
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
  assert.equal(scripted.remaining(), 0);
});
