import assert from "node:assert/strict";
import test from "node:test";
import type { RelayClient } from "@relay/client";
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
  const client = {
    invoke: async (operationId: string, input: Record<string, unknown>) => {
      calls.push(`${operationId} ${JSON.stringify(input)}`);
      if (operationId === "discovery.interact") {
        return { transition: { changedScreen: true } };
      }
      return { session: { id: "session-1", status: "running" } };
    },
  } as unknown as RelayClient;
  const session = await createDiscoverySession(client, { name: "Smoke", targetId: "pixel" });
  await setDiscoveryStatus(client, session.id, "paused");
  const outcome = await backtrackDiscovery(client, session.id);
  assert.equal(
    discoveryScreenUrl("http://relay", "session-1", "screen/1"),
    "http://relay/discovery/session-1/screens/screen%2F1",
  );
  assert.deepEqual(outcome, { status: "succeeded", changedScreen: true });
  assert.deepEqual(calls, [
    'discovery.create {"name":"Smoke","targetId":"pixel"}',
    'discovery.status.update {"sessionId":"session-1","status":"paused"}',
    'discovery.interact {"sessionId":"session-1","kind":"back"}',
  ]);
});

for (const interaction of [
  {
    name: "approved suggestion",
    run: (client: Parameters<typeof approveDiscoverySuggestion>[0], sessionId: string) =>
      approveDiscoverySuggestion(client, {
        sessionId,
        control: {
          id: "settings",
          label: "Settings",
          target: { label: "Settings" },
        },
      }),
    expectedInput: { sessionId: "map-1", kind: "label", label: "Settings" },
    screenshotCaption: "review before retry · approve Settings",
  },
  {
    name: "backtrack",
    run: (client: Parameters<typeof backtrackDiscovery>[0], sessionId: string) =>
      backtrackDiscovery(client, sessionId),
    expectedInput: { sessionId: "map-1", kind: "back" },
    screenshotCaption: "review before retry · backtrack",
  },
]) {
  test(`Discovery ${interaction.name} preserves an unknown iOS outcome without retrying`, async () => {
    const sessionId = "map-1";
    const calls: Array<{ operationId: string; input: unknown }> = [];
    const client = {
      invoke: async (operationId: string, input: unknown) => {
        calls.push({ operationId, input });
        throw unknownIosMutationError(sessionId);
      },
    } as unknown as RelayClient;

    const outcome = await interaction.run(client, sessionId);

    assert.deepEqual(calls, [
      {
        operationId: "discovery.interact",
        input: interaction.expectedInput,
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
