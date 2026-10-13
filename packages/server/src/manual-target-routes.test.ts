import assert from "node:assert/strict";
import type http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  SnapshotLogicalBoundsUnavailableError,
  SnapshotSemanticsQuarantinedError,
  runWithOperationContext,
  type SnapshotPayload,
} from "@relay/core";
import { handleManualTargetRoute, type ManualTargetRouteInput } from "./manual-target-routes.js";
import { respondToRequestError } from "./request-error-response.js";
import type { RequestContext } from "./security.js";

const scope: RequestContext = {
  subject: "local-user",
  organizationId: "relay",
  projectId: "snapshot-policy",
  allowedProjects: ["snapshot-policy"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

type SnapshotResponseBody = Partial<SnapshotPayload> & {
  error?: string;
  code?: string;
  capability?: string;
  blocked?: boolean;
  reason?: string;
  safeObservations?: Record<string, { method: string; href: string }>;
  recoveryAction?: { method: string; href: string };
};

async function snapshotResponse(
  query: string,
  captureTargetSnapshot: NonNullable<ManualTargetRouteInput["captureTargetSnapshot"]>,
): Promise<{ status: number; body: SnapshotResponseBody }> {
  const root = await mkdtemp(join(tmpdir(), "relay-manual-snapshot-"));
  const previousState = process.env.RELAY_STATE_DIR;
  process.env.RELAY_STATE_DIR = root;
  let status = 0;
  let payload = "";
  const responseState = {
    headersSent: false,
    destroyed: false,
    writableEnded: false,
    writeHead(nextStatus: number) {
      status = nextStatus;
      responseState.headersSent = true;
    },
    end(value: string) {
      payload = value;
      responseState.writableEnded = true;
    },
  };
  const response = responseState as unknown as http.ServerResponse;
  const url = new URL(`/snapshot?serial=quarantined-ipad&${query}`, "http://relay.local");
  try {
    await runWithOperationContext(
      {
        schemaVersion: 1,
        organizationId: scope.organizationId,
        projectId: scope.projectId,
        actorId: "agent:snapshot-test",
        actorKind: "agent",
        operationId: "target.snapshot.capture",
        requestId: crypto.randomUUID(),
        idempotencyKey: crypto.randomUUID(),
        issuedAt: Date.now(),
      },
      async () => {
        try {
          assert.equal(
            await handleManualTargetRoute({
              method: "GET",
              pathname: "/snapshot",
              url,
              request: { url: url.pathname + url.search } as http.IncomingMessage,
              response,
              scope,
              captureTargetSnapshot,
              liveVideoStream: async () => {
                throw new Error("Unexpected stream");
              },
              captureTargetScreenshot: async () => {
                throw new Error("Unexpected screenshot");
              },
            }),
            true,
          );
        } catch (error) {
          respondToRequestError(error, response, scope);
        }
      },
    );
    return { status, body: JSON.parse(payload) };
  } finally {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    await rm(root, { recursive: true, force: true });
  }
}

test("semantics-only snapshot quarantine returns structured 409 with independent observation links", async () => {
  const result = await snapshotResponse("visual=0", async (input) => {
    assert.equal(input?.includeVisual, false);
    throw new SnapshotSemanticsQuarantinedError("quarantined-ipad");
  });
  assert.equal(result.status, 409);
  assert.equal(result.body.code, "TARGET_SEMANTICS_QUARANTINED");
  assert.equal(result.body.capability, "semantics");
  assert.equal(result.body.blocked, true);
  assert.match(result.body.error ?? "", /quarantined/i);
  assert.equal(result.body.safeObservations?.pixels?.method, "GET");
  assert.equal(
    result.body.safeObservations?.pixels?.href,
    "/screenshot?serial=quarantined-ipad&ephemeral=1",
  );
  assert.equal(
    result.body.safeObservations?.snapshot?.href,
    "/snapshot?serial=quarantined-ipad&visual=1",
  );
  assert.equal(result.body.recoveryAction?.method, "POST");
});

test("logical-bounds snapshot forwards the window-only request and returns no controls", async () => {
  const result = await snapshotResponse("visual=0&logicalBoundsOnly=true", async (input) => {
    assert.equal(input?.logicalBoundsOnly, true);
    return {
      serial: "quarantined-ipad",
      capturedAt: 1,
      nodes: [],
      interactive: [],
      inspectable: false,
      source: "pixels-only",
      bounds: { width: 834, height: 1112 },
      boundsSource: "current-window",
      inspectionError: "Geometry-only observation did not read accessibility controls.",
      screenIdentity: { fingerprint: "", nodes: [], volatileSignals: [] },
    } satisfies SnapshotPayload;
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body.nodes, []);
  assert.equal(result.body.inspectable, false);
  assert.deepEqual(result.body.bounds, { width: 834, height: 1112 });
  assert.equal(result.body.boundsSource, "current-window");
});

test("unavailable native window bounds produce structured 503, and unsupported targets produce 400", async () => {
  for (const [reason, status] of [
    ["bounds-unavailable", 503],
    ["unsupported-platform", 400],
  ] as const) {
    const result = await snapshotResponse("logicalBoundsOnly=1", async () => {
      throw new SnapshotLogicalBoundsUnavailableError(reason);
    });
    assert.equal(result.status, status);
    assert.equal(result.body.code, "TARGET_IOS_LOGICAL_BOUNDS_UNAVAILABLE");
    assert.equal(result.body.capability, "logical-bounds");
    assert.equal(result.body.reason, reason);
  }
});
