import assert from "node:assert/strict";
import test from "node:test";
import type { EventEnvelope, RelayEventPayload } from "@relay/protocol";
import { projectRelayEvent } from "./event-projection.js";

function event(
  sequence: number,
  payload: RelayEventPayload,
  actorId = "agent:indexer",
): EventEnvelope {
  return {
    schemaVersion: 1,
    eventId: `event-${sequence}`,
    sequence,
    actorId,
    actorKind: actorId.startsWith("agent:") ? "agent" : "human",
    organizationId: "local",
    projectId: "default",
    operationId: "journey.update",
    requestId: `request-${sequence}`,
    occurredAt: sequence,
    payload,
  };
}

test("interleaved actors refresh resources without projecting target focus", () => {
  const selectedDevice = "human-device";
  const remoteSelection = projectRelayEvent(
    0,
    event(1, { type: "device.selected", at: 1, serial: "agent-device" }),
  );
  const journey = projectRelayEvent(
    remoteSelection.cursor,
    event(2, {
      type: "resource.updated",
      at: 2,
      projectId: "default",
      resource: "journey",
      resourceId: "login",
      revision: 3,
    }),
  );
  assert.equal(selectedDevice, "human-device");
  assert.deepEqual(remoteSelection.refresh, []);
  assert.deepEqual(journey.refresh, ["journeys"]);
  assert.equal(journey.activity?.actorId, "agent:indexer");
});

test("duplicates and out-of-order events are ignored", () => {
  const duplicate = projectRelayEvent(8, event(8, { type: "job.started", at: 8 }));
  const older = projectRelayEvent(8, event(7, { type: "job.started", at: 7 }));
  assert.equal(duplicate.accepted, false);
  assert.equal(older.accepted, false);
  assert.equal(older.cursor, 8);
});

test("a replay gap requests one scoped refresh of every live projection", () => {
  const projection = projectRelayEvent(
    2,
    event(10, {
      type: "stream.gap",
      at: 10,
      requestedAfter: 2,
      oldestAvailable: 7,
      latestAvailable: 9,
      requiresRefresh: true,
    }),
  );
  assert.equal(projection.accepted, true);
  assert.deepEqual(projection.refresh, [
    "devices",
    "journeys",
    "collections",
    "jobs",
    "runs",
    "variables",
    "matrices",
    "discoveries",
  ]);
});
