import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, DegradedAppMapRef, OperationId } from "@relay/protocol";
import { createServerAppMapController } from "./server-app-map-controller";

test("refreshAppMaps keeps healthy maps and quarantined maps separately", async () => {
  const maps = [{ id: "ok" } as AppMap];
  const degraded: DegradedAppMapRef[] = [{ key: "p:bad", error: "unknown field cleanup" }];
  const controller = createServerAppMapController({
    health: () => "online",
    runAction: async (operationId: OperationId) => {
      assert.equal(operationId, "app-map.list");
      return { appMaps: maps, degraded } as never;
    },
  });
  const listed = await controller.refreshAppMaps();
  assert.equal(listed, maps);
  assert.deepEqual(controller.appMaps(), maps);
  assert.deepEqual(controller.degradedAppMaps(), degraded);
  assert.equal(controller.appMapsLoaded(), true);
});

test("catalog refreshes coalesce while a newer request receives a trailing snapshot", async () => {
  const stale = [{ id: "stale" } as AppMap];
  const fresh = [{ id: "fresh" } as AppMap];
  let lists = 0;
  let releaseFirst!: () => void;
  const firstList = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const controller = createServerAppMapController({
    health: () => "online",
    runAction: async (operationId: OperationId) => {
      assert.equal(operationId, "app-map.list");
      lists += 1;
      if (lists === 1) {
        await firstList;
        return { appMaps: stale } as never;
      }
      return { appMaps: fresh } as never;
    },
  });

  const first = controller.refreshAppMaps();
  const concurrent = controller.refreshAppMaps();
  await Promise.resolve();
  assert.equal(lists, 1);

  const afterWrite = controller.refreshAppMaps();
  releaseFirst();
  assert.deepEqual(await Promise.all([first, concurrent]), [stale, stale]);

  await Promise.resolve();
  assert.equal(lists, 2);
  assert.deepEqual(await afterWrite, fresh);
  assert.deepEqual(controller.appMaps(), fresh);
});

test("detail reads remain direct while a catalog refresh is in flight", async () => {
  const detailed = { id: "map-with-evidence" } as AppMap;
  let releaseList!: () => void;
  const list = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  const calls: string[] = [];
  const controller = createServerAppMapController({
    health: () => "online",
    runAction: async (operationId: OperationId) => {
      calls.push(operationId);
      if (operationId === "app-map.list") {
        await list;
        return { appMaps: [] } as never;
      }
      assert.equal(operationId, "app-map.get");
      return { appMap: detailed } as never;
    },
  });

  const catalog = controller.refreshAppMaps();
  await Promise.resolve();
  assert.equal(await controller.loadAppMap(detailed.id), detailed);
  assert.deepEqual(calls, ["app-map.list", "app-map.get"]);

  releaseList();
  await catalog;
});
