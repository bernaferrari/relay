import assert from "node:assert/strict";
import test from "node:test";
import {
  backtrackDiscovery,
  createDiscoverySession,
  discoveryScreenUrl,
  setDiscoveryStatus,
} from "./server-discovery-remote";

test("builds discovery requests and preserves session identity", async () => {
  const calls: string[] = [];
  const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path.endsWith("/interact")) {
      return { transition: { changedScreen: true } } as T;
    }
    return { session: { id: "session-1", status: "running" } } as T;
  };
  const session = await createDiscoverySession(request, { name: "Smoke", targetId: "pixel" });
  await setDiscoveryStatus(request, session.id, "paused");
  const changed = await backtrackDiscovery(request, session.id);
  assert.equal(
    discoveryScreenUrl("http://relay", "session-1", "screen/1"),
    "http://relay/discovery/session-1/screens/screen%2F1",
  );
  assert.equal(changed, true);
  assert.deepEqual(calls, [
    "POST /discovery",
    "POST /discovery/session-1/status",
    "POST /discovery/session-1/interact",
  ]);
});
