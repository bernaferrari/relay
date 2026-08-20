import assert from "node:assert/strict";
import test from "node:test";
import {
  captureScrollableSurvey,
  IosMutationOutcomeUnknownError,
  observeScreenIdentity,
  proveConnectionOnDevice,
  type SnapshotNode,
} from "@relay/core";
import type { Connection } from "@relay/protocol";
import { HttpError } from "./http.js";
import { iosMutationOutcomeUnknownHttpError } from "./interaction-routes.js";

function unknownIosScroll(): IosMutationOutcomeUnknownError {
  return new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "scroll",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("XCTest transport ended"),
  );
}

async function fullSurfaceScrollFailure(): Promise<IosMutationOutcomeUnknownError> {
  try {
    await captureScrollableSurvey({
      capture: async () => ({
        screenshot: { base64: "AA==", width: 64, height: 160, capturedAt: 1 },
        snapshot: {
          capturedAt: 1,
          nodes: [
            {
              identifier: "settings-root",
              type: "XCUIElementTypeNavigationBar",
              rect: { x: 0, y: 0, width: 64, height: 20 },
              visibleToUser: true,
            },
          ],
          interactive: [],
          bounds: { width: 64, height: 160 },
          inspectable: true,
          source: "sdk" as const,
          screenIdentity: { fingerprint: "settings", nodes: [], volatileSignals: [] },
        },
      }),
      scrollDown: async () => {
        throw unknownIosScroll();
      },
      scrollUp: async () => {
        throw new Error("must not restore after an unknown scroll");
      },
      settle: async () => {},
    });
  } catch (error) {
    if (error instanceof IosMutationOutcomeUnknownError) return error;
    throw error;
  }
  throw new Error("expected full-surface survey to stop on an unknown scroll");
}

test("the interaction boundary preserves an iOS one-command intervention for app and MCP callers", () => {
  const error = new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation: "press",
      nativeAttempts: 1,
      outcome: "outcome-unknown",
      retry: {
        attempts: 0,
        decision: "blocked",
        reason: "native-command-outcome-unknown",
      },
      intervention: { required: true, action: "capture-current-screen-before-any-retry" },
      at: 1,
    },
    new Error("connection reset"),
  );

  const response = iosMutationOutcomeUnknownHttpError(error);
  assert.ok(response instanceof HttpError);
  assert.equal(response.status, 409);
  assert.deepEqual(response.body, {
    code: "IOS_MUTATION_OUTCOME_UNKNOWN",
    iosMutation: error.iosMutation,
  });
});

test("the recovery payload retains full-surface frames without offering another movement", async () => {
  const response = iosMutationOutcomeUnknownHttpError(await fullSurfaceScrollFailure());
  const body = response.body as {
    code?: string;
    scrollSurvey?: {
      status?: string;
      frames?: Array<{ screenshot?: { capturedAt?: number } }>;
      restoredStartViewport?: boolean;
      restoration?: { attempted?: boolean };
    };
  };

  assert.equal(body.code, "IOS_MUTATION_OUTCOME_UNKNOWN");
  assert.equal(body.scrollSurvey?.status, "interrupted");
  assert.equal(body.scrollSurvey?.frames?.[0]?.screenshot?.capturedAt, 1);
  assert.equal(body.scrollSurvey?.restoredStartViewport, false);
  assert.equal(body.scrollSurvey?.restoration?.attempted, false);
});

test("the App Map proof boundary keeps the last proven source evidence with an iOS stop", async () => {
  const source: SnapshotNode[] = [
    { type: "Button", label: "Source", identifier: "source", hittable: true },
  ];
  const destination: SnapshotNode[] = [
    { type: "Button", label: "Destination", identifier: "destination", hittable: true },
  ];
  const connection = {
    id: "open-destination",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    fromScreenId: "source",
    destination: { kind: "screen", screenId: "destination" },
    state: "draft",
    actions: [],
    navigation: {
      targetAlternatives: [{ kind: "identifier", identifier: "destination" }],
      expectedDestination: {
        screenId: "destination",
        identity: { schemaVersion: 1, fingerprint: observeScreenIdentity(destination).fingerprint },
        evidenceIds: ["destination-evidence"],
      },
    },
    return: {
      kind: "back",
      expectedDestination: {
        screenId: "source",
        identity: { schemaVersion: 1, fingerprint: observeScreenIdentity(source).fingerprint },
        evidenceIds: ["source-evidence"],
      },
    },
    createdAt: 1,
    updatedAt: 1,
  } satisfies Connection;
  let failure: unknown;

  await assert.rejects(
    proveConnectionOnDevice({
      serial: "ipad-1",
      connection,
      runtime: {
        captureSnapshot: async () => ({ nodes: source }),
        interact: async () => {
          throw new IosMutationOutcomeUnknownError(
            {
              sequence: 1,
              operation: "press",
              nativeAttempts: 1,
              outcome: "outcome-unknown",
              retry: {
                attempts: 0,
                decision: "blocked",
                reason: "native-command-outcome-unknown",
              },
              intervention: { required: true, action: "capture-current-screen-before-any-retry" },
              at: 1,
            },
            new Error("connection reset"),
          );
        },
      },
    }),
    (error: unknown) => {
      failure = error;
      return error instanceof IosMutationOutcomeUnknownError;
    },
  );

  if (!(failure instanceof IosMutationOutcomeUnknownError)) throw new Error("expected iOS stop");
  const response = iosMutationOutcomeUnknownHttpError(failure);
  assert.equal(response.status, 409);
  assert.deepEqual((response.body as { connectionProof?: unknown }).connectionProof, {
    serial: "ipad-1",
    connectionId: "open-destination",
    phase: "target-activation",
    before: {
      observedFingerprint: observeScreenIdentity(source).fingerprint,
      expectedDestination: connection.navigation.expectedDestination,
      expectedSource: connection.return.expectedDestination,
    },
  });
});
