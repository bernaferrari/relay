import assert from "node:assert/strict";
import test from "node:test";
import { parseCommandEnvelope, parseEventEnvelope } from "./coordination.js";

const identity = {
  schemaVersion: 1 as const,
  actorId: "human:local-desktop",
  actorKind: "human" as const,
  organizationId: "local",
  projectId: "default",
  operationId: "journey.update",
  requestId: "req-1",
  idempotencyKey: "idem-1",
  issuedAt: 1,
};

test("command envelopes reject missing actor and scope identity", () => {
  assert.throws(
    () => parseCommandEnvelope({ ...identity, actorId: "", payload: {} }, (value) => value),
    /actorId/,
  );
  assert.throws(
    () => parseCommandEnvelope({ ...identity, projectId: "", payload: {} }, (value) => value),
    /projectId/,
  );
  assert.throws(
    () => parseCommandEnvelope({ ...identity, idempotencyKey: "", payload: {} }, (value) => value),
    /idempotencyKey/,
  );
});

test("command envelopes preserve causal identity and parse payloads", () => {
  const envelope = parseCommandEnvelope(
    {
      ...identity,
      causationId: "evt-previous",
      correlationId: "workflow-1",
      authoringSessionId: "session-1",
      payload: { title: "Login" },
    },
    (value) => value as { title: string },
  );
  assert.equal(envelope.payload.title, "Login");
  assert.equal(envelope.causationId, "evt-previous");
  assert.equal(envelope.authoringSessionId, "session-1");
});

test("event envelopes reject malformed cursor and payload identity", () => {
  const event = {
    ...identity,
    eventId: "evt-1",
    sequence: 1,
    occurredAt: 2,
    payload: { type: "resource.updated", at: 2 },
  };
  assert.equal(parseEventEnvelope(event).sequence, 1);
  assert.throws(() => parseEventEnvelope({ ...event, sequence: 0 }), /sequence/);
  assert.throws(() => parseEventEnvelope({ ...event, payload: { at: 2 } }), /payload type/);
});
