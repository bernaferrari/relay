import assert from "node:assert/strict";
import test from "node:test";
import {
  approveDiscoverySuggestion,
  backtrackDiscovery,
  createDiscoverySession,
  discoveryScreenUrl,
  setDiscoveryStatus,
} from "./server-discovery-remote";

function unknownIosMutationError(sessionId: string) {
  return Object.assign(new Error("The iOS press may already have reached the device."), {
    body: {
      code: "IOS_MUTATION_OUTCOME_UNKNOWN",
      iosMutation: {
        operation: "press",
        nativeAttempts: 1,
        outcome: "outcome-unknown",
        retry: { attempts: 0, decision: "blocked", reason: "native-command-outcome-unknown" },
        intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      },
      discoveryReview: {
        sessionId,
        sessionHref: `/discovery/${sessionId}`,
        lastProvenScreen: {
          id: "screen-before",
          capturedAt: 123,
          screenshotHref: `/discovery/${sessionId}/screens/screen-before`,
        },
        captureCurrent: { method: "POST", href: `/discovery/${sessionId}/capture` },
      },
    },
  });
}

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
  const outcome = await backtrackDiscovery(request, session.id);
  assert.equal(
    discoveryScreenUrl("http://relay", "session-1", "screen/1"),
    "http://relay/discovery/session-1/screens/screen%2F1",
  );
  assert.deepEqual(outcome, { status: "succeeded", changedScreen: true });
  assert.deepEqual(calls, [
    "POST /discovery",
    "POST /discovery/session-1/status",
    "POST /discovery/session-1/interact",
  ]);
});

for (const interaction of [
  {
    name: "approved suggestion",
    run: (request: Parameters<typeof approveDiscoverySuggestion>[0], sessionId: string) =>
      approveDiscoverySuggestion(request, {
        sessionId,
        control: {
          id: "settings",
          label: "Settings",
          target: { label: "Settings" },
        },
      }),
    expectedBody: { kind: "label", label: "Settings" },
    screenshotCaption: "review before retry · approve Settings",
  },
  {
    name: "backtrack",
    run: (request: Parameters<typeof backtrackDiscovery>[0], sessionId: string) =>
      backtrackDiscovery(request, sessionId),
    expectedBody: { kind: "back" },
    screenshotCaption: "review before retry · backtrack",
  },
]) {
  test(`Discovery ${interaction.name} preserves an unknown iOS outcome without retrying`, async () => {
    const sessionId = "map-1";
    const calls: Array<{ path: string; body: unknown }> = [];
    const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      throw unknownIosMutationError(sessionId);
    };

    const outcome = await interaction.run(request, sessionId);

    assert.deepEqual(calls, [
      {
        path: "/discovery/map-1/interact",
        body: interaction.expectedBody,
      },
    ]);
    assert.deepEqual(outcome, {
      status: "ios-outcome-unknown",
      iosFailure: {
        code: "IOS_MUTATION_OUTCOME_UNKNOWN",
        mutation: {
          operation: "press",
          nativeAttempts: 1,
          outcome: "outcome-unknown",
          retry: { decision: "blocked", reason: "native-command-outcome-unknown" },
          intervention: { action: "capture-current-screen-before-any-retry" },
        },
      },
      intervention: {
        title: "Action may already have happened",
        detail:
          "Relay sent one iOS command and did not retry it. Review the last proven screen, then capture the current screen before any next action.",
        screenshotCaption: interaction.screenshotCaption,
        operation: "press",
      },
      review: {
        sessionId,
        sessionHref: "/discovery/map-1",
        lastProvenScreen: {
          id: "screen-before",
          capturedAt: 123,
          screenshotHref: "/discovery/map-1/screens/screen-before",
        },
        captureCurrent: { method: "POST", href: "/discovery/map-1/capture" },
      },
    });
  });
}
