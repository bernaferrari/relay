import assert from "node:assert/strict";
import test from "node:test";
import { enqueueMatrix, enqueueRecipe, retryJob } from "./server-run-remote";

test("keeps execution endpoints typed and predictable", async () => {
  const calls: string[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return {
      jobs: [{ id: "job-1" }],
      matrix: { id: "matrix-1", profiles: [], excluded: [] },
      job: { id: "job-2" },
    } as T;
  };
  await enqueueRecipe(request, {
    recipe: "login",
    targetKind: "device",
    platform: "android",
    repetitions: 1,
    projectId: "default",
  });
  await enqueueMatrix(request, { recipe: "login", matrixId: "smoke", repetitions: 1 });
  const job = await retryJob(request, "job-1");
  assert.equal(job.id, "job-2");
  assert.deepEqual(calls, [
    "POST /jobs/matrix",
    "POST /jobs/compatibility-matrix",
    "POST /jobs/job-1/retry",
  ]);
});
