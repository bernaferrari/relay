import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition } from "./operations.js";
import { laneSaveInputSchema } from "./lane.js";

const browserLane = {
  id: "shop-lab",
  appMapId: "shop-web",
  target: { kind: "browser" as const, browserTargetId: "shop-web" },
  targetProfileId: "browser:shop-web-1280x800-lab",
  engine: "chromium" as const,
  account: {
    kind: "fixture" as const,
    accountId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    accountRevision: "1",
    reference: "authfx:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:1",
  },
  actorId: "human:lab",
  capture: { mode: "every-screen" as const },
};

test("lane.save accepts the profileTargets overlay shape", () => {
  assert.deepEqual(operationDefinition("lane.save").input.parse(browserLane), browserLane);
  assert.deepEqual(laneSaveInputSchema.parse(browserLane), browserLane);
});

test("lane.save requires engine and account together on browser Lanes", () => {
  assert.throws(
    () => operationDefinition("lane.save").input.parse({ ...browserLane, account: undefined }),
    /account/,
  );
  assert.throws(
    () => operationDefinition("lane.save").input.parse({ ...browserLane, engine: undefined }),
    /engine/,
  );
});

test("lane.save rejects engine or account on a device Lane", () => {
  assert.throws(
    () =>
      operationDefinition("lane.save").input.parse({
        id: "phone",
        appMapId: "shop-android",
        target: { kind: "device", serial: "SERIAL", platform: "android" },
        engine: "chromium",
        account: { kind: "signed-out", attested: true },
      }),
    /engine only applies/,
  );
});

test("lane.list, lane.save, and lane.remove sit next to device-pool transports", () => {
  assert.deepEqual(operationDefinition("lane.list").transport, { method: "GET", path: "/lanes" });
  assert.deepEqual(operationDefinition("lane.save").transport, { method: "POST", path: "/lanes" });
  assert.deepEqual(operationDefinition("lane.remove").transport, {
    method: "DELETE",
    path: "/lanes/:laneId",
  });
  assert.equal(operationDefinition("lane.remove").confirmation, "none");
});

test("lane.remove takes the path laneId", () => {
  assert.deepEqual(operationDefinition("lane.remove").input.parse({ laneId: "shop-lab" }), {
    laneId: "shop-lab",
  });
});

test("test run and combine start accept laneId instead of a client overlay", () => {
  assert.deepEqual(
    operationDefinition("app-map.test.run").input.parse({
      appMapId: "shop-web",
      testId: "open-home",
      laneId: "shop-daily",
    }),
    { appMapId: "shop-web", testId: "open-home", laneId: "shop-daily" },
  );
  assert.throws(
    () =>
      operationDefinition("app-map.test.run").input.parse({
        appMapId: "shop-web",
        testId: "open-home",
        laneId: "shop-daily",
        expectedRevision: 3,
      }),
    /expectedRevision is filled from Lane/,
  );
  assert.deepEqual(
    operationDefinition("job.combine.start").input.parse({
      appMapId: "shop-web",
      combineId: "daily",
      laneId: "shop-lab",
    }),
    { appMapId: "shop-web", combineId: "daily", laneId: "shop-lab" },
  );
  assert.deepEqual(
    operationDefinition("target.interact").input.parse({
      laneId: "shop-lab",
      kind: "label",
      label: "Back",
      preview: true,
    }),
    { laneId: "shop-lab", kind: "label", label: "Back", preview: true },
  );
  assert.deepEqual(
    operationDefinition("target.snapshot.capture").input.parse({ laneId: "shop-lab" }),
    {
      laneId: "shop-lab",
    },
  );
});
