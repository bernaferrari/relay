import assert from "node:assert/strict";
import test from "node:test";
import {
  createProductRunAcrossService,
  previewProductRunAcross,
  type ProductRunAcrossSetup,
} from "./run-across.js";

const setup: ProductRunAcrossSetup = {
  appMapId: "app-1",
  appMapRevision: 3,
  testId: "test-1",
  testName: "Language settings",
  appName: "Grok",
  dataSet: {
    name: "Languages",
    dimensions: [
      {
        id: "language",
        name: "Language",
        kind: "language",
        values: [
          { id: "en", label: "English" },
          { id: "pt", label: "Português" },
        ],
      },
      {
        id: "theme",
        name: "Theme",
        kind: "theme",
        values: [
          { id: "light", label: "Light" },
          { id: "dark", label: "Dark" },
        ],
      },
    ],
  },
};

test("preview exposes exact readable scope and a representative pilot", () => {
  const preview = previewProductRunAcross({
    setup,
    selected: { language: ["en", "pt"], theme: ["light", "dark"] },
    target: { kind: "device", platform: "android", targetId: "pixel-9", label: "Pixel 9" },
  });
  assert.equal(preview.caseCount, 4);
  assert.deepEqual(preview.pilot, { language: "en", theme: "light" });
  assert.equal(preview.scopeLabel, "4 cases on Pixel 9");
  assert.doesNotMatch(JSON.stringify(preview), /combine|cell|world/iu);
});

test("preview rejects values outside the saved data set", () => {
  assert.throws(
    () =>
      previewProductRunAcross({
        setup,
        selected: { language: ["fr"] },
        target: { kind: "device", platform: "android", targetId: "pixel-9" },
      }),
    /at least one value/u,
  );
});

test("start, continue, and export use the canonical durable campaign", async () => {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const invoke = async (id: string, input: Record<string, unknown>) => {
    calls.push([id, input]);
    if (id === "app-map.get")
      return {
        appMap: {
          ...setup,
          id: "app-1",
          revision: 3,
          name: "Grok",
          tests: { "test-1": { id: "test-1", name: "Language settings" } },
          variables: {},
        },
      };
    if (id === "app-map.test.run") return { campaign: { id: "batch-1" } };
    if (id === "job.combine.export") return { rootDir: "/tmp/report", jobIds: ["job-1"] };
    return {
      campaign: {
        id: "batch-1",
        title: "Language settings",
        status: "ready-to-resume",
        createdAt: 1,
        updatedAt: 2,
        appMapId: "app-1",
        cases: [
          { status: "passed", runId: "run-1", target: { targetId: "pixel-9" } },
          { status: "pending", target: { targetId: "pixel-9" } },
        ],
      },
    };
  };
  const service = createProductRunAcrossService({ invoke } as never, {
    invoke: invoke as never,
  });
  const started = await service.startPilot({
    setup,
    selected: { language: ["en", "pt"] },
    target: { kind: "device", platform: "android", targetId: "pixel-9" },
  });
  assert.equal(started.id, "batch-1");
  await service.continue("batch-1");
  const report = await service.exportReport("batch-1");
  assert.deepEqual(report.export, { rootDir: "/tmp/report", jobIds: ["job-1"] });
  assert.deepEqual(
    calls.map(([id]) => id),
    [
      "app-map.test.run",
      "job.combine.campaign.get",
      "job.combine.campaign.resume",
      "job.combine.campaign.get",
      "job.combine.campaign.get",
      "job.combine.export",
    ],
  );
});
