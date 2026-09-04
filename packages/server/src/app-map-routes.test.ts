import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ApiError, RelayClient } from "@relay/client";
import { compileBrowserEnvironment } from "@relay/protocol";
import {
  createAppMapTestExecutionIntent,
  createDiscoverySession,
  enqueueJob,
  leaseDevice,
  materializeLogicalScrollSurfaceImport,
  parseAppMapTestExecutionIntentArtifact,
  mutateStoredAppMap,
  persistAuthoringEvidence,
  readAuthoringEvidence,
  recordObservedScreen,
  recordObservedTransition,
  releaseDeviceLease,
  resetControlDatabaseCache,
  resetDeviceClients,
  saveBrowserTarget,
  setLocalDeviceProvider,
  regenerateLogicalScrollSurface,
  setDiscoveryStatus,
} from "@relay/core";
import { startServer } from "./index.js";
import { assertTargetControl } from "./access-control.js";
import { explicitTargetAvailability, queuedAppMapTestTargetProfile } from "./app-map-run-routes.js";
import {
  findEquivalentTeachConnection,
  iosTeachObservationMatchesTitle,
  sourceAnchorForTeachInteraction,
  teachInteractionToAuthoringInteraction,
} from "./app-map-routes.js";
import { appMapProofOutcomeUnknownReview } from "./app-map-proposal-routes.js";

test("explicit target preflight distinguishes disconnected and not-ready devices", () => {
  assert.equal(explicitTargetAvailability("phone-1", []), "missing");
  assert.equal(
    explicitTargetAvailability("phone-1", [
      { serial: "phone-2", booted: true, connectionState: "connected" },
    ]),
    "missing",
  );
  assert.equal(
    explicitTargetAvailability("phone-1", [
      { serial: "phone-1", booted: true, connectionState: "offline" },
    ]),
    "not-ready",
  );
  assert.equal(
    explicitTargetAvailability("phone-1", [
      { serial: "phone-1", booted: true, connectionState: "connected" },
    ]),
    "connected",
  );
  assert.equal(
    explicitTargetAvailability("ipad-1", [
      { serial: "ipad-1", booted: true, developerServicesAvailable: false },
    ]),
    "not-ready",
  );
});

test("typed Variable inference captures a target and returns a reviewable App Map mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-variable-infer-route-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  resetControlDatabaseCache();
  const actorId = "agent:variable-infer-route-test";
  const targetId = "android-variable-fixture";
  const raster = await readFile(
    fileURLToPath(new URL("../../app-v2/public/relay-icon.png", import.meta.url)),
  );
  setLocalDeviceProvider({
    kind: "device",
    create: () =>
      ({
        capture: {
          snapshot: async () => ({
            nodes: [
              {
                index: 1,
                type: "Cell",
                label: "English",
                identifier: "language.en",
                visibleToUser: true,
                enabled: true,
                hittable: true,
                rect: { x: 0, y: 20, width: 300, height: 44 },
              },
              {
                index: 2,
                type: "Cell",
                label: "Italiano",
                identifier: "language.it",
                visibleToUser: true,
                enabled: true,
                hittable: true,
                rect: { x: 0, y: 70, width: 300, height: 44 },
              },
            ],
          }),
          screenshot: async ({ path }: { path: string }) => {
            await writeFile(path, raster);
            return { path };
          },
        },
      }) as never,
  });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let leaseId: string | undefined;
  try {
    server = await startServer({ host: "127.0.0.1", port: 0 });
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId,
      actorKind: "agent",
    });
    await client.invoke("app-map.create", { appMapId: "settings", name: "Settings" });
    const lease = await leaseDevice({
      organizationId: "acme",
      projectId: "mobile",
      poolId: "local",
      deviceSerial: targetId,
      ownerId: actorId,
      expiresAt: Date.now() + 60_000,
    });
    leaseId = lease.id;

    const proposal = await client.invoke("app-map.variable.infer", {
      appMapId: "settings",
      variableId: "language",
      expectedRevision: 0,
      target: { kind: "device", platform: "ios", targetId },
      leaseId,
      taughtRows: [{ id: "en", identifier: "language.en" }],
      name: "Language",
      kind: "language",
      apply: { kind: "list" },
    });
    assert.deepEqual(
      proposal.variable.options.map((option) => option.id),
      ["en", "it"],
    );
    assert.equal(proposal.mutation.operationId, "app-map.variable.save");
    assert.equal(
      (await client.invoke("app-map.get", { appMapId: "settings" })).appMap.variables.language,
      undefined,
    );

    const saved = await client.invoke(proposal.mutation.operationId, proposal.mutation.input);
    assert.deepEqual(
      saved.appMap.variables.language?.options.map((option) => option.id),
      ["en", "it"],
    );
  } finally {
    if (leaseId) await releaseDeviceLease(leaseId).catch(() => undefined);
    if (server) await server.close();
    setLocalDeviceProvider(undefined);
    resetDeviceClients();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});

test("queued Tests preserve the exact viewport-suffixed saved runtime profile", () => {
  const targetProfile = queuedAppMapTestTargetProfile({
    runtimeTargetProfile: {
      id: "device:pixel-9-1080x2400",
      targetId: "pixel-9",
      platform: "android",
      viewport: { width: 1080, height: 2400 },
    },
    observedTargetProfile: {
      id: "device:pixel-9",
      targetId: "pixel-9",
      source: "device",
      platform: "android",
      name: "Pixel 9",
      capabilities: ["screenshot", "snapshot", "scroll"],
      observedAt: 100,
    },
    target: { kind: "device", targetId: "pixel-9", platform: "android" },
  });
  assert.deepEqual(targetProfile, {
    id: "device:pixel-9-1080x2400",
    targetId: "pixel-9",
    source: "device",
    platform: "android",
    name: "Pixel 9",
    viewport: { width: 1080, height: 2400 },
    capabilities: ["screenshot", "snapshot", "scroll"],
    observedAt: 100,
  });
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: {
          id: "device:pixel-9-1080x2400",
          targetId: "pixel-9",
          platform: "android",
          viewport: { width: 1080, height: 2400 },
        },
        observedTargetProfile: undefined,
        target: { kind: "device", targetId: "pixel-9", platform: "ios" },
      }),
    /does not bind/u,
  );
});

test("queued mobile Tests require every frozen capability while allowing compatible additions", () => {
  const runtimeTargetProfile = {
    id: "device:pixel-9",
    targetId: "pixel-9",
    platform: "android" as const,
    model: "Physical device",
    osVersion: "16",
    capabilities: ["snapshot", "screenshot"] as const,
  };
  const observedTargetProfile = {
    id: "device:pixel-9",
    targetId: "pixel-9",
    source: "device" as const,
    platform: "android" as const,
    name: "Pixel 9",
    model: "Physical device",
    osVersion: "16",
    capabilities: ["snapshot", "screenshot", "scroll"] as const,
    observedAt: 100,
  };
  assert.doesNotThrow(() =>
    queuedAppMapTestTargetProfile({
      runtimeTargetProfile,
      observedTargetProfile: {
        ...observedTargetProfile,
        capabilities: [...observedTargetProfile.capabilities],
      },
      target: { kind: "device", targetId: "pixel-9", platform: "android" },
    }),
  );
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile,
        observedTargetProfile: { ...observedTargetProfile, capabilities: ["snapshot"] },
        target: { kind: "device", targetId: "pixel-9", platform: "android" },
      }),
    /no longer matches frozen profile/u,
  );
});

test("queued browser Tests require the complete saved profile to match the observed target", () => {
  const saved = compileBrowserEnvironment({
    engine: "webkit",
    viewport: { width: 390, height: 844 },
    locale: "pt-BR",
    timezoneId: "America/Maceio",
    colorScheme: "dark",
  });
  const observed = compileBrowserEnvironment({
    engine: "webkit",
    viewport: { width: 1_280, height: 800 },
    locale: "en-US",
  });
  const runtimeTargetProfile = {
    id: "browser:checkout",
    targetId: "checkout",
    platform: "browser" as const,
    viewport: saved.viewport,
    browserCaseProfile: saved,
  };
  const currentTargetProfile = {
    id: "browser:checkout",
    targetId: "checkout",
    source: "browser" as const,
    platform: "browser" as const,
    name: "Checkout",
    viewport: saved.viewport,
    browserCaseProfile: saved,
    capabilities: ["screenshot" as const, "snapshot" as const],
    observedAt: 100,
  };
  const targetProfile = queuedAppMapTestTargetProfile({
    runtimeTargetProfile,
    observedTargetProfile: currentTargetProfile,
    target: { kind: "browser", targetId: "checkout", platform: "browser" },
  });
  assert.deepEqual(targetProfile?.browserCaseProfile, saved);
  assert.deepEqual(targetProfile?.viewport, saved.viewport);
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile,
        observedTargetProfile: {
          ...currentTargetProfile,
          viewport: observed.viewport,
          browserCaseProfile: observed,
        },
        target: { kind: "browser", targetId: "checkout", platform: "browser" },
      }),
    /no longer matches frozen profile/u,
  );
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: {
          id: "browser:checkout",
          targetId: "checkout",
          platform: "browser",
          viewport: saved.viewport,
          browserCaseProfile: saved,
        },
        observedTargetProfile: {
          id: "browser:checkout",
          targetId: "checkout",
          source: "browser",
          platform: "browser",
          name: "Checkout",
          browserCaseProfile: compileBrowserEnvironment({ engine: "chromium" }),
          capabilities: ["screenshot"],
          observedAt: 100,
        },
        target: { kind: "browser", targetId: "checkout", platform: "browser" },
      }),
    /no longer matches frozen profile/u,
  );
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: {
          id: "browser:checkout",
          targetId: "checkout",
          platform: "browser",
          viewport: saved.viewport,
          browserCaseProfile: saved,
        },
        observedTargetProfile: undefined,
        target: { kind: "browser", targetId: "checkout", platform: "browser" },
      }),
    /is unavailable/u,
  );
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: {
          id: "browser:unsupported",
          targetId: "checkout",
          platform: "browser",
          viewport: saved.viewport,
          browserCaseProfile: { ...saved, networkProfile: "wifi-slow" },
        },
        observedTargetProfile: {
          id: "browser:checkout",
          targetId: "checkout",
          source: "browser",
          platform: "browser",
          name: "Checkout",
          browserCaseProfile: observed,
          capabilities: ["screenshot"],
          observedAt: 100,
        },
        target: { kind: "browser", targetId: "checkout", platform: "browser" },
      }),
    /unavailable host resolvers: networkProfile/u,
  );
  assert.throws(
    () =>
      queuedAppMapTestTargetProfile({
        runtimeTargetProfile: {
          id: "browser:legacy",
          targetId: "checkout",
          platform: "browser",
          viewport: { width: 390, height: 844 },
        },
        observedTargetProfile: undefined,
        target: { kind: "browser", targetId: "checkout", platform: "browser" },
      }),
    /no frozen browser environment/u,
  );
});

test("App Map proof stops give agents one explicit current-pixels review action", () => {
  assert.deepEqual(
    appMapProofOutcomeUnknownReview({
      serial: "ipad / one",
      appMapId: "grok settings",
      proposalId: "repair / 1",
      connectionId: "open-privacy",
    }),
    {
      appMapHref: "/app-maps/grok%20settings",
      proposalHref: "/app-maps/grok%20settings/proposals/repair%20%2F%201",
      connectionId: "open-privacy",
      captureCurrent: {
        method: "GET",
        href: "/screenshot?serial=ipad%20%2F%20one&ephemeral=1",
      },
    },
  );
});

test("offline Test compilation previews a verified checkpoint without a device or Test mutation", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-test-checkpoint-compile-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const offlineOnlyCalls = { listDevices: 0, assertTargetControl: 0, enqueueJob: 0 };
  let preflightOnly = true;
  let failIntentConstruction = false;
  const server = await startServer({
    host: "127.0.0.1",
    port: 0,
    appMapTestRunRuntime: {
      async listDevices() {
        offlineOnlyCalls.listDevices += 1;
        if (preflightOnly) throw new Error("blocked Test run tried to discover a device");
        return [
          {
            id: "ipad-1",
            serial: "ipad-1",
            name: "iPad",
            kind: "Physical device",
            booted: true,
            platform: "ios" as const,
          },
        ];
      },
      async assertTargetControl(scope, targetId) {
        offlineOnlyCalls.assertTargetControl += 1;
        if (preflightOnly) throw new Error("blocked Test run tried to control a target");
        return assertTargetControl(scope, targetId);
      },
      createAppMapTestExecutionIntent(input) {
        if (failIntentConstruction) throw new Error("injected frozen intent failure");
        return createAppMapTestExecutionIntent(input);
      },
      enqueueJob(input) {
        offlineOnlyCalls.enqueueJob += 1;
        if (preflightOnly) throw new Error("blocked Test run tried to enqueue work");
        return enqueueJob(input);
      },
    },
  });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:designer",
      actorKind: "human",
    });
    await client.invoke("app-map.create", { appMapId: "store", name: "Store" });
    await client.invoke("app-map.screen.add", {
      appMapId: "store",
      expectedRevision: 0,
      screen: {
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
    });
    await client.invoke("app-map.screen.add", {
      appMapId: "store",
      expectedRevision: 1,
      screen: {
        id: "settings",
        title: "Settings",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
    });
    const homeTree = await persistAuthoringEvidence({
      kind: "snapshot",
      capturedAt: 10,
      mime: "application/json",
      data: JSON.stringify({
        nodes: [
          {
            index: 0,
            type: "Button",
            label: "Settings",
            enabled: true,
            visibleToUser: true,
            hittable: true,
            rect: { x: 40, y: 80, width: 300, height: 80 },
          },
        ],
      }),
    });
    await mutateStoredAppMap("mobile", "store", (current) => {
      const next = structuredClone(current);
      const rawTree = {
        id: homeTree.id,
        uri: homeTree.uri,
        sha256: homeTree.sha256!,
        mime: "application/json" as const,
        bytes: homeTree.bytes!,
        observationId: "home-observation",
        capturedAt: homeTree.capturedAt,
      };
      next.screenVariants["home-ios-en"] = {
        id: "home-ios-en",
        organizationId: next.organizationId,
        projectId: next.projectId,
        appMapId: next.id,
        screenId: "home",
        targetProfile: {
          id: "ipad-en",
          targetId: "ipad-1",
          source: "device",
          platform: "ios",
          name: "iPad · English",
          capabilities: ["snapshot", "screenshot"],
          observedAt: homeTree.capturedAt,
        },
        observation: {
          fingerprint: "a".repeat(64),
          nodes: [{ role: "button", label: "Settings", hittable: true }],
          volatileSignals: [],
        },
        evidenceIds: [homeTree.id],
        evidenceUris: [homeTree.uri],
        rawAccessibilityTree: rawTree,
        createdAt: homeTree.capturedAt,
        updatedAt: homeTree.capturedAt,
      };
      next.screenVariants["home-ios-pt"] = {
        ...next.screenVariants["home-ios-en"]!,
        id: "home-ios-pt",
        targetProfile: {
          ...next.screenVariants["home-ios-en"]!.targetProfile,
          id: "ipad-pt",
          name: "iPad · Portuguese",
        },
        rawAccessibilityTree: undefined,
        evidenceIds: [],
        evidenceUris: [],
      };
      // The expected destination is part of the same frozen Test proof. Keep
      // a separately-bound source for it so the positive run exercises the
      // profile-scoped path rather than failing for unrelated missing evidence.
      next.screenVariants["settings-ios-en"] = {
        ...next.screenVariants["home-ios-en"]!,
        id: "settings-ios-en",
        screenId: "settings",
        observation: {
          fingerprint: "b".repeat(64),
          nodes: [{ role: "heading", label: "Settings" }],
          volatileSignals: [],
        },
        rawAccessibilityTree: {
          ...rawTree,
          observationId: "settings-observation",
        },
      };
      next.screens.home!.variantIds = ["home-ios-en", "home-ios-pt"];
      next.screens.settings!.variantIds = ["settings-ios-en"];
      next.revision += 1;
      next.updatedAt = Math.max(next.updatedAt + 1, homeTree.capturedAt);
      return next;
    });
    await client.invoke("app-map.connection.create", {
      appMapId: "store",
      expectedRevision: 3,
      connection: {
        id: "open-settings",
        fromScreenId: "home",
        destination: { kind: "screen", screenId: "settings" },
        state: "ready",
        actions: [{ id: "tap-settings", kind: "tap", target: { label: "Settings" } }],
      },
    });
    const saved = await client.invoke("app-map.test.save", {
      appMapId: "store",
      testId: "settings-test",
      expectedRevision: 4,
      test: {
        name: "Settings",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "open-settings",
            kind: "instruction",
            intent: "Open Settings",
            binding: {
              status: "resolved",
              kind: "connections",
              connectionIds: ["open-settings"],
            },
          },
        ],
      } as never,
    });
    const selectorFree = await client.invoke("app-map.test.save", {
      appMapId: "store",
      testId: "script-only",
      expectedRevision: saved.appMap.revision,
      test: {
        name: "Prepare once",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "prepare",
            kind: "script",
            intent: "Prepare without a selector",
            binding: { status: "resolved", kind: "script", source: "return true" },
          },
        ],
      } as never,
    });
    const runRevision = selectorFree.appMap.revision;

    const preview = await client.invoke("app-map.test.compile", {
      appMapId: "store",
      testId: "settings-test",
      entryCheckpointScreenId: "settings",
    });
    assert.deepEqual(preview.plan.startup, { mode: "verified-checkpoint", screenId: "settings" });
    assert.equal(preview.plan.appMapRevision, runRevision);
    assert.equal(preview.preflight.mode, "offline-test-preflight");

    const offline = await client.invoke("app-map.test.compile", {
      appMapId: "store",
      testId: "settings-test",
    });
    const frozenHome = offline.plan.rawAccessibilitySourcesByScreenId?.home?.[0];
    assert.deepEqual(frozenHome?.variant, {
      id: "home-ios-en",
      targetProfileId: "ipad-en",
      targetId: "ipad-1",
      platform: "ios",
      capabilities: ["screenshot", "snapshot"],
    });
    assert.deepEqual(frozenHome?.origin, {
      kind: "screen-variant",
      observationId: "home-observation",
      capturedAt: 10,
    });
    assert.equal(frozenHome?.tree.sha256, homeTree.sha256);
    assert.equal(offline.preflight.selectors[0]?.status, "variant-selection-required");
    assert.equal(offline.preflight.findings[0]?.code, "raw-evidence-variant-selection-required");

    const scoped = await client.invoke("app-map.test.compile", {
      appMapId: "store",
      testId: "settings-test",
      targetProfileId: "ipad-en",
    });
    assert.deepEqual(scoped.preflight.selectors[0]?.rawVariantScope, {
      selectedTargetProfileId: "ipad-en",
      selectedTargetProfile: {
        id: "ipad-en",
        targetId: "ipad-1",
        platform: "ios",
        capabilities: ["screenshot", "snapshot"],
      },
      targetProfileCandidates: [
        {
          id: "ipad-en",
          targetId: "ipad-1",
          platform: "ios",
          capabilities: ["screenshot", "snapshot"],
        },
        {
          id: "ipad-pt",
          targetId: "ipad-1",
          platform: "ios",
          capabilities: ["screenshot", "snapshot"],
        },
      ],
      selectedVariant: {
        id: "home-ios-en",
        targetProfileId: "ipad-en",
        targetId: "ipad-1",
        platform: "ios",
        capabilities: ["screenshot", "snapshot"],
      },
      candidates: [
        {
          variant: {
            id: "home-ios-en",
            targetProfileId: "ipad-en",
            targetId: "ipad-1",
            platform: "ios",
            capabilities: ["screenshot", "snapshot"],
          },
          sourceCount: 1,
          compatibility: "selected-variant",
          reason: "selected-runtime-variant",
        },
        {
          variant: {
            id: "home-ios-pt",
            targetProfileId: "ipad-pt",
            targetId: "ipad-1",
            platform: "ios",
            capabilities: ["screenshot", "snapshot"],
          },
          sourceCount: 0,
          compatibility: "incompatible",
          reason: "no-raw-source",
        },
      ],
    });

    const jobsBeforeBlockedRun = await client.invoke("job.list", { limit: 100 });
    const leasesBeforeBlockedRun = await client.invoke("lease.list", { status: "all" });
    const isRunError = (code: string) => (error: unknown) =>
      error instanceof ApiError &&
      error.status === 409 &&
      (error.body as { code?: unknown }).code === code;
    await assert.rejects(
      client.invoke("job.combine.start", {
        appMapId: "store",
        testId: "settings-test",
        serial: "ipad-1",
        platform: "ios",
      }),
      isRunError("APP_MAP_COMBINE_RUNTIME_PROFILE_CONTRACT_REQUIRED"),
    );
    await assert.rejects(
      client.invoke("job.combine.start", {
        appMapId: "store",
        combineId: "language-settings",
        serial: "ipad-1",
        platform: "ios",
      }),
      (error: unknown) => error instanceof ApiError && error.status === 404,
    );
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "settings-test",
        expectedRevision: runRevision,
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      }),
      isRunError("TARGET_PROFILE_SELECTION_REQUIRED"),
    );
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "script-only",
        expectedRevision: runRevision,
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      }),
      isRunError("TARGET_PROFILE_SELECTION_REQUIRED"),
    );
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "settings-test",
        expectedRevision: runRevision,
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
        targetProfileId: "ipad-pt",
      }),
      isRunError("TEST_OFFLINE_PREFLIGHT_BLOCKED"),
    );
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "settings-test",
        expectedRevision: runRevision,
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
        targetProfileId: "missing-profile",
      }),
      isRunError("TARGET_PROFILE_NOT_SAVED"),
    );
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "settings-test",
        expectedRevision: runRevision,
        target: { kind: "device", platform: "android", targetId: "pixel-1" },
      }),
      isRunError("TARGET_PROFILE_TARGET_MISMATCH"),
    );
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "settings-test",
        expectedRevision: runRevision,
        target: { kind: "device", platform: "android", targetId: "pixel-1" },
        targetProfileId: "ipad-en",
      }),
      isRunError("TARGET_PROFILE_TARGET_MISMATCH"),
    );
    const jobsAfterBlockedRun = await client.invoke("job.list", { limit: 100 });
    const leasesAfterBlockedRun = await client.invoke("lease.list", { status: "all" });
    assert.equal(jobsAfterBlockedRun.jobs.length, jobsBeforeBlockedRun.jobs.length);
    assert.equal(leasesAfterBlockedRun.leases.length, leasesBeforeBlockedRun.leases.length);
    assert.deepEqual(offlineOnlyCalls, {
      listDevices: 0,
      assertTargetControl: 0,
      enqueueJob: 0,
    });
    preflightOnly = false;

    const lease = await client.invoke("lease.create", {
      poolId: "local",
      deviceSerial: "ipad-1",
      expiresAt: Date.now() + 60_000,
    });
    const controlsBeforeIntentFailure = { ...offlineOnlyCalls };
    failIntentConstruction = true;
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "store",
        testId: "settings-test",
        expectedRevision: runRevision,
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
        targetProfileId: "ipad-en",
      }),
      isRunError("TEST_OFFLINE_PREFLIGHT_BLOCKED"),
    );
    assert.deepEqual(offlineOnlyCalls, controlsBeforeIntentFailure);
    failIntentConstruction = false;
    const queued = await client.invoke("app-map.test.run", {
      appMapId: "store",
      testId: "settings-test",
      expectedRevision: runRevision,
      target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      targetProfileId: "ipad-en",
    });
    assert.deepEqual(queued.plan.runtimeTargetProfile, {
      id: "ipad-en",
      targetId: "ipad-1",
      platform: "ios",
      capabilities: ["screenshot", "snapshot"],
    });
    const queuedJob = await client.invoke("job.get", { jobId: queued.job.id });
    const queuedTargetProfile = queuedJob.job.targetProfile as
      | { id?: unknown; targetId?: unknown; platform?: unknown }
      | undefined;
    assert.equal(queuedTargetProfile?.id, "ipad-en");
    assert.equal(queuedTargetProfile?.targetId, "ipad-1");
    assert.equal(queuedTargetProfile?.platform, "ios");
    const frozenArtifacts = queuedJob.job.artifacts as Array<{ kind: string; data?: unknown }>;
    const frozenPlan = frozenArtifacts.find((artifact) => artifact.kind === "app-map-test-plan");
    const frozenPreflight = frozenArtifacts.find(
      (artifact) => artifact.kind === "app-map-test-preflight",
    );
    const executionIntent = frozenArtifacts.find(
      (artifact) => artifact.kind === "app-map-test-execution-intent",
    );
    assert.ok(frozenPlan);
    assert.ok(frozenPreflight);
    assert.ok(executionIntent);
    const frozenPlanData = frozenPlan.data as { runtimeTargetProfile?: unknown };
    const frozenPreflightData = frozenPreflight.data as {
      runtimeTargetProfile?: unknown;
      report?: { planDigest?: unknown };
    };
    assert.deepEqual(frozenPlanData.runtimeTargetProfile, queued.plan.runtimeTargetProfile);
    assert.deepEqual(frozenPreflightData.runtimeTargetProfile, queued.plan.runtimeTargetProfile);
    assert.equal(typeof frozenPreflightData.report?.planDigest, "string");
    const parsedExecutionIntent = parseAppMapTestExecutionIntentArtifact(executionIntent);
    assert.ok(parsedExecutionIntent);
    assert.deepEqual(parsedExecutionIntent.sourcePlan, {
      appMapId: "store",
      appMapRevision: runRevision,
      testId: "settings-test",
      rootRecipeId: queued.plan.rootRecipeId,
      digest: frozenPreflightData.report?.planDigest,
      recipeGraphDigest: parsedExecutionIntent.sourcePlan.recipeGraphDigest,
      rootRecipeDigest: parsedExecutionIntent.sourcePlan.rootRecipeDigest,
    });
    assert.match(parsedExecutionIntent.sourcePlan.recipeGraphDigest, /^[a-f0-9]{64}$/u);
    assert.match(parsedExecutionIntent.sourcePlan.rootRecipeDigest, /^[a-f0-9]{64}$/u);
    await client.invoke("job.cancel", { jobId: queued.job.id });
    await client.invoke("lease.release", { leaseId: lease.lease.id });

    const unchanged = await client.invoke("app-map.get", { appMapId: "store" });
    assert.equal(unchanged.appMap.revision, runRevision);
    assert.ok(unchanged.appMap.tests["settings-test"]);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("teaching converts every supported interaction into a source-guarded Take action", () => {
  assert.deepEqual(teachInteractionToAuthoringInteraction({ kind: "point", x: 40, y: 80 }), {
    kind: "tap",
    target: { point: { x: 40, y: 80 } },
  });
  assert.deepEqual(
    teachInteractionToAuthoringInteraction({
      kind: "label",
      label: "Language",
      point: { x: 120, y: 360 },
    }),
    { kind: "tap", target: { label: "Language", point: { x: 120, y: 360 } } },
  );
  assert.deepEqual(
    teachInteractionToAuthoringInteraction({ kind: "identifier", identifier: "settings" }),
    { kind: "tap", target: { identifier: "settings" } },
  );
  assert.deepEqual(
    teachInteractionToAuthoringInteraction(
      { kind: "label", label: "Add widget" },
      "bitpit.launcher",
    ),
    {
      kind: "tap",
      target: { label: "Add widget" },
      expectedApp: "bitpit.launcher",
    },
  );
  assert.deepEqual(
    teachInteractionToAuthoringInteraction({
      kind: "swipe",
      from: { x: 500, y: 1800 },
      to: { x: 500, y: 500 },
      durationMs: 320,
    }),
    {
      kind: "swipe",
      from: { x: 500, y: 1800 },
      to: { x: 500, y: 500 },
      durationMs: 320,
    },
  );
});

test("teaching the same action to the same screen reuses the existing connection", () => {
  const map = {
    connections: {
      "open-customize": {
        id: "open-customize",
        fromScreenId: "settings-middle",
        destination: { kind: "screen", screenId: "customize" },
        actions: [{ id: "tap-old", kind: "tap", target: { label: "Customize Grok" } }],
      },
      "open-customize-from-another-row": {
        id: "open-customize-from-another-row",
        fromScreenId: "settings-middle",
        destination: { kind: "screen", screenId: "customize" },
        actions: [
          {
            id: "tap-other",
            kind: "tap",
            target: { label: "Customize Grok", point: { x: 540, y: 840 } },
          },
        ],
      },
    },
  } as never;

  assert.equal(
    findEquivalentTeachConnection(map, {
      fromScreenId: "settings-middle",
      destinationScreenId: "customize",
      action: { id: "tap-new", kind: "tap", target: { label: "Customize Grok" } },
    }),
    "open-customize",
  );
  assert.equal(
    findEquivalentTeachConnection(map, {
      fromScreenId: "settings-middle",
      destinationScreenId: "customize",
      action: {
        id: "tap-new",
        kind: "tap",
        target: { label: "Customize Grok", point: { x: 540, y: 920 } },
      },
    }),
    undefined,
  );
  assert.equal(
    findEquivalentTeachConnection(
      {
        connections: {
          "open-customize": {
            id: "open-customize",
            fromScreenId: "settings-middle",
            destination: { kind: "screen", screenId: "customize" },
            actions: [
              {
                id: "tap-old",
                kind: "tap",
                target: { label: "Customize Grok", point: { x: 540, y: 920 } },
              },
            ],
          },
        },
      } as never,
      {
        fromScreenId: "settings-middle",
        destinationScreenId: "customize",
        action: { id: "tap-new", kind: "tap", target: { label: "Customize Grok" } },
      },
    ),
    "open-customize",
  );
});

test("teaching preserves the resolved source control point as canvas evidence", () => {
  const map = {
    screens: {
      settings: { variantIds: ["settings-portrait"] },
    },
    screenVariants: {
      "settings-portrait": { targetProfile: { viewport: { width: 1080, height: 2400 } } },
    },
  } as never;

  assert.deepEqual(
    sourceAnchorForTeachInteraction(
      map,
      "settings",
      { kind: "label", label: "Customize Grok" },
      { x: 540, y: 1800 },
    ),
    { point: { x: 0.5, y: 0.75 } },
  );
  assert.deepEqual(
    sourceAnchorForTeachInteraction(map, "settings", {
      kind: "swipe",
      from: { x: 540, y: 2050 },
      to: { x: 540, y: 700 },
    }),
    { point: { x: 0.5, y: 2050 / 2400 } },
  );
});

test("iOS teaching rejects a stale named destination but tolerates a temporarily empty tree", () => {
  assert.equal(
    iosTeachObservationMatchesTitle(
      [{ visibleToUser: true, label: "Choose a model", identifier: "model.picker" }],
      "Appearance",
    ),
    false,
  );
  assert.equal(
    iosTeachObservationMatchesTitle(
      [{ visibleToUser: true, label: "Appearance", identifier: "settings.appearance" }],
      "Appearance",
    ),
    true,
  );
  assert.equal(iosTeachObservationMatchesTitle([], "Appearance"), true);
});

test("iOS teaching permits a descriptive viewport qualifier after the live screen title", () => {
  const settings = [{ visibleToUser: true, label: "Settings", identifier: "settings" }];
  assert.equal(iosTeachObservationMatchesTitle(settings, "Settings · Lower"), true);
  assert.equal(iosTeachObservationMatchesTitle(settings, "Settings · Middle upper"), true);
  assert.equal(iosTeachObservationMatchesTitle(settings, "Voice · Middle"), false);
});

test("App Map operations are equivalent for human and agent actors", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-server-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const connection = {
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" as const },
      organizationId: "acme",
      projectId: "mobile",
    };
    const human = new RelayClient({
      ...connection,
      actorId: "human:designer",
      actorKind: "human",
    });
    const agent = new RelayClient({
      ...connection,
      actorId: "agent:mapper",
      actorKind: "agent",
    });

    const created = await human.invoke("app-map.create", {
      appMapId: "store",
      name: "Store",
    });
    assert.equal(created.appMap.revision, 0);

    const added = await agent.invoke(
      "app-map.screen.add",
      {
        appMapId: "store",
        expectedRevision: 0,
        eventId: "agent-add-welcome",
        screen: {
          id: "welcome",
          title: "Welcome",
        },
      },
      { requestId: "request-agent-add-welcome" },
    );
    assert.equal(added.appMap.revision, 1);
    assert.equal(added.appMap.activity["agent-add-welcome"]?.actorKind, "agent");

    const visibleToHuman = await human.invoke("app-map.get", { appMapId: "store" });
    assert.equal(visibleToHuman.appMap.screens.welcome?.title, "Welcome");

    const renamed = await human.invoke("app-map.update", {
      appMapId: "store",
      expectedRevision: 1,
      eventId: "human-rename-map",
      patch: { name: "Storefront" },
    });
    assert.equal(renamed.appMap.name, "Storefront");
    assert.equal(renamed.appMap.revision, 2);

    const duplicated = await human.invoke("app-map.duplicate", {
      sourceAppMapId: "store",
      appMapId: "store-copy",
      name: "Storefront copy",
    });
    assert.equal(duplicated.appMap.name, "Storefront copy");
    assert.equal(duplicated.appMap.screens.welcome?.appMapId, "store-copy");
    assert.equal(duplicated.appMap.revision, 0);
    assert.deepEqual(duplicated.appMap.activity, {});

    const submitted = await agent.invoke("app-map.proposal.submit", {
      appMapId: "store",
      expectedRevision: 2,
      eventId: "agent-proposes-start-title",
      proposal: {
        id: "proposal-start-title",
        organizationId: "acme",
        projectId: "mobile",
        appMapId: "store",
        title: "Clarify the start screen",
        status: "pending",
        baseRevision: 2,
        changes: [
          {
            kind: "screen.update",
            screenId: "welcome",
            input: { patch: { title: "Start" } },
          },
        ],
        createdAt: renamed.appMap.updatedAt,
        updatedAt: renamed.appMap.updatedAt,
      },
    });
    assert.equal(submitted.appMap.revision, 3);
    assert.equal(submitted.appMap.screens.welcome?.title, "Welcome");

    const approved = await human.invoke("app-map.proposal.approve", {
      appMapId: "store",
      proposalId: "proposal-start-title",
      expectedRevision: 3,
      eventId: "human-approves-start-title",
    });
    assert.equal(approved.appMap.screens.welcome?.title, "Start");
    assert.equal(approved.appMap.proposals["proposal-start-title"]?.status, "approved");

    const variableSaved = await human.invoke("app-map.variable.save", {
      appMapId: "store",
      variableId: "language",
      expectedRevision: 4,
      variable: {
        name: "Language",
        kind: "language",
        apply: { kind: "list", entryPath: [{ kind: "tap", target: { label: "Language" } }] },
        options: [{ id: "en", label: "English" }],
      },
    } as never);
    assert.equal(variableSaved.appMap.variables.language?.appMapId, "store");
    assert.equal(variableSaved.appMap.variables.language?.organizationId, "acme");

    const scenarioSaved = await human.invoke("app-map.test.save", {
      appMapId: "store",
      testId: "welcome-scenario",
      expectedRevision: 5,
      test: {
        name: "Welcome scenario",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "check-welcome",
            kind: "validation",
            intent: "Welcome is visible",
            binding: {
              status: "resolved",
              kind: "assertion",
              assertion: {
                kind: "target",
                target: { identifier: "welcome-title" },
                condition: "visible",
              },
            },
          },
        ],
      },
    } as never);
    assert.equal(scenarioSaved.appMap.tests["welcome-scenario"]?.kind, "scenario");
    assert.equal(scenarioSaved.appMap.tests["welcome-scenario"]?.projectId, "mobile");

    const scenarioCompiled = await human.invoke("app-map.test.compile", {
      appMapId: "store",
      testId: "welcome-scenario",
    });
    assert.equal(scenarioCompiled.plan.test.id, "welcome-scenario");
    assert.equal(scenarioCompiled.plan.stepProvenance[0]?.testStepId, "check-welcome");
    assert.equal(scenarioCompiled.preflight.mode, "offline-test-preflight");
    assert.equal(scenarioCompiled.preflight.testId, "welcome-scenario");

    const scenarioEdited = await human.invoke("app-map.test.edit", {
      appMapId: "store",
      testId: "welcome-scenario",
      expectedRevision: 6,
      edits: [
        { kind: "test.patch", patch: { name: "Welcome smoke" } },
        {
          kind: "step.patch",
          stepId: "check-welcome",
          patch: { intent: "The Welcome screen is visible" },
        },
      ],
    });
    const scenario = scenarioEdited.appMap.tests["welcome-scenario"];
    assert.ok(scenario?.kind === "scenario");
    assert.equal(scenario.name, "Welcome smoke");
    assert.equal(scenario.steps[0]?.intent, "The Welcome screen is visible");

    const addedIndependentStep = await human.invoke("app-map.test.edit", {
      appMapId: "store",
      testId: "welcome-scenario",
      expectedRevision: 7,
      edits: [
        {
          kind: "step.add",
          step: {
            id: "confirm-ready",
            kind: "manual",
            intent: "Confirm the device is ready",
            binding: {
              status: "resolved",
              kind: "pause",
              message: "Confirm the device is ready",
            },
          },
        },
      ],
    });
    assert.equal(addedIndependentStep.appMap.revision, 8);

    const rebasedIndependentStep = await agent.invoke("app-map.test.edit", {
      appMapId: "store",
      testId: "welcome-scenario",
      expectedRevision: 7,
      edits: [
        {
          kind: "step.patch",
          stepId: "check-welcome",
          patch: { note: "Agent-reviewed assertion" },
        },
      ],
    });
    const rebasedScenario = rebasedIndependentStep.appMap.tests["welcome-scenario"];
    assert.ok(rebasedScenario?.kind === "scenario");
    assert.equal(rebasedScenario.steps[0]?.note, "Agent-reviewed assertion");
    assert.equal(rebasedScenario.steps[1]?.id, "confirm-ready");
    assert.equal(rebasedIndependentStep.appMap.revision, 9);

    const combineSaved = await human.invoke("app-map.combine.save", {
      appMapId: "store",
      combineId: "language-welcome",
      expectedRevision: 9,
      combine: {
        name: "Language × Welcome",
        variableIds: ["language"],
        testIds: ["welcome-scenario"],
        strategy: "cartesian",
      },
    } as never);
    assert.equal(combineSaved.appMap.combines["language-welcome"]?.id, "language-welcome");

    await assert.rejects(
      agent.invoke("app-map.screen.update", {
        appMapId: "store",
        screenId: "welcome",
        expectedRevision: 3,
        input: { patch: { title: "Start" } },
      }),
      (error) => {
        assert.ok(error instanceof ApiError);
        assert.equal(error.status, 409);
        assert.equal((error.body as { code?: string }).code, "revision-conflict");
        assert.match((error.body as { recovery?: string }).recovery ?? "", /reload/iu);
        return true;
      },
    );

    assert.deepEqual(await human.invoke("app-map.remove", { appMapId: "store" }), { ok: true });
    assert.deepEqual(await human.invoke("app-map.remove", { appMapId: "store-copy" }), {
      ok: true,
    });
    await assert.rejects(human.invoke("app-map.get", { appMapId: "store" }), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 404);
      return true;
    });
    assert.deepEqual(await human.invoke("app-map.list", {}), { appMaps: [] });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("an explicitly confirmed local takeover replaces the observed control session", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-lease-takeover-server-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const connection = {
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" as const },
      organizationId: "local",
      projectId: "default",
    };
    const human = new RelayClient({
      ...connection,
      actorId: "human:designer",
      actorKind: "human",
    });
    const agent = new RelayClient({
      ...connection,
      actorId: "agent:mapper",
      actorKind: "agent",
    });
    const original = await human.lease({
      poolId: "local",
      deviceSerial: "physical-device",
      expiresAt: Date.now() + 60_000,
    });

    await assert.rejects(
      agent.invoke("lease.takeover", {
        leaseId: original.lease.id,
        expiresAt: Date.now() + 120_000,
        reason: "User delegated this unattended run",
        confirm: false as never,
      }),
      /confirm must be true/u,
    );
    const handedOff = await agent.takeOverLease({
      leaseId: original.lease.id,
      reason: "User delegated this unattended run",
      confirm: true,
    });
    assert.match(handedOff.lease.ownerId, /^system:local-control:/u);
    assert.equal(handedOff.lease.controlScope, "local-project");
    assert.ok(handedOff.lease.expiresAt > Date.now());
    assert.equal(handedOff.lease.handoffFromLeaseId, original.lease.id);
    const history = await agent.invoke("lease.list", { status: "all" });
    assert.equal(
      history.leases.find((lease) => lease.id === original.lease.id)?.status,
      "released",
    );
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("App Maps export and import through their canonical YAML contract", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-yaml-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:designer",
      actorKind: "human",
    });
    await client.invoke("app-map.create", { appMapId: "checkout", name: "Checkout" });
    const exported = await client.invoke("app-map.export", { appMapId: "checkout" });
    assert.equal(exported.filename, "checkout.relay.map.yaml");
    assert.match(exported.yaml, /schemaVersion: 1/u);

    const dryRun = await client.invoke("app-map.import", {
      yaml: exported.yaml,
      dryRun: true,
    });
    assert.equal(dryRun.imported, false);

    const copied = await client.invoke("app-map.import", {
      yaml: exported.yaml,
      conflict: "copy",
    });
    assert.equal(copied.imported, true);
    assert.equal(copied.appMap.id, "checkout-copy");
    assert.equal(copied.appMap.projectId, "mobile");
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("an agent turns observations into a proposal that a human must approve", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-observation-proposal-"));
  const previousState = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const connection = {
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" as const },
      organizationId: "acme",
      projectId: "mobile",
    };
    const human = new RelayClient({
      ...connection,
      actorId: "human:reviewer",
      actorKind: "human",
    });
    const agent = new RelayClient({
      ...connection,
      actorId: "agent:explorer",
      actorKind: "agent",
    });
    await human.invoke("app-map.create", { appMapId: "observed", name: "Observed app" });
    const session = await createDiscoverySession({
      id: "agent-observation",
      name: "Agent exploration",
      targetId: "pixel",
      scope: { maxScreens: 4, maxTransitions: 4, maxDurationMs: 60_000 },
    });
    await setDiscoveryStatus(session.id, "running");
    const source = await recordObservedScreen({
      sessionId: session.id,
      nodes: [{ role: "button", label: "Cart", visibleToUser: true }],
    });
    const destination = await recordObservedScreen({
      sessionId: session.id,
      nodes: [{ role: "heading", label: "Your cart", visibleToUser: true }],
    });
    const transition = await recordObservedTransition({
      sessionId: session.id,
      fromScreenId: source.screen.id,
      toScreenId: destination.screen.id,
      kind: "tap",
      label: "Open cart",
      target: { label: "Cart" },
      changedScreen: true,
    });

    const proposed = await agent.invoke("app-map.observations.propose", {
      appMapId: "observed",
      sessionId: session.id,
      expectedRevision: 0,
      proposalId: "proposal-agent-observation",
      transitionIds: [transition.id],
    });
    assert.equal(Object.keys(proposed.appMap.screens).length, 0);
    assert.equal(proposed.appMap.proposals[proposed.proposalId]?.status, "pending");

    const parallel = await agent.invoke("app-map.observations.propose", {
      appMapId: "observed",
      sessionId: session.id,
      expectedRevision: 0,
      proposalId: "proposal-agent-parallel",
      transitionIds: [transition.id],
    });
    assert.equal(Object.keys(parallel.appMap.proposals).length, 2);
    assert.equal(parallel.appMap.proposals[parallel.proposalId]?.sourceRevision, 0);

    const approved = await human.invoke("app-map.proposal.approve", {
      appMapId: "observed",
      proposalId: proposed.proposalId,
      expectedRevision: parallel.appMap.revision,
    });
    assert.equal(Object.keys(approved.appMap.screens).length, 2);
    assert.equal(Object.keys(approved.appMap.connections).length, 1);
    assert.equal(
      approved.appMap.activity[Object.keys(approved.appMap.activity).at(-1)!]?.actorKind,
      "human",
    );
  } finally {
    await server.close();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("a graph Test run freezes one exact revision before enqueueing", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-test-run-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:test-runner",
      actorKind: "human",
    });
    await client.invoke("app-map.create", { appMapId: "atomic-test", name: "Atomic Test" });
    const saved = await client.invoke("app-map.test.save", {
      appMapId: "atomic-test",
      testId: "smoke",
      expectedRevision: 0,
      test: {
        name: "Smoke",
        kind: "scenario",
        intentSchemaVersion: 1,
        steps: [
          {
            id: "prepare",
            kind: "script",
            intent: "Prepare the fixture",
            binding: { status: "resolved", kind: "script", source: "return true" },
          },
        ],
      },
    } as never);
    const lease = await client.invoke("lease.create", {
      poolId: "local",
      deviceSerial: "atomic-target",
      expiresAt: Date.now() + 60_000,
    });

    const result = await client.invoke("app-map.test.run", {
      appMapId: "atomic-test",
      testId: "smoke",
      expectedRevision: saved.appMap.revision,
      target: { kind: "device", platform: "android", targetId: "atomic-target" },
    });
    assert.deepEqual(result.planIdentity, {
      appMapId: "atomic-test",
      appMapRevision: saved.appMap.revision,
      testId: "smoke",
      rootRecipeId: result.plan.rootRecipeId,
    });
    assert.equal(result.job.action, result.plan.rootRecipeId);
    assert.equal(result.job.serial, "atomic-target");
    assert.equal(result.plan.stepProvenance[0]?.testStepId, "prepare");

    const jobsBeforeConflict = await client.invoke("job.list", { limit: 100 });
    await assert.rejects(
      client.invoke("app-map.test.run", {
        appMapId: "atomic-test",
        testId: "smoke",
        expectedRevision: 0,
        target: { kind: "device", platform: "android", targetId: "atomic-target" },
      }),
      (error) => error instanceof ApiError && error.status === 409,
    );
    const jobsAfterConflict = await client.invoke("job.list", { limit: 100 });
    assert.equal(jobsAfterConflict.jobs.length, jobsBeforeConflict.jobs.length);
    await client.invoke("job.cancel", { jobId: result.job.id });
    await client.invoke("lease.release", { leaseId: lease.lease.id });
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("a saved App Map flow runs without an auxiliary canvas document", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-app-map-run-"));
  const previous = process.env.RELAY_STATE_DIR;
  const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_WORKSPACE_ROOT = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:runner",
      actorKind: "human",
    });
    await client.invoke("app-map.create", { appMapId: "store", name: "Store" });
    const scoped = (id: string) => ({
      id,
      organizationId: "acme",
      projectId: "mobile",
      appMapId: "store",
      createdAt: 100,
      updatedAt: 100,
    });
    await client.invoke("app-map.screen.add", {
      appMapId: "store",
      expectedRevision: 0,
      screen: {
        id: "welcome",
        title: "Welcome",
        identity: { schemaVersion: 1, fingerprint: "a".repeat(64) },
      },
    });
    await client.invoke("app-map.screen.add", {
      appMapId: "store",
      expectedRevision: 1,
      screen: {
        id: "home",
        title: "Home",
        identity: { schemaVersion: 1, fingerprint: "b".repeat(64) },
      },
    });
    await client.invoke("app-map.connection.create", {
      appMapId: "store",
      expectedRevision: 2,
      connection: {
        id: "continue",
        fromScreenId: "welcome",
        destination: { kind: "screen", screenId: "home" },
        state: "ready",
        actions: [{ id: "tap-continue", kind: "tap", target: { label: "Continue" } }],
      },
    });
    await client.updateVariables({
      expectedRevision: 0,
      value: [
        {
          id: "thinking-level",
          name: "thinking_level",
          scope: "shared",
          source: "list",
          values: ["low", "medium", "high", "xhigh", "pro"],
        },
        {
          id: "login",
          name: "login_email",
          scope: "private",
          source: "static",
        },
      ],
    });
    await client.invoke("app-map.case-stack.attach", {
      appMapId: "store",
      connectionId: "continue",
      caseStackId: "thinking-levels",
      expectedRevision: 3,
      caseStack: {
        ...scoped("thinking-levels"),
        name: "Thinking levels",
        dataIds: ["thinking-level", "login"],
        strategy: "zip",
        maxCases: 10,
      },
    });
    await client.invoke("app-map.routine.save", {
      appMapId: "store",
      routineId: "start-clean",
      expectedRevision: 4,
      routine: {
        name: "Start clean",
        actions: [{ id: "new-conversation", kind: "tap", target: { identifier: "grok-compose" } }],
      },
    });
    await client.invoke("app-map.flow.save", {
      appMapId: "store",
      flowId: "main",
      expectedRevision: 5,
      flow: {
        name: "Main",
        startScreenId: "welcome",
        setup: { routineId: "start-clean" },
        connectionIds: ["continue"],
      },
    });
    const virtualLease = await client.invoke("lease.create", {
      poolId: "local",
      deviceSerial: "virtual-target",
      expiresAt: Date.now() + 60_000,
    });

    const result = await client.invoke("app-map.flow.run", {
      appMapId: "store",
      flowId: "main",
      serial: "virtual-target",
      platform: "android",
      targetKind: "device",
      variables: { login_email: "person@example.test" },
    });
    assert.equal(result.plan.appMapId, "store");
    assert.equal(result.plan.appMapRevision, 6);
    assert.equal(result.plan.flow.id, "main");
    assert.equal(result.plan.flow.setup?.routineId, "start-clean");
    assert.deepEqual(
      result.plan.recipes[result.plan.rootRecipeId]!.steps.map((step) => step.kind),
      ["module", "expect-screen", "tap", "expect-screen"],
    );
    assert.equal((result.job as { projectId?: string }).projectId, "mobile");
    assert.equal(result.jobs.length, 5);
    assert.deepEqual(
      result.matrix?.cases.map((item) => item.name),
      ["Private case 1", "Private case 2", "Private case 3", "Private case 4", "Private case 5"],
    );
    assert.equal(
      (result.jobs[0] as { resolvedInputs?: Record<string, unknown> }).resolvedInputs?.login_email,
      "[private]",
    );
    assert.equal(JSON.stringify(result).includes("person@example.test"), false);

    const connectionResult = await client.invoke("app-map.connection.run", {
      appMapId: "store",
      connectionId: "continue",
      serial: "virtual-target",
      platform: "android",
      targetKind: "device",
      variables: { login_email: "person@example.test" },
    });
    assert.equal(connectionResult.plan.connection.id, "continue");
    assert.deepEqual(
      connectionResult.plan.recipes[connectionResult.plan.rootRecipeId]!.steps.map(
        (step) => step.kind,
      ),
      ["expect-screen", "tap", "expect-screen"],
    );
    assert.equal(connectionResult.jobs.length, 5);
    assert.equal(JSON.stringify(connectionResult).includes("person@example.test"), false);

    const browserCaseProfile = compileBrowserEnvironment({
      engine: "webkit",
      viewport: { width: 390, height: 844 },
      locale: "pt-BR",
      timezoneId: "America/Maceio",
      colorScheme: "dark",
    });
    await saveBrowserTarget({
      id: "browser-flow",
      name: "Browser flow",
      startUrl: "https://example.test",
      environment: browserCaseProfile,
    });
    const browserResult = await client.invoke("app-map.flow.run", {
      appMapId: "store",
      flowId: "main",
      serial: "browser-flow",
      targetKind: "browser",
      variables: { login_email: "person@example.test" },
    });
    const browserJob = browserResult.job as {
      targetKind?: string;
      browserTargetId?: string;
      targetProfile?: { browserCaseProfile?: unknown };
    };
    assert.equal(browserJob.targetKind, "browser");
    assert.equal(browserJob.browserTargetId, "browser-flow");
    assert.deepEqual(browserJob.targetProfile?.browserCaseProfile, browserCaseProfile);

    // A renderer cannot release the server-owned local control session out
    // from under the other local windows and agents that joined it.
    const retained = await client.invoke("lease.release", { leaseId: virtualLease.lease.id });
    assert.equal(retained.lease.status, "leased");
    assert.equal(retained.lease.id, virtualLease.lease.id);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
    else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
    await rm(root, { recursive: true, force: true });
  }
});

test("screen consolidation previews without writing, then applies one revision", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-screen-consolidate-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:mapper",
      actorKind: "human",
    });
    await client.invoke("app-map.create", { appMapId: "settings-map", name: "Settings" });
    await client.invoke("app-map.screen.add", {
      appMapId: "settings-map",
      expectedRevision: 0,
      screen: { id: "settings", title: "Settings" },
    });
    await client.invoke("app-map.screen.add", {
      appMapId: "settings-map",
      expectedRevision: 1,
      screen: { id: "settings-bottom", title: "Settings · Bottom" },
    });
    await client.invoke("app-map.connection.create", {
      appMapId: "settings-map",
      expectedRevision: 2,
      connection: {
        id: "kids",
        fromScreenId: "settings-bottom",
        destination: { kind: "end" },
        actions: [
          { id: "tap-kids", kind: "tap", target: { identifier: "kids", label: "Kids Mode" } },
        ],
      },
    });
    const dryRun = await client.invoke("app-map.screen.consolidate", {
      appMapId: "settings-map",
      targetScreenId: "settings",
      sourceScreenIds: ["settings-bottom"],
      expectedRevision: 3,
      dryRun: true,
    });
    assert.equal(dryRun.applied, false);
    assert.equal(dryRun.appMap.revision, 3);
    assert.ok(dryRun.appMap.screens["settings-bottom"]);
    assert.deepEqual(dryRun.preview.semanticRevealConnectionIds, ["kids"]);

    const applied = await client.invoke("app-map.screen.consolidate", {
      appMapId: "settings-map",
      targetScreenId: "settings",
      sourceScreenIds: ["settings-bottom"],
      expectedRevision: 3,
      eventId: "merge-settings",
    });
    assert.equal(applied.applied, true);
    assert.equal(applied.appMap.revision, 4);
    assert.equal(applied.appMap.screens["settings-bottom"], undefined);
    assert.equal(applied.appMap.connections.kids?.fromScreenId, "settings");
    assert.equal(applied.appMap.connections.kids?.actions[0]?.kind, "reveal");
    const repeated = await client.invoke("app-map.screen.consolidate", {
      appMapId: "settings-map",
      targetScreenId: "settings",
      sourceScreenIds: ["settings-bottom"],
      expectedRevision: 3,
      eventId: "merge-settings",
    });
    assert.equal(repeated.appMap.revision, 4);
    assert.deepEqual(repeated.preview, applied.preview);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});

test("screen consolidation materializes only server-derived surface artifacts", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-screen-consolidate-evidence-"));
  const previous = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  const server = await startServer({ host: "127.0.0.1", port: 0 });
  try {
    const client = new RelayClient({
      url: `http://127.0.0.1:${server.port}`,
      auth: { type: "none" },
      organizationId: "acme",
      projectId: "mobile",
      actorId: "human:mapper",
      actorKind: "human",
    });
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    const saveRaw = async (kind: "screenshot" | "snapshot", data: Buffer | string) =>
      persistAuthoringEvidence({
        kind,
        capturedAt: 10,
        data,
        mime: kind === "screenshot" ? "image/png" : "application/json",
      });
    const screenshot = await saveRaw("screenshot", png);
    const topTree = await saveRaw(
      "snapshot",
      JSON.stringify({
        inspectable: true,
        nodes: [{ role: "cell", label: "Appearance", rect: { x: 0, y: 0, width: 1, height: 1 } }],
      }),
    );
    const bottomTree = await saveRaw(
      "snapshot",
      JSON.stringify({
        inspectable: true,
        nodes: [{ role: "cell", label: "Kids Mode", rect: { x: 0, y: 0, width: 1, height: 1 } }],
      }),
    );
    const ref = <T extends "image/png" | "application/json">(
      evidence: typeof screenshot,
      mime: T,
    ) => ({
      id: evidence.id,
      uri: evidence.uri,
      sha256: evidence.sha256!,
      bytes: evidence.bytes!,
      mime,
    });
    const screenshotRef = ref(screenshot, "image/png");
    const topTreeRef = ref(topTree, "application/json");
    const bottomTreeRef = ref(bottomTree, "application/json");
    await client.invoke("app-map.create", { appMapId: "settings-evidence", name: "Settings" });
    await client.invoke("app-map.screen.add", {
      appMapId: "settings-evidence",
      expectedRevision: 0,
      screen: { id: "settings", title: "Settings top" },
    });
    await client.invoke("app-map.screen.add", {
      appMapId: "settings-evidence",
      expectedRevision: 1,
      screen: { id: "settings-bottom", title: "Settings bottom" },
    });
    const targetProfile = {
      id: "pixel",
      targetId: "phone",
      source: "device" as const,
      platform: "android" as const,
      name: "Pixel",
      capabilities: ["snapshot" as const, "screenshot" as const],
      observedAt: 10,
    };
    await mutateStoredAppMap("mobile", "settings-evidence", (current) => {
      const next = structuredClone(current);
      const mutationAt = current.updatedAt + 1;
      const variantEntity = (id: string) => ({
        id,
        organizationId: current.organizationId,
        projectId: current.projectId,
        appMapId: current.id,
        createdAt: mutationAt,
        updatedAt: mutationAt,
      });
      next.screenVariants.top = {
        ...variantEntity("top"),
        screenId: "settings",
        targetProfile,
        observation: { fingerprint: "1".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [screenshotRef.id, topTreeRef.id],
        evidenceUris: [screenshotRef.uri, topTreeRef.uri],
      };
      next.screenVariants.bottom = {
        ...variantEntity("bottom"),
        screenId: "settings-bottom",
        targetProfile,
        observation: { fingerprint: "2".repeat(64), nodes: [], volatileSignals: [] },
        evidenceIds: [screenshotRef.id, bottomTreeRef.id],
        evidenceUris: [screenshotRef.uri, bottomTreeRef.uri],
      };
      next.screens.settings!.variantIds = ["top"];
      next.screens["settings-bottom"]!.variantIds = ["bottom"];
      next.revision += 1;
      next.updatedAt = mutationAt;
      return next;
    });
    await client.invoke("app-map.connection.create", {
      appMapId: "settings-evidence",
      expectedRevision: 3,
      connection: {
        id: "kids",
        fromScreenId: "settings-bottom",
        destination: { kind: "end" },
        actions: [{ id: "tap-kids", kind: "tap", target: { label: "Kids Mode" } }],
      },
    });
    const surfaceImport = {
      schemaVersion: 1 as const,
      id: "settings-surface",
      targetProfileId: "pixel",
      capturePolicy: {
        captureMode: "full-surface" as const,
        source: "explicit" as const,
        reason: "Settings is one logical surface",
        decidedAt: 10,
      },
      message: "Offsets were imported; no visual seam was claimed",
      restoredStartViewport: true,
      viewports: [
        {
          index: 0,
          offsetY: 0,
          appendedHeight: 1,
          capturedAt: 10,
          width: 1,
          height: 1,
          screenshot: screenshotRef,
          accessibilityTree: topTreeRef,
        },
        {
          index: 1,
          offsetY: 1,
          appendedHeight: 1,
          capturedAt: 11,
          width: 1,
          height: 1,
          screenshot: screenshotRef,
          accessibilityTree: bottomTreeRef,
        },
      ],
    };
    const evidenceDirectory = join(root, "authoring-evidence");
    const beforeDryRun = (await readdir(evidenceDirectory)).sort();
    const dryRun = await client.invoke("app-map.screen.consolidate", {
      appMapId: "settings-evidence",
      targetScreenId: "settings",
      sourceScreenIds: ["settings-bottom"],
      expectedRevision: 4,
      dryRun: true,
      surfaceImport,
    });
    assert.equal(dryRun.applied, false);
    assert.deepEqual((await readdir(evidenceDirectory)).sort(), beforeDryRun);

    await assert.rejects(
      client.invoke("app-map.screen.consolidate", {
        appMapId: "settings-evidence",
        targetScreenId: "settings",
        sourceScreenIds: ["settings-bottom"],
        expectedRevision: 4,
        surfaceImport: {
          ...surfaceImport,
          viewports: [
            surfaceImport.viewports[0]!,
            {
              ...surfaceImport.viewports[1]!,
              accessibilityTree: {
                ...surfaceImport.viewports[1]!.accessibilityTree,
                sha256: "f".repeat(64),
                uri: `relay-evidence://${"f".repeat(64)}`,
              },
            },
          ],
        },
      }),
    );
    assert.equal(
      (await client.invoke("app-map.get", { appMapId: "settings-evidence" })).appMap.revision,
      4,
    );
    assert.deepEqual((await readdir(evidenceDirectory)).sort(), beforeDryRun);

    const planned = await materializeLogicalScrollSurfaceImport({
      surfaceImport,
      targetProfile,
      ownedEvidenceIds: new Set([screenshotRef.id, topTreeRef.id, bottomTreeRef.id]),
      ownedEvidenceUris: new Set([screenshotRef.uri, topTreeRef.uri, bottomTreeRef.uri]),
      persist: false,
    });
    const corruptManifestPath = join(evidenceDirectory, planned.manifest.sha256);
    await writeFile(corruptManifestPath, "partial manifest");
    await assert.rejects(
      client.invoke("app-map.screen.consolidate", {
        appMapId: "settings-evidence",
        targetScreenId: "settings",
        sourceScreenIds: ["settings-bottom"],
        expectedRevision: 4,
        eventId: "failed-materialization",
        surfaceImport,
      }),
      /corrupt/,
    );
    assert.equal(
      (await client.invoke("app-map.get", { appMapId: "settings-evidence" })).appMap.revision,
      4,
    );
    await unlink(corruptManifestPath);

    const applied = await client.invoke("app-map.screen.consolidate", {
      appMapId: "settings-evidence",
      targetScreenId: "settings",
      sourceScreenIds: ["settings-bottom"],
      expectedRevision: 4,
      eventId: "materialize-settings",
      targetTitle: "Settings",
      surfaceImport,
    });
    const surface = applied.appMap.screenVariants.top!.scrollSurfaces![0]!;
    assert.equal(surface.composite, undefined);
    assert.deepEqual(
      surface.viewports.map(({ offsetY }) => offsetY),
      [0, 1],
    );
    const mergedTree = JSON.parse(
      (await readAuthoringEvidence(surface.mergedTree.sha256))!.toString("utf8"),
    );
    assert.deepEqual(
      mergedTree.nodes.map(({ label }: { label: string }) => label),
      ["Appearance", "Kids Mode"],
    );
    const manifest = JSON.parse(
      (await readAuthoringEvidence(surface.manifest.sha256))!.toString("utf8"),
    );
    assert.equal(manifest.surface.captureId, surface.captureId);
    assert.equal(manifest.surface.manifest, undefined);
    const resource = await fetch(
      `http://127.0.0.1:${server.port}/authoring-evidence/${surface.manifest.sha256}?mime=application/json`,
      { headers: { "X-Organization-Id": "acme", "X-Project-Id": "mobile" } },
    );
    assert.equal(resource.status, 200);
    const regenerated = await materializeLogicalScrollSurfaceImport({
      surfaceImport,
      targetProfile,
      ownedEvidenceIds: new Set([screenshotRef.id, topTreeRef.id, bottomTreeRef.id]),
      ownedEvidenceUris: new Set([screenshotRef.uri, topTreeRef.uri, bottomTreeRef.uri]),
      persist: false,
    });
    assert.equal(regenerated.mergedTree.sha256, surface.mergedTree.sha256);
    assert.equal(regenerated.manifest.sha256, surface.manifest.sha256);
    const regeneratedFromSavedSurface = await regenerateLogicalScrollSurface({
      surface,
      targetProfile,
    });
    assert.equal(regeneratedFromSavedSurface.captureId, surface.captureId);
    assert.equal(regeneratedFromSavedSurface.manifest.sha256, surface.manifest.sha256);
    assert.equal(applied.appMap.revision, 5);
  } finally {
    await server.close();
    if (previous === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previous;
    await rm(root, { recursive: true, force: true });
  }
});
