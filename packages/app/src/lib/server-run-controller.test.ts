import assert from "node:assert/strict";
import test from "node:test";
import type { JobInfo } from "./api-types.js";
import { createServerRunController } from "./server-run-controller.js";
import type { ServerRequest } from "./server-matrix-remote.js";

test("single-Test execution remembers and selects the exact queued compiler root", async () => {
  const remembered: JobInfo[] = [];
  let selectedJob = "";
  let selectedAction = "";
  const rootRecipeId = "app-map:shop:test:checkout:root:r7";
  const request: ServerRequest = async <T>(path: string) => {
    assert.equal(path, "/jobs/combine");
    return {
      batch: {
        id: "job-1",
        title: "Checkout",
        worlds: ["once"],
        recipeId: rootRecipeId,
      },
      jobs: [
        {
          id: "job-1",
          action: rootRecipeId,
          status: "queued",
          queuedAt: 1,
          logs: [],
        },
      ],
      matrix: { id: "job-1" },
    } as T;
  };
  const controller = createServerRunController({
    request,
    health: () => "online",
    devices: () => [{ serial: "device-1", platform: "ios" }],
    recipes: () => [],
    matrices: () => [],
    selectedDevice: () => "device-1",
    selectedJobId: () => null,
    prodAccountMatch: () => "",
    projectId: () => "project",
    projectVariables: () => [],
    activeJob: () => null,
    queuedJobs: () => [],
    captureBeforeRun: async () => undefined,
    appendLog: () => undefined,
    setSelectedJobId: (id) => (selectedJob = id),
    setSelectedAction: (id) => (selectedAction = id),
    setError: () => undefined,
    refreshJobs: async () => undefined,
    rememberJob: (job) => remembered.push(job),
  });

  const id = await controller.runPathAcrossVariables({
    appMapId: "shop",
    testId: "checkout",
    title: "Checkout",
  });

  assert.equal(id, "job-1");
  assert.equal(selectedJob, "job-1");
  assert.equal(selectedAction, rootRecipeId);
  assert.deepEqual(
    remembered.map((job) => job.id),
    ["job-1"],
  );
});
