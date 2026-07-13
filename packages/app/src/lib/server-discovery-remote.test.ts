import assert from "node:assert/strict";
import test from "node:test";
import {
  createDiscoverySession,
  discoveryScreenUrl,
  setDiscoveryStatus,
} from "./server-discovery-remote";

test("builds discovery requests and preserves session identity", async () => {
  const calls: string[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    return { session: { id: "session-1", status: "running" } } as T;
  };
  const session = await createDiscoverySession(request, { name: "Smoke", targetId: "pixel" });
  await setDiscoveryStatus(request, session.id, "paused");
  assert.equal(
    discoveryScreenUrl("http://relay", "session-1", "screen/1"),
    "http://relay/discovery/session-1/screens/screen%2F1",
  );
  assert.deepEqual(calls, ["POST /discovery", "POST /discovery/session-1/status"]);
});
