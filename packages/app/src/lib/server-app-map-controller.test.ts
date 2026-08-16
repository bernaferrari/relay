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
