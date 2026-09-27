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
  type AuthoringRuntime,
} from "@relay/core";

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
  "screen refresh previews exact evidence and preserves prior variants and identity",
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
      const added = await client.invoke("app-map.screen.add", {
        appMapId: "settings",
        expectedRevision: captured.appMapRevision,
        screen: { id: "other", title: "Other screen" },
      });
      await client.invoke("app-map.connection.create", {
        appMapId: "settings",
        expectedRevision: added.appMap.revision,
        connection: {
          id: "retained-path",
          fromScreenId: screenId,
          destination: { kind: "screen", screenId: "other" },
          label: "Keep this connection",
        },
      });
      const before = (await client.invoke("app-map.get", { appMapId: "settings" })).appMap;
      liveNodes = spanishNodes;
      const prepare = () =>
        client.invoke("app-map.screen.refresh.prepare", {
          appMapId: "settings",
          screenId,
          expectedRevision: before.revision,
          target,
          leaseId: leaseId!,
        });
      const preview = await prepare();
      assert.ok(preview.screenshotUri.startsWith("relay-evidence://"));
      assert.ok(preview.expiresAt > Date.now());
      assert.deepEqual(
        (await client.invoke("app-map.get", { appMapId: "settings" })).appMap,
        before,
      );
      const stalePreview = await prepare();
      const applyInput = {
        appMapId: "settings",
        screenId,
        expectedRevision: before.revision,
        token: preview.token,
      };
      const otherActor = new RelayClient({
        url: `http://127.0.0.1:${server.port}`,
        auth: { type: "none" },
        organizationId: "acme",
        projectId: "mobile",
        actorId: "agent:other",
        actorKind: "agent",
      });
      await assert.rejects(
        otherActor.invoke("app-map.screen.refresh.apply", applyInput),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );
      liveNodes = englishNodes; // Applying must not capture the now changed target.
      const refreshed = await client.invoke("app-map.screen.refresh.apply", applyInput);
      assert.equal(refreshed.variant.screenshotUri, preview.screenshotUri);
      assert.notEqual(refreshed.variant.id, captured.variant.id);
      assert.deepEqual(
        refreshed.appMap.screenVariants[captured.variant.id],
        before.screenVariants[captured.variant.id],
      );
      assert.deepEqual(refreshed.screen.identity, before.screens[screenId]!.identity);
      assert.deepEqual(refreshed.appMap.connections, before.connections);
      assert.deepEqual(refreshed.appMap.screens.other, before.screens.other);
      assert.deepEqual(refreshed.screen.variantIds, [
        ...before.screens[screenId]!.variantIds,
        refreshed.variant.id,
      ]);
      await assert.rejects(
        client.invoke("app-map.screen.refresh.apply", {
          ...applyInput,
          expectedRevision: refreshed.appMap.revision,
        }),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );
      await assert.rejects(
        client.invoke("app-map.screen.refresh.apply", { ...applyInput, token: stalePreview.token }),
        (error: unknown) => error instanceof ApiError && error.status === 409,
      );
      const expiring = await client.invoke("app-map.screen.refresh.prepare", {
        appMapId: "settings",
        screenId,
        expectedRevision: refreshed.appMap.revision,
        target,
        leaseId,
      });
      const clock = Date.now;
      try {
        Date.now = () => expiring.expiresAt + 1;
        await assert.rejects(
          client.invoke("app-map.screen.refresh.apply", {
            ...applyInput,
            token: expiring.token,
            expectedRevision: refreshed.appMap.revision,
          }),
          (error: unknown) => error instanceof ApiError && error.status === 409,
        );
      } finally {
        Date.now = clock;
      }
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
