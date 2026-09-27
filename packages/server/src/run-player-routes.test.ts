import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import type http from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { importAppMap, type PersistedRun } from "@relay/core";
import { handleRunRoute } from "./run-routes.js";
import type { RequestContext } from "./security.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWMAgv8AAQQBAP8H9UQAAAAASUVORK5CYII=",
  "base64",
);

const scope: RequestContext = {
  subject: "owner-1",
  organizationId: "org-1",
  projectId: "project-1",
  allowedProjects: ["project-1"],
  tokenKind: "local",
  localTrusted: true,
  role: "admin",
};

class CapturedResponse {
  status = 0;
  headers: Record<string, unknown> = {};
  body = Buffer.alloc(0);
  setHeader(name: string, value: unknown): void {
    this.headers[name] = value;
  }
  writeHead(status: number, headers: Record<string, unknown> = {}): this {
    this.status = status;
    Object.assign(this.headers, headers);
    return this;
  }
  end(chunk?: string | Buffer): this {
    if (chunk) this.body = Buffer.concat([this.body, Buffer.from(chunk)]);
    return this;
  }
}

async function writeRun(
  root: string,
  id: string,
  input: {
    configuration: Record<string, string>;
    sha: string;
    checkpointId: string;
    appMapId?: string;
    omitPlan?: boolean;
  },
): Promise<void> {
  const dir = join(root, `run_${id}`);
  await mkdir(join(dir, "frames"), { recursive: true });
  await writeFile(join(dir, "frames", "002.png"), PNG);
  const run: PersistedRun = {
    schemaVersion: 5,
    id,
    projectId: "project-1",
    ownerId: "owner-1",
    action: "app-map.test.run",
    title: "Player fixture",
    status: "ok",
    queuedAt: 1,
    startedAt: 1,
    finishedAt: 2,
    artifacts: [
      ...(input.omitPlan
        ? []
        : [
            {
              kind: "app-map-test-plan" as const,
              capturedAt: 1,
              data: { appMapId: input.appMapId ?? "player-map", appMapRevision: 1 },
            },
          ]),
      {
        kind: "capture-review",
        capturedAt: 2,
        data: {
          status: "pending",
          framePath: "frames/002.png",
          imageSha256: input.sha,
          slotId: `test-player::${input.checkpointId}::member`,
          requirementId: "test-player",
          checkpointId: input.checkpointId,
          caption: "Settings",
          configuration: input.configuration,
        },
      },
    ],
    dir,
  } as unknown as PersistedRun;
  const raw = JSON.stringify(run);
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

const MAP = {
  schemaVersion: 1,
  id: "player-map",
  organizationId: "org-1",
  projectId: "project-1",
  name: "Player map",
  revision: 1,
  notes: {},
  groups: {},
  proposals: {},
  activity: {},
  caseStacks: {},
  routines: {},
  flows: {},
  runs: {},
  targetResults: {},
  createdAt: 1,
  updatedAt: 1,
  screens: {
    "screen-home": {
      organizationId: "org-1",
      projectId: "project-1",
      appMapId: "player-map",
      id: "screen-home",
      title: "Member home",
      variantIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
    "screen-settings": {
      organizationId: "org-1",
      projectId: "project-1",
      appMapId: "player-map",
      id: "screen-settings",
      title: "Workspace settings",
      variantIds: [],
      createdAt: 1,
      updatedAt: 1,
    },
  },
  screenVariants: {},
  connections: {
    "open-settings": {
      organizationId: "org-1",
      projectId: "project-1",
      appMapId: "player-map",
      id: "open-settings",
      fromScreenId: "screen-home",
      destination: { kind: "screen", screenId: "screen-settings" },
      label: "Member settings",
      state: "ready",
      actions: [{ id: "tap-open-settings", kind: "tap", target: { label: "Settings" } }],
      sourceAnchor: { point: { x: 0.5, y: 0.1 } },
      createdAt: 1,
      updatedAt: 1,
    },
  },
  tests: {
    "test-player": {
      id: "test-player",
      name: "Player test",
      kind: "scenario",
      intentSchemaVersion: 1,
      createdAt: 1,
      updatedAt: 1,
      steps: [
        {
          id: "open-settings-step",
          intent: "Settings",
          capture: true,
          kind: "instruction",
          binding: { status: "resolved", kind: "connections", connectionIds: ["open-settings"] },
        },
      ],
    },
  },
};

async function callRoute(rawPath: string): Promise<{ status: number; body: unknown }> {
  const url = new URL(`http://localhost${rawPath}`);
  const captured = new CapturedResponse();
  const response = captured as unknown as http.ServerResponse;
  const request = Readable.from([]) as http.IncomingMessage;
  const handled = await handleRunRoute({
    method: "GET",
    pathname: url.pathname,
    url,
    request,
    response,
    scope,
  });
  const body = captured.body.length > 0 ? JSON.parse(captured.body.toString("utf8")) : undefined;
  return { status: captured.status, body: handled ? body : undefined };
}

test("player-manifest projects pinned run evidence into states, variants, and links", async (t) => {
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const root = await mkdtemp(join(tmpdir(), "relay-player-route-"));
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  t.after(async () => {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  });

  await writeRun(join(root, "runs"), "member-run", {
    configuration: { browser: "firefox", account: "member" },
    sha: "a".repeat(64),
    checkpointId: "open-settings-step",
  });
  await importAppMap({
    organizationId: "org-1",
    projectId: "project-1",
    appMap: structuredClone(MAP) as never,
    conflict: "replace",
  });

  const member = await callRoute("/runs/member-run/player-manifest");
  assert.equal(member.status, 200);
  const manifest = (member.body as { manifest: Record<string, unknown> }).manifest;
  assert.equal((manifest.pinned as { runIds?: string[] })?.runIds?.[0], "member-run");
  assert.deepEqual(
    (manifest.states as Array<{ title: string }>).map((state) => state.title).sort(),
    ["Member home", "Workspace settings"],
  );
  assert.equal((manifest.connections as Array<{ kind: string }>)[0]?.kind, "recorded");

  // A second configuration joins via ?with= and stays unsubstituted.
  await writeRun(join(root, "runs"), "admin-run", {
    configuration: { browser: "chrome", account: "admin" },
    sha: "b".repeat(64),
    checkpointId: "open-settings-step",
  });
  const both = await callRoute("/runs/member-run/player-manifest?with=admin-run");
  assert.equal(both.status, 200);
  const multi = (both.body as { manifest: Record<string, unknown> }).manifest;
  assert.equal((multi.variants as unknown[]).length, 2);
  assert.equal((multi.captures as unknown[]).length, 2);
  assert.equal((multi.missing as unknown[]).length, 0);
});

test("walkthrough-pack exports the joined runs and names a changed frame", async (t) => {
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const root = await mkdtemp(join(tmpdir(), "relay-walkthrough-pack-route-"));
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  t.after(async () => {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  });
  const sha = createHash("sha256").update(PNG).digest("hex");
  await writeRun(join(root, "runs"), "member-run", {
    configuration: { browser: "firefox", account: "member" },
    sha,
    checkpointId: "open-settings-step",
  });
  await writeRun(join(root, "runs"), "admin-run", {
    configuration: { browser: "chrome", account: "admin" },
    sha,
    checkpointId: "open-settings-step",
  });
  await importAppMap({
    organizationId: "org-1",
    projectId: "project-1",
    appMap: structuredClone(MAP) as never,
    conflict: "replace",
  });

  const packed = await callRoute("/runs/member-run/walkthrough-pack?with=admin-run");
  assert.equal(packed.status, 200);
  const pack = (
    packed.body as {
      pack: { manifest: { pinned: { runIds: string[] }; captures: unknown[] }; frames: unknown[] };
    }
  ).pack;
  assert.deepEqual(pack.manifest.pinned.runIds, ["member-run", "admin-run"]);
  assert.equal(pack.manifest.captures.length, 2);
  assert.equal(pack.frames.length, 2);

  await writeFile(
    join(root, "runs", "run_admin-run", "frames", "002.png"),
    Buffer.from("tampered"),
  );
  await assert.rejects(
    () => callRoute("/runs/member-run/walkthrough-pack?with=admin-run"),
    /tampered frame frames\/002\.png on run admin-run/u,
  );
});

test("walkthrough refuses a joined run from another app", async (t) => {
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const root = await mkdtemp(join(tmpdir(), "relay-walkthrough-foreign-"));
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  t.after(async () => {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  });
  const sha = createHash("sha256").update(PNG).digest("hex");
  await writeRun(join(root, "runs"), "member-run", {
    configuration: { browser: "firefox", account: "member" },
    sha,
    checkpointId: "open-settings-step",
  });
  await writeRun(join(root, "runs"), "other-app-run", {
    configuration: { browser: "chrome", account: "admin" },
    sha,
    checkpointId: "open-settings-step",
    appMapId: "other-map",
  });
  await importAppMap({
    organizationId: "org-1",
    projectId: "project-1",
    appMap: structuredClone(MAP) as never,
    conflict: "replace",
  });

  await assert.rejects(
    () => callRoute("/runs/member-run/walkthrough-pack?with=other-app-run"),
    /Run other-app-run belongs to App Map other-map, not player-map/u,
  );
  await assert.rejects(
    () => callRoute("/runs/member-run/player-manifest?with=other-app-run"),
    /Run other-app-run belongs to App Map other-map, not player-map/u,
  );
  await assert.rejects(
    () => callRoute("/runs/member-run/walkthrough-pack?appMap=other-map"),
    /Run member-run belongs to App Map player-map, not other-map/u,
  );
  await writeRun(join(root, "runs"), "unscoped-run", {
    configuration: { browser: "webkit", account: "guest" },
    sha,
    checkpointId: "open-settings-step",
    omitPlan: true,
  });
  await assert.rejects(
    () => callRoute("/runs/member-run/walkthrough-pack?with=unscoped-run"),
    /Run unscoped-run has no App Map plan identity and cannot be joined/u,
  );
});

test("player-manifest rejects runs without plan identity unless appMap is explicit", async (t) => {
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const root = await mkdtemp(join(tmpdir(), "relay-player-route-bare-"));
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  t.after(async () => {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  });
  const dir = join(root, "runs", "run_bare");
  await mkdir(join(dir, "frames"), { recursive: true });
  const run = {
    schemaVersion: 5,
    id: "bare",
    projectId: "project-1",
    ownerId: "o",
    action: "observe",
    status: "ok",
    queuedAt: 1,
    artifacts: [],
    dir,
  } as unknown as PersistedRun;
  const raw = JSON.stringify(run);
  await writeFile(join(dir, "run.json"), raw);
  await writeFile(
    join(dir, ".complete"),
    JSON.stringify({
      schemaVersion: 1,
      id: "bare",
      digest: createHash("sha256").update(raw).digest("hex"),
    }),
  );
  await assert.rejects(
    () => callRoute("/runs/bare/player-manifest"),
    (error: unknown) => {
      const status = (error as { status?: number }).status;
      return status === 422;
    },
  );
});

test("frame bytes that do not match the recorded digest are not served", async (t) => {
  const previousState = process.env.RELAY_STATE_DIR;
  const previousRuns = process.env.RELAY_RUNS_DIR;
  const root = await mkdtemp(join(tmpdir(), "relay-frame-digest-"));
  process.env.RELAY_STATE_DIR = root;
  process.env.RELAY_RUNS_DIR = join(root, "runs");
  t.after(async () => {
    if (previousState === undefined) delete process.env.RELAY_STATE_DIR;
    else process.env.RELAY_STATE_DIR = previousState;
    if (previousRuns === undefined) delete process.env.RELAY_RUNS_DIR;
    else process.env.RELAY_RUNS_DIR = previousRuns;
    await rm(root, { recursive: true, force: true });
  });
  const sha = createHash("sha256").update(PNG).digest("hex");
  await writeRun(join(root, "runs"), "member-run", {
    configuration: { browser: "firefox", account: "member" },
    sha,
    checkpointId: "open-settings-step",
  });
  assert.equal(await frameStatus("/runs/member-run/frames/002.png"), 200);
  await writeFile(
    join(root, "runs", "run_member-run", "frames", "002.png"),
    Buffer.from("tampered"),
  );
  await assert.rejects(
    () => frameStatus("/runs/member-run/frames/002.png"),
    (error: unknown) => (error as { status?: number }).status === 409,
  );
});

async function frameStatus(rawPath: string): Promise<number> {
  const url = new URL(`http://localhost${rawPath}`);
  const captured = new CapturedResponse();
  await handleRunRoute({
    method: "GET",
    pathname: url.pathname,
    url,
    request: Readable.from([]) as http.IncomingMessage,
    response: captured as unknown as http.ServerResponse,
    scope,
  });
  return captured.status;
}
