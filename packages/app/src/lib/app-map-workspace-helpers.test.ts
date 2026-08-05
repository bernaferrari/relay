import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapBatchChange } from "@relay/protocol";
import { appMapLoadFailure, orderCanvasChanges } from "./app-map-workspace-helpers";

test("appMapLoadFailure maps auth, missing, client, and transport failures", () => {
  assert.equal(appMapLoadFailure({ status: 403 }).title, "Relay can’t access this map");
  assert.equal(appMapLoadFailure({ status: 404 }).title, "This map is no longer available");
  assert.equal(appMapLoadFailure({ status: 422 }).title, "Relay couldn’t read this map");
  assert.equal(appMapLoadFailure(new Error("offline")).title, "Relay couldn’t reach this map");
  assert.equal(appMapLoadFailure(new Error("  boom  ")).detail, "boom");
});

test("orderCanvasChanges keeps stable priority and original order within a tier", () => {
  // Ordering only inspects `kind`; payloads are intentionally incomplete stubs.
  const changes = [
    { kind: "connection.remove", connectionId: "c1" },
    { kind: "screen.update", screenId: "s1", input: {} },
    { kind: "group.remove", groupId: "g1" },
    { kind: "flow.remove", flowId: "f1" },
    { kind: "group.save", group: { id: "g2" } },
    { kind: "connection.create", connection: { id: "c2" } },
    { kind: "screen.add", input: { id: "s2" } },
  ] as AppMapBatchChange[];

  assert.deepEqual(
    orderCanvasChanges(changes).map((change) => change.kind),
    [
      "screen.update",
      "screen.add",
      "group.remove",
      "group.save",
      "connection.create",
      "flow.remove",
      "connection.remove",
    ],
  );
});
