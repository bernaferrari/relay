import assert from "node:assert/strict";
import test from "node:test";
import {
  deleteSuite,
  listSuites,
  loadSuiteHistory,
  restoreSuite,
  runSuite,
  saveSuite,
} from "./server-suite-remote";

test("keeps suite persistence and execution behind one typed boundary", async () => {
  const calls: string[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return {
      suites: [],
      suite: { id: "release", title: "Release", sections: [] },
      history: [],
      manifest: { id: "manifest-1", entries: [] },
      jobs: [],
    } as T;
  };

  await listSuites(request);
  await saveSuite(request, { title: "Release" });
  await saveSuite(request, { id: "release", title: "Release" });
  await loadSuiteHistory(request, "release");
  await restoreSuite(request, "release", 123);
  await runSuite(request, "release", { serial: "pixel", platform: "android" });
  await deleteSuite(request, "release");

  assert.deepEqual(calls, [
    "GET /suites",
    "POST /suites",
    "PUT /suites/release",
    "GET /suites/release/history",
    "POST /suites/release/restore",
    "POST /suites/release/run",
    "DELETE /suites/release",
  ]);
});
