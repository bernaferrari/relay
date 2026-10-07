import assert from "node:assert/strict";
import test from "node:test";
import { operationDefinition, type OperationOutput } from "@relay/protocol";
import { ApiError, RelayClient } from "./index.js";

const connection = {
  url: "https://relay.test",
  auth: { type: "none" as const },
  organizationId: "local",
  projectId: "default",
  actorId: "human:test",
  actorKind: "human" as const,
};
const input = {
  appMapId: "prompt-app",
  combineId: "prompt-plan",
  serial: "fixture-device",
  platform: "android" as const,
  executionMode: "all" as const,
};
const accepted: OperationOutput<"job.combine.start"> = {
  batch: {
    id: "batch-accepted",
    recipeId: "recipe-prompt",
    composedRecipeId: "recipe-prompt",
    title: "Two prompts",
    worlds: ["First prompt", "Second prompt"],
    createdAt: 1,
  },
  matrix: {
    id: "matrix-prompts",
    createdAt: 1,
    seed: 1,
    strategy: "zip",
    cases: ["first", "second"].map((id, index) => ({
      id,
      name: id,
      index,
      values: { prompt: id },
      provenance: [],
    })),
  },
  cells: [],
  jobs: ["first", "second"].map((id) => ({
    id: `job-${id}`,
    action: "prompt",
    status: "queued",
    queuedAt: 1,
    frameCount: 0,
    batchId: "batch-accepted",
  })),
  selectedCellIds: ["first", "second"],
  plan: { schemaVersion: 1, appMapId: "prompt-app", appMapRevision: 1, rootRecipeId: "prompt" },
};

test("Plan admission can acknowledge its two queued jobs after the ordinary read deadline", async (t) => {
  operationDefinition("job.combine.start").output.parse(accepted);
  const budgets = new WeakMap<AbortSignal, number>();
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const signal = new AbortController().signal;
    budgets.set(signal, ms);
    return signal;
  });
  const requests: Request[] = [];
  const client = new RelayClient(connection, {
    fetch: async (url, init) => {
      requests.push(new Request(url, init));
      // The retained command's issuedAt→queuedAt was 26,582ms. Admission
      // dispatches once before ACK; virtual time exercises the actual invoke
      // path without running a device/job or waiting for that wall-clock delay.
      if ((budgets.get(init!.signal!) ?? 0) < 26_582) {
        throw new DOMException("The request timed out", "TimeoutError");
      }
      return Response.json(accepted);
    },
  });
  const result = await client.invoke("job.combine.start", input);
  assert.equal(result.batch.id, "batch-accepted");
  assert.deepEqual(
    result.jobs.map((job) => job.id),
    ["job-first", "job-second"],
  );
  assert.equal(requests.length, 1, "an uncertain start must never be resent");
  assert.equal(requests[0]!.method, "POST");
  assert.equal(new URL(requests[0]!.url).pathname, "/jobs/combine");
  assert.deepEqual(await requests[0]!.json(), input);
});

test("Plan acknowledgement budgets preserve explicit deadlines, cancellation, and single sends", async (t) => {
  const budgets: number[] = [];
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    budgets.push(ms);
    return new AbortController().signal;
  });
  const requests: Request[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    const request = new Request(url, init);
    requests.push(request);
    if (request.signal.aborted) throw request.signal.reason;
    return Response.json({ error: "Admission refused" }, { status: 409 });
  };
  const client = new RelayClient(connection, { fetch: fetcher });
  await assert.rejects(client.scoped("other").invoke("job.combine.start", input), ApiError);
  await assert.rejects(
    client.invoke("job.combine.campaign.resume", { batchId: "batch-1" }),
    ApiError,
  );
  await assert.rejects(client.invoke("job.combine.campaign.get", { batchId: "batch-1" }), ApiError);
  const explicit = new RelayClient(connection, { fetch: fetcher, timeoutMs: 1234 });
  await assert.rejects(explicit.scoped("other").invoke("job.combine.start", input), ApiError);
  const cancellation = new AbortController();
  cancellation.abort(new DOMException("Cancelled", "AbortError"));
  await assert.rejects(client.invoke("job.combine.start", input, { signal: cancellation.signal }), {
    name: "AbortError",
  });
  assert.deepEqual(budgets, [180_000, 180_000, 20_000, 1234, 180_000]);
  assert.equal(requests.length, 5, "a rejected or cancelled request is not resent");
  assert.equal(requests.at(-1)!.signal.aborted, true);
});

test("a Plan acknowledgement beyond the bounded deadline stays unknown without resending", async (t) => {
  const budgets = new WeakMap<AbortSignal, number>();
  t.mock.method(AbortSignal, "timeout", (ms: number) => {
    const signal = new AbortController().signal;
    budgets.set(signal, ms);
    return signal;
  });
  let requests = 0;
  const fetcher: typeof fetch = async (_url, init) => {
    requests++;
    if ((budgets.get(init!.signal!) ?? 0) < 180_001) {
      throw new DOMException("The request timed out", "TimeoutError");
    }
    return Response.json(accepted);
  };
  await assert.rejects(
    new RelayClient(connection, { fetch: fetcher }).invoke("job.combine.start", input),
    {
      name: "TimeoutError",
    },
  );
  assert.equal(requests, 1);
});
