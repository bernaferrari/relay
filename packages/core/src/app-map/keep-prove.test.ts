import assert from "node:assert/strict";
import test from "node:test";
import type { Connection } from "@relay/protocol";
import { IosMutationOutcomeUnknownError, type SnapshotNode } from "../device.js";
import { observeScreenIdentity } from "../screen-identity.js";
import {
  connectionProofOutcomeUnknownDiagnostic,
  proveConnectionOnDevice,
  type ConnectionProofRuntime,
} from "./keep-prove.js";

function unknownIosMutation(operation: "press" | "back") {
  return new IosMutationOutcomeUnknownError(
    {
      sequence: 1,
      operation,
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
}

function screen(label: string): SnapshotNode[] {
  return [
    {
      type: "Button",
      identifier: `${label.toLocaleLowerCase()}-row`,
      label,
      enabled: true,
      hittable: true,
      visibleToUser: true,
    },
  ];
}

function connection(input: {
  source?: SnapshotNode[];
  destination: SnapshotNode[];
  alternatives: NonNullable<Connection["navigation"]>["targetAlternatives"];
}): Connection {
  const destination = {
    schemaVersion: 1 as const,
    fingerprint: observeScreenIdentity(input.destination).fingerprint,
  };
  return {
    id: "open-destination",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    fromScreenId: "source",
    destination: { kind: "screen", screenId: "destination" },
    state: "draft",
    actions: [],
    navigation: {
      targetAlternatives: input.alternatives,
      expectedDestination: {
        screenId: "destination",
        identity: destination,
        evidenceIds: ["destination-before"],
      },
    },
    ...(input.source
      ? {
          return: {
            kind: "back" as const,
            expectedDestination: {
              screenId: "source",
              identity: {
                schemaVersion: 1 as const,
                fingerprint: observeScreenIdentity(input.source).fingerprint,
              },
              evidenceIds: ["source-before"],
            },
          },
        }
      : {}),
    createdAt: 1,
    updatedAt: 1,
  };
}

function runtime(screens: SnapshotNode[][], onInteract: ConnectionProofRuntime["interact"]) {
  let capture = 0;
  return {
    captureSnapshot: async () => ({ nodes: screens[Math.min(capture++, screens.length - 1)]! }),
    interact: onInteract,
  } satisfies ConnectionProofRuntime;
}

test("Keep proof stops before the next selector when the first iOS target outcome is unknown", async () => {
  const source = screen("Source");
  const destination = screen("Destination");
  const calls: Array<{ kind: string; target: string }> = [];
  let failure: unknown;
  const proofRuntime = runtime([source, source], async (input) => {
    calls.push({
      kind: input.kind,
      target:
        input.kind === "identifier" ? input.identifier : input.kind === "label" ? input.label : "",
    });
    throw unknownIosMutation("press");
  });

  await assert.rejects(
    proveConnectionOnDevice({
      serial: "ios-keep-unknown",
      connection: connection({
        source,
        destination,
        alternatives: [
          { kind: "identifier", identifier: "destination-row" },
          { kind: "accessibility", label: "Destination" },
        ],
      }),
      runtime: proofRuntime,
    }),
    (error: unknown) => {
      failure = error;
      return error instanceof IosMutationOutcomeUnknownError;
    },
  );

  assert.deepEqual(calls, [{ kind: "identifier", target: "destination-row" }]);
  assert.deepEqual(connectionProofOutcomeUnknownDiagnostic(failure), {
    serial: "ios-keep-unknown",
    connectionId: "open-destination",
    phase: "target-activation",
    before: {
      observedFingerprint: observeScreenIdentity(source).fingerprint,
      expectedDestination: {
        screenId: "destination",
        identity: { schemaVersion: 1, fingerprint: observeScreenIdentity(destination).fingerprint },
        evidenceIds: ["destination-before"],
      },
      expectedSource: {
        screenId: "source",
        identity: { schemaVersion: 1, fingerprint: observeScreenIdentity(source).fingerprint },
        evidenceIds: ["source-before"],
      },
    },
  });
});

test("Keep proof stops before target alternatives when an iOS Back outcome is unknown", async () => {
  const source = screen("Source");
  const destination = screen("Destination");
  const calls: Array<{ kind: string; target: string }> = [];
  let failure: unknown;
  const proofRuntime = runtime([destination], async (input) => {
    calls.push({
      kind: input.kind,
      target: input.kind === "key" ? input.key : "unexpected",
    });
    throw unknownIosMutation("back");
  });

  await assert.rejects(
    proveConnectionOnDevice({
      serial: "ios-keep-back-unknown",
      connection: connection({
        source,
        destination,
        alternatives: [{ kind: "accessibility", label: "Destination" }],
      }),
      runtime: proofRuntime,
    }),
    (error: unknown) => {
      failure = error;
      return error instanceof IosMutationOutcomeUnknownError;
    },
  );

  assert.deepEqual(calls, [{ kind: "key", target: "back" }]);
  assert.equal(connectionProofOutcomeUnknownDiagnostic(failure)?.phase, "return-to-source");
  assert.equal(
    connectionProofOutcomeUnknownDiagnostic(failure)?.before.observedFingerprint,
    observeScreenIdentity(destination).fingerprint,
  );
});

test("Keep proof still tries the next selector after an ordinary selector miss", async () => {
  const source = screen("Source");
  const destination = screen("Destination");
  const calls: Array<{ kind: string; target: string }> = [];
  const proofRuntime = runtime([source, source, destination], async (input) => {
    const target =
      input.kind === "identifier" ? input.identifier : input.kind === "label" ? input.label : "";
    calls.push({ kind: input.kind, target });
    if (input.kind === "identifier") throw new Error("Selector did not match an element");
  });

  const proof = await proveConnectionOnDevice({
    serial: "ios-keep-selector-miss",
    connection: connection({
      source,
      destination,
      alternatives: [
        { kind: "identifier", identifier: "destination-row" },
        { kind: "accessibility", label: "Destination" },
      ],
    }),
    runtime: proofRuntime,
  });

  assert.deepEqual(proof, { proven: true, reason: "Replay matched the destination." });
  assert.deepEqual(calls, [
    { kind: "identifier", target: "destination-row" },
    { kind: "label", target: "Destination" },
  ]);
});
