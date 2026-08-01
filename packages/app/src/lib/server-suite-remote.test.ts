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
      collections: [],
      collection: { id: "release", title: "Release", sections: [] },
      history: [],
      manifest: { id: "manifest-1", entries: [] },
      jobs: [],
    } as T;
  };

  await listSuites(request);
  await saveSuite(request, { expectedRevision: 0, title: "Release" });
  await saveSuite(request, { id: "release", expectedRevision: 14, title: "Release" });
  await loadSuiteHistory(request, "release");
  await restoreSuite(request, "release", 123);
  await runSuite(request, "release", { serial: "pixel", platform: "android" });
  await deleteSuite(request, "release");

  assert.deepEqual(calls, [
    "GET /collections",
    "POST /collections",
    "PUT /collections/release",
    "GET /collections/release/history",
    "POST /collections/release/restore",
    "POST /collections/release/run",
    "DELETE /collections/release",
  ]);
});
