import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  resetDeviceClients,
  setLocalDeviceProvider,
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

test("screen alias-observe approves the current target screen over HTTP", async () => {
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
  setLocalDeviceProvider({
    kind: "device",
    create: () =>
      ({
        capture: {
          snapshot: async () => ({ nodes: liveNodes }),
          screenshot: async ({ path }: { path: string }) => {
            await writeFile(path, raster);
            return { path };
          },
        },
      }) as never,
  });
  let server: StartedServer | undefined;
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
    setLocalDeviceProvider(undefined);
    resetDeviceClients();
    resetControlDatabaseCache();
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
});
