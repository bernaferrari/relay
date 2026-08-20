import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { currentOperationContext, leaseDevice, type PersistedRun } from "@relay/core";
import { startServer } from "./index.js";
import { listAuditEvents } from "./security.js";

const PREVIEW_TOKEN = "relay-live-preview-test-token-with-32-chars";
const ORGANIZATION_ID = "org-preview";
const PROJECT_ID = "project-preview";
const OTHER_PROJECT_ID = "project-other";
const VIEWER_ID = "service:preview-viewer";

type EnvironmentSnapshot = Record<string, string | undefined>;

function saveEnvironment(names: string[]): EnvironmentSnapshot {
  return Object.fromEntries(names.map((name) => [name, process.env[name]]));
}

function restoreEnvironment(snapshot: EnvironmentSnapshot): void {
  for (const [name, value] of Object.entries(snapshot)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

function operationHeaders(operationId: string): Record<string, string> {
  return {
    "x-relay-actor-id": VIEWER_ID,
    "x-relay-actor-kind": "agent",
    "x-relay-operation-id": operationId,
    "x-relay-request-id": crypto.randomUUID(),
    "x-relay-command-at": String(Date.now()),
    "idempotency-key": crypto.randomUUID(),
  };
}

function serviceHeaders(projectId = PROJECT_ID): Record<string, string> {
  return {
    Authorization: `Bearer ${PREVIEW_TOKEN}`,
    "x-organization-id": ORGANIZATION_ID,
    "x-project-id": projectId,
  };
}

async function assertControlConflict(responsePromise: Promise<Response>): Promise<void> {
  const response = await responsePromise;
  assert.equal(response.status, 403);
  assert.equal(
    ((await response.json()) as { code?: string }).code,
    "TARGET_CONTROL_LEASE_CONFLICT",
  );
}

async function persistReplayFixture(root: string, serial: string): Promise<void> {
  const id = "controller-owned-run";
  const dir = join(root, id);
  const run: PersistedRun = {
    schemaVersion: 5,
    id,
    projectId: PROJECT_ID,
    ownerId: VIEWER_ID,
    action: "app-map:settings:test:controller-owned",
    serial,
    platform: "ios",
    status: "error",
    attempts: 1,
    queuedAt: 1_787_175_782_645,
    logs: [],
    steps: [],
    frames: [],
    dir,
    writtenAt: 1_787_175_782_665,
    inputDigest: "preview-boundary-fixture",
    resolvedInputs: {},
    artifacts: [],
  };
  await mkdir(dir, { recursive: true });
  const raw = JSON.stringify(run, null, 2);
  await writeFile(join(dir, "run.json"), raw);
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({
      schemaVersion: 1,
      id,
      digest: createHash("sha256").update(raw).digest("hex"),
    }),
  );
}

test("shares project-scoped live preview without sharing the controller lease", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-live-preview-"));
  const environment = saveEnvironment([
    "RELAY_WORKSPACE_ROOT",
    "RELAY_RECIPES_DIR",
    "RELAY_TESTS_DIR",
    "RELAY_STATE_DIR",
    "RELAY_RUNS_DIR",
    "RELAY_AUTH_SUBJECT",
    "RELAY_AUTH_PROJECT_IDS",
    "RELAY_AUTH_ORGANIZATION_ID",
    "RELAY_AUTH_ROLE",
    "RELAY_REDACTION_MODE",
  ]);
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  process.env.RELAY_AUTH_SUBJECT = VIEWER_ID;
  process.env.RELAY_AUTH_PROJECT_IDS = `${PROJECT_ID},${OTHER_PROJECT_ID}`;
  process.env.RELAY_AUTH_ORGANIZATION_ID = ORGANIZATION_ID;
  process.env.RELAY_AUTH_ROLE = "viewer";
  process.env.RELAY_REDACTION_MODE = "on";

  const serial = "ios-controller-owned-preview";
  let observedContext: ReturnType<typeof currentOperationContext>;
  let streamCalls = 0;
  const auditStart = listAuditEvents(1_000).length;
  let server: Awaited<ReturnType<typeof startServer>> | undefined;

  try {
    const controllerLease = await leaseDevice({
      organizationId: ORGANIZATION_ID,
      projectId: PROJECT_ID,
      poolId: "local",
      deviceSerial: serial,
      ownerId: "agent:controller",
      expiresAt: Date.now() + 60_000,
    });
    await persistReplayFixture(process.env.RELAY_RUNS_DIR, serial);
    server = await startServer({
      host: "0.0.0.0",
      port: 0,
      token: PREVIEW_TOKEN,
      liveVideoStream: async (response, streamedSerial) => {
        streamCalls += 1;
        observedContext = currentOperationContext();
        response.writeHead(200, { "content-type": "text/plain" });
        response.end(streamedSerial);
      },
    });
    const baseUrl = `http://127.0.0.1:${server.port}`;

    const unauthenticated = await fetch(`${baseUrl}/device/stream?serial=${serial}`);
    assert.equal(unauthenticated.status, 401);

    const preview = await fetch(`${baseUrl}/device/stream?serial=${serial}`, {
      headers: serviceHeaders(),
    });
    assert.equal(preview.status, 200);
    assert.equal(await preview.text(), serial);
    assert.equal(streamCalls, 1);
    assert.equal(observedContext?.actorId, VIEWER_ID);
    assert.equal(observedContext?.actorKind, "agent");
    assert.equal(observedContext?.operationId, "target.stream.open");
    assert.equal(observedContext?.leaseId, undefined);

    const audit = listAuditEvents(1_000)
      .slice(auditStart)
      .find((event) => event.action === "target.preview.open" && event.result === "allow");
    assert.ok(audit);
    assert.equal(audit.subject, VIEWER_ID);
    assert.equal(audit.actorId, VIEWER_ID);
    assert.equal(audit.organizationId, ORGANIZATION_ID);
    assert.equal(audit.projectId, PROJECT_ID);
    assert.equal(audit.resource, "target");
    assert.equal(audit.target, serial);

    const rejectedLeaseUrl = await fetch(
      `${baseUrl}/device/stream?serial=${serial}&lease=${controllerLease.id}`,
      { headers: serviceHeaders() },
    );
    assert.equal(rejectedLeaseUrl.status, 400);
    const rejectedLeaseBody = await rejectedLeaseUrl.text();
    assert.match(rejectedLeaseBody, /remove it from the URL/i);
    assert.doesNotMatch(rejectedLeaseBody, new RegExp(controllerLease.id, "u"));
    assert.equal(streamCalls, 1);

    const otherProject = await fetch(`${baseUrl}/device/stream?serial=${serial}`, {
      headers: serviceHeaders(OTHER_PROJECT_ID),
    });
    assert.equal(otherProject.status, 403);
    assert.match(await otherProject.text(), /not shared with the current project/i);
    assert.equal(streamCalls, 1);

    const unauthorizedProject = await fetch(`${baseUrl}/device/stream?serial=${serial}`, {
      headers: serviceHeaders("project-not-granted"),
    });
    assert.equal(unauthorizedProject.status, 403);
    assert.match(await unauthorizedProject.text(), /not authorized for the requested scope/i);
    assert.equal(streamCalls, 1);

    const viewerInteraction = await fetch(`${baseUrl}/interact`, {
      method: "POST",
      headers: {
        ...serviceHeaders(),
        ...operationHeaders("target.interact"),
        "content-type": "application/json",
      },
      body: JSON.stringify({ serial, kind: "point", x: 20, y: 20 }),
    });
    assert.equal(viewerInteraction.status, 403);
    assert.equal(
      ((await viewerInteraction.json()) as { code?: string }).code,
      "PROJECT_ROLE_REQUIRED",
    );

    // Re-run the mutation checks as a role that may control a target. The
    // controller's lease must still win over that broader project role.
    process.env.RELAY_AUTH_ROLE = "runner";

    await assertControlConflict(
      fetch(`${baseUrl}/interact`, {
        method: "POST",
        headers: {
          ...serviceHeaders(),
          ...operationHeaders("target.interact"),
          "content-type": "application/json",
        },
        body: JSON.stringify({ serial, kind: "point", x: 20, y: 20 }),
      }),
    );

    await assertControlConflict(
      fetch(`${baseUrl}/device/video`, {
        method: "POST",
        headers: {
          ...serviceHeaders(),
          ...operationHeaders("target.video.start"),
          "content-type": "application/json",
        },
        body: JSON.stringify({ serial, action: "start" }),
      }),
    );

    await assertControlConflict(
      fetch(`${baseUrl}/runs/controller-owned-run/replay`, {
        method: "POST",
        headers: {
          ...serviceHeaders(),
          ...operationHeaders("run.replay"),
        },
      }),
    );
  } finally {
    await server?.close();
    restoreEnvironment(environment);
    await rm(root, { recursive: true, force: true });
  }
});
