import assert from "node:assert/strict";
import test from "node:test";
import type { CombineEvidencePackManifest } from "./combine-evidence-pack-contract.js";
import { executionOperationOutputSchemas } from "./execution-operation-output-schemas.js";

test("portable export preserves case coverage notes through the public response", () => {
  const manifest: CombineEvidencePackManifest = {
    schemaVersion: 2,
    batchId: "batch-1",
    recipeId: "recipe-1",
    title: "Settings review",
    generatedAt: 1,
    locales: ["en-US"],
    cases: [
      {
        locale: "en-US",
        jobId: "run-1",
        status: "passed",
        name: "Settings",
        frames: [],
        expectedFrames: 1,
        captures: [],
        note: "No screenshot was retained for the required transition.",
      },
    ],
    byCanonicalKey: {},
    analysis: {
      schemaVersion: 1,
      sessionId: "batch-1",
      generatedAt: 1,
      baselineLocale: "en-US",
      findings: [],
      critical: 0,
      warnings: 0,
      affectedScreens: 0,
    },
    analysisCoverage: { frames: 0, inspectedFrames: 0 },
  };
  const response = { rootDir: "/tmp/export", manifest, jobIds: ["run-1"] };
  assert.deepEqual(executionOperationOutputSchemas["job.combine.export"].parse(response), response);
});
