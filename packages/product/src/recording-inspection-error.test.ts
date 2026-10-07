import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, RelayClient } from "@relay/client";
import { createRelayRecordingOutcomeJobs } from "@relay/workflows/recording-outcomes";
import { createScriptedRelayClient } from "@relay/workflows/testing";
import { createProductRecordingJourney } from "./recording-journey.js";

test("the actual recording read retains HTTP response context without a mutation or private payload", async () => {
  const requests: Request[] = [];
  const client = new RelayClient(
    {
      url: "https://relay.test",
      auth: { type: "none" },
      organizationId: "local",
      projectId: "default",
      actorId: "human:test",
      actorKind: "human",
    },
    {
      fetch: async (input, init) => {
        requests.push(new Request(input, init));
        return Response.json(
          { error: "private workflow token and device serial", details: { secret: "private" } },
          { status: 503 },
        );
      },
    },
  );
  const journey = createProductRecordingJourney({
    jobs: createRelayRecordingOutcomeJobs(client, { actorId: "human:test" }),
  });
  const result = await journey.inspect("recording-workflow");

  assert.equal((result.recovery as { httpStatus?: unknown })?.httpStatus, 503);
  assert.equal(result.recovery?.code, "operation-unavailable");
  assert.equal(result.recovery?.sourceCode, undefined);
  assert.deepEqual(result.snapshot?.allowedNextActions, ["inspect"]);
  assert.equal(result.snapshot?.version, "unavailable");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.headers.get("x-relay-operation-id"), "workflow.get");
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("recording read HTTP diagnostics reject malformed status and unrelated exceptions", async () => {
  for (const error of [
    new ApiError(999, "private"),
    new ApiError(503.5, "private"),
    new TypeError("Failed to fetch"),
    Object.assign(new Error("domain failure"), { status: 503 }),
    Object.assign(new Error("domain failure"), { status: 503, body: {} }),
    { status: 503, body: { error: "private" } },
  ]) {
    const scripted = createScriptedRelayClient([{ id: "workflow.get", error }]);
    const journey = createProductRecordingJourney({
      jobs: createRelayRecordingOutcomeJobs(scripted.client, { actorId: "human:test" }),
    });
    const result = await journey.inspect("recording-workflow");
    assert.equal((result.recovery as { httpStatus?: unknown })?.httpStatus, undefined);
    assert.equal(scripted.invocations.length, 1);
  }
});

test("actual HTTP recording reads retain the existing access, unavailable-item and conflict guidance", async () => {
  for (const [status, title] of [
    [401, "Reconnect to Relay"],
    [403, "You don’t have access to this action"],
    [404, "This item is unavailable"],
    [409, "This action conflicts with the current state"],
  ] as const) {
    const scripted = createScriptedRelayClient([
      { id: "workflow.get", error: new ApiError(status, "private payload") },
    ]);
    const journey = createProductRecordingJourney({
      jobs: createRelayRecordingOutcomeJobs(scripted.client, { actorId: "human:test" }),
    });
    const result = await journey.inspect("recording-workflow");
    assert.equal(result.recovery?.title, title);
    assert.equal(result.recovery?.retryable, false);
    assert.equal(result.recovery?.httpStatus, status);
    assert.equal(JSON.stringify(result).includes("private payload"), false);
    assert.equal(scripted.invocations.length, 1);
  }
});
