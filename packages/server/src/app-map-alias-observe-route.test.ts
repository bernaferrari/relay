import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { ApiError, RelayClient } from "@relay/client";
import {
  leaseDevice,
  observeScreenIdentity,
  releaseDeviceLease,
  resetControlDatabaseCache,
  saveBrowserTarget,
  type AuthoringRuntime,
} from "@relay/core";
import { compileBrowserEnvironment } from "@relay/protocol";
import { startServer } from "./index.js";
import type { StartedServer } from "./server-types.js";

const englishNodes = [
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
];
const spanishNodes = [
  {
    index: 1,
    type: "Cell",
    label: "Inglés",
    identifier: "language.en",
    visibleToUser: true,
    enabled: true,
    hittable: true,
    rect: { x: 0, y: 20, width: 300, height: 44 },
  },
];

test(
  "screen alias-observe approves the current target screen over HTTP",
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-alias-observe-route-"));
    const previousState = process.env.RELAY_STATE_DIR;
    process.env.RELAY_STATE_DIR = root;
    resetControlDatabaseCache();
    const actorId = "agent:alias-observe-route-test";
    const targetId = "ios-alias-fixture";
    const raster = await readFile(
      fileURLToPath(new URL("../../app/public/relay-icon.png", import.meta.url)),
    );
    // The stub device shows whichever tree the test last installed, standing in
    // for one physical screen observed under two locales.
    let liveNodes = englishNodes;
    const authoringRuntime: AuthoringRuntime = {
      async observe() {
        return {
          capturedAt: Date.now(),
          targetId,
          fingerprint: observeScreenIdentity(liveNodes).fingerprint,
          bounds: { width: 300, height: 600 },
          nodes: liveNodes,
          screenshot: { data: raster, mime: "image/png" },
        };
      },
      async execute() {},
      async replay() {},
    };
    let server: StartedServer | undefined;
    let leaseId: string | undefined;
    try {
      server = await startServer({ host: "127.0.0.1", port: 0, authoringRuntime });
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
      const target = { kind: "device" as const, platform: "ios" as const, targetId };

      const captured = await client.invoke("app-map.screen.capture", {
        appMapId: "settings",
        expectedRevision: 0,
        target,
        leaseId,
        title: "Language",
      });
      const screenId = captured.screen.id;
      const primary = captured.screen.identity?.fingerprint;
      assert.ok(primary, "capture establishes the screen identity");

      // First run in a new locale: the same screen observes a different tree.
      liveNodes = spanishNodes;
      const observed = await client.invoke("app-map.screen.alias-observe", {
        appMapId: "settings",
        screenId,
        expectedRevision: captured.appMapRevision,
        target,
        leaseId,
      });
      const expectedAlias = observeScreenIdentity(spanishNodes).fingerprint;
      assert.equal(observed.alias.fingerprint, expectedAlias);
      assert.ok(observed.alias.aliasesNow.includes(expectedAlias));
      const identity = observed.appMap.screens[screenId]?.identity;
      assert.equal(identity?.fingerprint, primary, "primary fingerprint is never replaced");
      assert.deepEqual(identity?.aliases, observed.alias.aliasesNow);
      assert.equal(observed.screen.id, screenId);
      assert.equal(observed.variant.id, captured.variant.id);
      assert.equal(observed.variant.screenId, screenId);
      assert.equal(observed.variant.targetProfile.targetId, targetId);
      assert.equal(observed.variant.targetProfile.platform, "ios");
      assert.ok(observed.variant.screenshotUri, "the observed screenshot remains attached");
      assert.ok(
        observed.variant.rawAccessibilityTree,
        "the observed accessibility tree remains attached",
      );
      assert.ok(observed.variant.evidenceIds.length >= 2, "both immutable evidence planes persist");
      assert.ok(observed.appMap.revision > captured.appMapRevision);

      // Repeating the approval in the same locale deduplicates the alias.
      const repeated = await client.invoke("app-map.screen.alias-observe", {
        appMapId: "settings",
        screenId,
        expectedRevision: observed.appMap.revision,
        target,
        leaseId,
      });
      assert.deepEqual(repeated.alias.aliasesNow, observed.alias.aliasesNow);
      assert.equal(repeated.variant.id, observed.variant.id);
      assert.deepEqual(repeated.screen.variantIds, observed.screen.variantIds);

      await assert.rejects(
        client.invoke("app-map.screen.alias-observe", {
          appMapId: "settings",
          screenId: "missing-screen",
          expectedRevision: repeated.appMap.revision,
          target,
          leaseId,
        }),
        (error: unknown) => error instanceof ApiError && error.status === 404,
      );
    } finally {
      if (leaseId) await releaseDeviceLease(leaseId).catch(() => undefined);
      if (server) await server.close();
      resetControlDatabaseCache();
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "screen alias-observe retains the managed browser profile and evidence",
  { timeout: 60_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-browser-alias-observe-route-"));
    const previousState = process.env.RELAY_STATE_DIR;
    const previousWorkspace = process.env.RELAY_WORKSPACE_ROOT;
    process.env.RELAY_STATE_DIR = root;
    process.env.RELAY_WORKSPACE_ROOT = root;
    resetControlDatabaseCache();
    const actorId = "agent:browser-alias-observe-route-test";
    const targetId = "browser-alias-fixture";
    const environment = compileBrowserEnvironment({
      engine: "chromium",
      viewport: { width: 390, height: 844 },
      locale: "pt-BR",
      timezoneId: "America/Maceio",
      colorScheme: "dark",
      networkProfile: "wifi-slow",
      authenticationFixtureId: "member-session",
      featureFlagFixtureId: "checkout-v2",
      environmentRevision: "browser-alias-1",
    });
    await saveBrowserTarget({
      id: targetId,
      name: "Browser alias fixture",
      startUrl: "https://example.com",
      headless: true,
      environment,
    });
    const raster = await readFile(
      fileURLToPath(new URL("../../app/public/relay-icon.png", import.meta.url)),
    );
    let liveNodes = englishNodes;
    const authoringRuntime: AuthoringRuntime = {
      async observe() {
        return {
          capturedAt: Date.now(),
          targetId,
          fingerprint: observeScreenIdentity(liveNodes).fingerprint,
          // The browser profile is the capture authority; this deliberately
          // differs to prove the managed environment is not replaced by
          // transient observation bounds.
          bounds: { width: 1_280, height: 800 },
          nodes: liveNodes,
          screenshot: { data: raster, mime: "image/png" },
        };
      },
      async execute() {},
      async replay() {},
    };
    let server: StartedServer | undefined;
    let leaseId: string | undefined;
    try {
      server = await startServer({ host: "127.0.0.1", port: 0, authoringRuntime });
      const client = new RelayClient({
        url: `http://127.0.0.1:${server.port}`,
        auth: { type: "none" },
        organizationId: "acme",
        projectId: "browser-mobile",
        actorId,
        actorKind: "agent",
      });
      await client.invoke("app-map.create", { appMapId: "settings", name: "Settings" });
      const lease = await leaseDevice({
        organizationId: "acme",
        projectId: "browser-mobile",
        poolId: "local",
        deviceSerial: targetId,
        ownerId: actorId,
        expiresAt: Date.now() + 60_000,
      });
      leaseId = lease.id;
      const target = { kind: "browser" as const, platform: "browser" as const, targetId };
      const captured = await client.invoke("app-map.screen.capture", {
        appMapId: "settings",
        expectedRevision: 0,
        target,
        leaseId,
        title: "Language",
      });
      liveNodes = spanishNodes;
      const observed = await client.invoke("app-map.screen.alias-observe", {
        appMapId: "settings",
        screenId: captured.screen.id,
        expectedRevision: captured.appMapRevision,
        target,
        leaseId,
      });
      assert.equal(observed.screen.id, captured.screen.id);
      assert.equal(observed.variant.screenId, captured.screen.id);
      assert.equal(observed.variant.id, captured.variant.id);
      assert.deepEqual(observed.variant.targetProfile.browserCaseProfile, environment);
      assert.deepEqual(observed.variant.targetProfile.viewport, environment.viewport);
      assert.notDeepEqual(observed.variant.targetProfile.viewport, { width: 1_280, height: 800 });
      assert.ok(observed.variant.screenshotUri);
      assert.ok(observed.variant.rawAccessibilityTree);
      assert.ok(observed.variant.evidenceIds.length >= 2);
    } finally {
      if (leaseId) await releaseDeviceLease(leaseId).catch(() => undefined);
      if (server) await server.close();
      resetControlDatabaseCache();
      if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
      else process.env.RELAY_STATE_DIR = previousState;
      if (previousWorkspace === undefined) delete process.env.RELAY_WORKSPACE_ROOT;
      else process.env.RELAY_WORKSPACE_ROOT = previousWorkspace;
      await rm(root, { recursive: true, force: true });
    }
  },
);
