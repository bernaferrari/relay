import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  AuthoringSessionStore,
  compileAppMapScenarioTest,
  createAppMap,
  loadFrozenRawAccessibilityEvidence,
  nativeCaptureTargetProfile,
  preflightCompiledAppMapTestOffline,
  readAppMap,
  runWithOperationContext,
  type AuthoringRuntime,
  type Device,
} from "@relay/core";
import type { AuthoringSession } from "@relay/protocol";
import {
  captureAuthoringObservation,
  captureAuthoringReplayActionEndpoint,
} from "./authoring-routes.js";

for (const platform of ["android", "ios"] as const) {
  test(`edited ${platform} replay commits immutable intermediate AX on the exact runtime profile`, async () => {
    const directory = await mkdtemp(join(tmpdir(), "relay-android-replay-proof-"));
    const previous = {
      state: process.env.RELAY_STATE_DIR,
      recipes: process.env.RELAY_RECIPES_DIR,
      tests: process.env.RELAY_TESTS_DIR,
    };
    process.env.RELAY_STATE_DIR = join(directory, "state");
    process.env.RELAY_RECIPES_DIR = join(directory, "recipes");
    process.env.RELAY_TESTS_DIR = join(directory, "tests");
    try {
      const requestId = crypto.randomUUID();
      await runWithOperationContext(
        {
          schemaVersion: 1,
          actorId: "human:replay-proof",
          actorKind: "human",
          organizationId: "local",
          projectId: "replay-proof",
          operationId: "authoring.test",
          requestId,
          idempotencyKey: requestId,
          issuedAt: Date.now(),
        },
        async () => {
          let screen = 0;
          let clock = 100;
          const labels = ["Open model menu", "Choose Fast", "Start new chat"];
          const targetId = `${platform}-replay-proof`;
          const dependencies = {
            async resolveDevice() {
              return {} as Device;
            },
            async captureSnapshot() {
              return {
                serial: targetId,
                capturedAt: ++clock,
                foregroundApp: "test.grok",
                nodes: [
                  {
                    index: 0,
                    role: "button",
                    label: labels[screen],
                    enabled: true,
                    hittable: true,
                    rect: { x: 20, y: 20, width: 160, height: 48 },
                  },
                ],
                interactive: [],
                bounds: { width: 400, height: 800 },
                inspectable: true,
                source: "sdk" as const,
                inspectionState: "active" as const,
                bindingState: "matched" as const,
                screenIdentity: {
                  schemaVersion: 1 as const,
                  fingerprint: createHash("sha256").update(`screen-${screen}`).digest("hex"),
                  nodes: [],
                  volatileSignals: [],
                },
              };
            },
            async captureScreenshot() {
              const data = Buffer.from(`test-screen-${screen}`);
              return {
                serial: targetId,
                capturedAt: ++clock,
                mime: "image/png" as const,
                base64: data.toString("base64"),
                path: `/test/replay-${screen}.png`,
                bytes: data.length,
                width: platform === "ios" ? 800 : 400,
                height: platform === "ios" ? 1600 : 800,
                foregroundApp: "test.grok",
              };
            },
          };
          const observe = (session: AuthoringSession) =>
            captureAuthoringObservation(session, dependencies);
          const advance = async () => {
            screen += 1;
          };
          const runtime: AuthoringRuntime = {
            observe,
            execute: advance,
            replay: advance,
            replayAction: advance,
            prepareReplaySource: async () => {
              screen = 0;
            },
            observeReplayActionEndpoint: (session) =>
              captureAuthoringReplayActionEndpoint(session, dependencies),
          };
          const map = await createAppMap({
            organizationId: "local",
            projectId: "replay-proof",
            appMapId: "grok-replay",
            name: "Grok replay",
          });
          const store = new AuthoringSessionStore();
          let session = await store.create({
            appMapId: map.id,
            target: { kind: "device", platform, targetId },
            leaseId: "test-lease",
            expectedAppMapRevision: map.revision,
          });
          session = await store.observe(session.id, runtime);
          session = await store.start(session.id, runtime);
          for (const label of labels.slice(0, 2)) {
            session = await store.interact(
              session.id,
              {
                kind: "tap",
                target: platform === "ios" ? { point: { x: 300, y: 600 } } : { label },
              },
              runtime,
            );
          }
          session = await store.stop(session.id, runtime);
          session = await store.reorder(
            session.id,
            session.take!.revisions.at(-1)!.actions.map((action) => action.id),
          );
          session = await store.replay(session.id, runtime);
          assert.equal(session.take!.replayAttempts.at(-1)?.outcome, "passed");
          session = await store.commit(session.id, { createTest: true, testName: "Choose Fast" });
          const savedMap = (await readAppMap("replay-proof", map.id))!;
          const savedTest = savedMap.tests[session.committedTestId!]!;
          const runtimeProfile = nativeCaptureTargetProfile({
            platform,
            targetId,
            observedAt: clock,
            viewport: { width: 400, height: 800 },
          });
          const profileId = runtimeProfile.id;
          const compiled = compileAppMapScenarioTest(savedMap, savedTest, {
            runtimeTargetProfile: runtimeProfile,
          });
          const preflight = preflightCompiledAppMapTestOffline(
            compiled.plan,
            await loadFrozenRawAccessibilityEvidence(compiled.plan),
            { targetProfileId: profileId },
          );
          assert.equal(preflight.summary.blockers, 0, JSON.stringify(preflight.findings));
          const middleFingerprint = createHash("sha256")
            .update(platform === "ios" ? "test-screen-1" : "screen-1")
            .digest("hex");
          const intermediate = Object.values(savedMap.screenVariants).find(
            (variant) =>
              savedMap.screens[variant.screenId]?.identity?.fingerprint === middleFingerprint,
          );
          assert.equal(intermediate?.targetProfile.id, profileId);
          assert.ok(intermediate?.rawAccessibilityTree?.observationId);
          assert.match(intermediate.rawAccessibilityTree.uri, /^relay-evidence:\/\/[a-f0-9]{64}$/u);
        },
      );
    } finally {
      if (previous.state === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previous.state;
      if (previous.recipes === undefined) delete process.env.RELAY_RECIPES_DIR;
      else process.env.RELAY_RECIPES_DIR = previous.recipes;
      if (previous.tests === undefined) delete process.env.RELAY_TESTS_DIR;
      else process.env.RELAY_TESTS_DIR = previous.tests;
      await rm(directory, { recursive: true, force: true });
    }
  });
}

test("an Android replay endpoint without inspection retains pixels and unavailable semantics", async () => {
  let snapshots = 0;
  const session = {
    target: { kind: "device", platform: "android", targetId: "unavailable-android" },
  } as AuthoringSession;
  const captured = await captureAuthoringReplayActionEndpoint(session, {
    async resolveDevice() {
      return {} as Device;
    },
    async captureSnapshot() {
      snapshots += 1;
      return {
        serial: session.target.targetId,
        capturedAt: 10,
        nodes: [],
        interactive: [],
        inspectable: false,
        source: "pixels-only",
        screenIdentity: {
          schemaVersion: 1,
          fingerprint: createHash("sha256").update("visible-screen").digest("hex"),
          nodes: [],
          volatileSignals: [],
        },
      };
    },
    async captureScreenshot() {
      const bytes = Buffer.from("visible-endpoint");
      return {
        serial: session.target.targetId,
        capturedAt: 11,
        mime: "image/png",
        base64: bytes.toString("base64"),
        path: "/test/unavailable-endpoint.png",
        bytes: bytes.length,
      };
    },
  });
  assert.equal(snapshots, 1);
  assert.equal(captured.proof?.pixels.status, "captured");
  assert.equal(captured.proof?.semantics.status, "unavailable");
  assert.deepEqual(captured.nodes, []);
});

for (const keepsMoving of [false, true]) {
  test(`iOS replay observes a moving bracket once more (${keepsMoving ? "still moving" : "settled"})`, async () => {
    let rasters = 0;
    let snapshots = 0;
    const captured = await captureAuthoringReplayActionEndpoint(
      {
        target: { kind: "device", platform: "ios", targetId: "moving-ipad" },
      } as AuthoringSession,
      {
        async resolveDevice() {
          return {} as Device;
        },
        async captureSnapshot() {
          snapshots += 1;
          return {
            serial: "moving-ipad",
            capturedAt: rasters * 10 + 1,
            nodes: [{ index: 0, role: "button", label: "General" }],
            interactive: [],
            bounds: { width: 834, height: 1112 },
            inspectable: true,
            source: "sdk",
            screenIdentity: {
              schemaVersion: 1,
              fingerprint: "keyboard",
              nodes: [],
              volatileSignals: [],
            },
          };
        },
        async captureScreenshot() {
          rasters += 1;
          const data = Buffer.from(
            keepsMoving ? `moving-${rasters}` : rasters === 1 ? "moving" : "settled",
          );
          return {
            serial: "moving-ipad",
            capturedAt: rasters * 10,
            mime: "image/png",
            base64: data.toString("base64"),
            bytes: data.length,
            path: `/test/moving-${rasters}.png`,
            width: 1668,
            height: 2224,
          };
        },
      },
    );
    assert.equal(snapshots, 2, "observation retry is bounded and requires no input");
    assert.equal(rasters, 4);
    assert.equal(captured.proof?.semantics.status, keepsMoving ? "stale" : "current");
    assert.equal(captured.proof?.pixels.bracket?.status, keepsMoving ? "changed" : "coherent");
    assert.deepEqual(captured.bounds, { width: 834, height: 1112 });
  });
}
