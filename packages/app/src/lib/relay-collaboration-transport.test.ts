import assert from "node:assert/strict";
import test from "node:test";
import type { RelayClient } from "@relay/client";
import type { EventEnvelope } from "@relay/protocol";
import {
  bytesFromBase64,
  bytesToBase64,
  createRelayCollaborationTransport,
} from "./relay-collaboration-transport";

function fakeClient() {
  let eventListener: ((event: EventEnvelope) => void) | undefined;
  const calls: Array<{ method: string; value?: string }> = [];
  const document = bytesToBase64(new Uint8Array([1, 2, 3]));
  const vector = bytesToBase64(new Uint8Array([4, 5]));
  const client = {
    connection: {
      url: "http://relay.test",
      auth: { type: "none" as const },
      organizationId: "local",
      projectId: "project",
      actorId: "human:one",
      actorKind: "human" as const,
    },
    async syncCollaboration(_journeyId: string, state: string) {
      calls.push({ method: "sync", value: state });
      return {
        schemaVersion: 1 as const,
        journeyId: "journey",
        updateBase64: document,
        stateVectorBase64: vector,
        status: "ready" as const,
        documentBytes: 3,
        updateBytes: 3,
        pendingUpdates: 0,
        repairedTailBytes: 0,
      };
    },
    async appendCollaborationUpdate(_journeyId: string, update: string, id: string) {
      calls.push({ method: "append", value: update });
      return {
        schemaVersion: 1 as const,
        journeyId: "journey",
        updateBase64: document,
        stateVectorBase64: vector,
        status: "ready" as const,
        documentBytes: 3,
        updateBytes: 3,
        pendingUpdates: 1,
        repairedTailBytes: 0,
        clientUpdateId: id,
        applied: true,
        duplicate: false,
      };
    },
    async exportCollaboration() {
      calls.push({ method: "export" });
      return {
        schemaVersion: 1 as const,
        journeyId: "journey",
        updateBase64: document,
        stateVectorBase64: vector,
        status: "ready" as const,
        documentBytes: 3,
        updateBytes: 3,
        pendingUpdates: 1,
        repairedTailBytes: 0,
      };
    },
    async events(listener: (event: EventEnvelope) => void, options: { signal?: AbortSignal }) {
      eventListener = listener;
      await new Promise<void>((resolve) =>
        options.signal?.addEventListener("abort", () => resolve()),
      );
    },
  } as unknown as RelayClient;
  return { client, calls, emit: (event: EventEnvelope) => eventListener?.(event) };
}

const scope = { projectId: "project", journeyId: "journey" };

test("Relay collaboration transport converts bytes only at typed client boundaries", async () => {
  const fake = fakeClient();
  const transport = createRelayCollaborationTransport(fake.client);
  const handshake = await transport.handshake({
    scope,
    stateVector: new Uint8Array([9, 8]),
    signal: new AbortController().signal,
  });
  assert.deepEqual([...handshake.stateVector], [4, 5]);
  assert.deepEqual([...handshake.updates[0]!.bytes], [1, 2, 3]);
  assert.deepEqual([...bytesFromBase64(fake.calls[0]!.value!)], [9, 8]);

  const pushed = await transport.push({
    scope,
    updates: [{ id: "client:1", bytes: new Uint8Array([7, 6]) }],
    signal: new AbortController().signal,
  });
  assert.deepEqual(pushed.acknowledgedUpdateIds, ["client:1"]);
  assert.deepEqual([...bytesFromBase64(fake.calls[1]!.value!)], [7, 6]);
});

test("canonical collaboration events trigger a bounded document refresh", async () => {
  const fake = fakeClient();
  const transport = createRelayCollaborationTransport(fake.client);
  const updates: Uint8Array[] = [];
  const subscription = transport.subscribe(
    scope,
    (update) => updates.push(update.bytes),
    () => undefined,
  );
  fake.emit({
    schemaVersion: 1,
    eventId: "event:1",
    sequence: 1,
    operationId: "collaboration.update.append",
    requestId: "request:1",
    occurredAt: 1,
    organizationId: "local",
    projectId: "project",
    actorId: "agent:map",
    actorKind: "agent",
    payload: {
      type: "collaboration.document.updated",
      at: 1,
      journeyId: "journey",
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(
    updates.map((bytes) => [...bytes]),
    [[1, 2, 3]],
  );
  assert.equal(fake.calls.filter((call) => call.method === "export").length, 1);
  subscription.close();
});

test("transport rejects accidental cross-project use before network I/O", async () => {
  const fake = fakeClient();
  const transport = createRelayCollaborationTransport(fake.client);
  await assert.rejects(
    transport.handshake({
      scope: { ...scope, projectId: "other" },
      stateVector: new Uint8Array([1]),
      signal: new AbortController().signal,
    }),
    /does not match/,
  );
  assert.equal(fake.calls.length, 0);
});
