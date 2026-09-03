import assert from "node:assert/strict";
import test from "node:test";
import type { RunEvidenceQuery } from "@relay/protocol";
import type { JobInfo } from "./api-types";
import { runReportTabAvailable, structuredNetworkEvidenceCount } from "./run-report-availability";

const job = {
  id: "run-1",
  action: "app-map.test.run",
  status: "ok",
  queuedAt: 1,
  logs: [],
  frames: [],
} as JobInfo;

test("network availability counts inspectable evidence rather than a generic artifact", () => {
  const evidence = {
    network: [],
    androidNetwork: { flows: [{ id: "flow-1" }] },
  } as unknown as RunEvidenceQuery;
  assert.equal(structuredNetworkEvidenceCount(evidence), 1);
  assert.equal(runReportTabAvailable({ id: "network", job, evidence, checkCount: 0 }), true);
  assert.equal(runReportTabAvailable({ id: "network", job, evidence: null, checkCount: 0 }), false);
});

test("empty evidence tabs remain available to inspect but are presented as unavailable", () => {
  assert.equal(runReportTabAvailable({ id: "summary", job, evidence: null, checkCount: 0 }), true);
  assert.equal(runReportTabAvailable({ id: "visual", job, evidence: null, checkCount: 0 }), false);
  assert.equal(
    runReportTabAvailable({ id: "evaluation", job, evidence: null, checkCount: 0 }),
    false,
  );
});
