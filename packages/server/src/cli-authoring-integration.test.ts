import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { RelayClient } from "@relay/client";
import type { AuthoringRuntime } from "@relay/core";
import type {
  AuthoringInteraction,
  AuthoringSession,
  EventEnvelope,
  RecipeStep,
} from "@relay/protocol";
import { startServer, type StartedServer } from "./index.js";

type RunCli = (
  argv: readonly string[],
  dependencies?: {
    env?: Record<string, string | undefined>;
    streams?: { stdout: PassThrough; stderr: PassThrough };
    registerSignalHandlers?: boolean;
  },
) => Promise<number>;

const cliModulePath = "../../cli/src/index.js";
const { runCli } = (await import(cliModulePath)) as { runCli: RunCli };

class FakeRuntime implements AuthoringRuntime {
  screen = "source";
  observations = 0;
  executed: AuthoringInteraction[] = [];
  replayed: RecipeStep[][] = [];

  async observe() {
    this.observations += 1;
    const capturedAt = 1_000 + this.observations;
    return {
      capturedAt,
      targetId: "device-cli-authoring",
      fingerprint: `fingerprint-${this.screen}`,
      bounds: { width: 400, height: 800 },
      nodes: [{ role: "button", label: this.screen }],
      screenshot: { data: Buffer.from(`png:${this.screen}:${capturedAt}`), mime: "image/png" },
    };
  }

  async execute(_session: AuthoringSession, interaction: AuthoringInteraction) {
    this.executed.push(structuredClone(interaction));
    if (interaction.kind === "key" || interaction.kind === "tap") this.screen = "destination";
  }

  async replay(_session: AuthoringSession, steps: RecipeStep[]) {
    this.replayed.push(structuredClone(steps));
  }

  async startVideo() {}

  async stopVideo() {
    return { data: Buffer.from("fake-video"), mime: "video/mp4" };
  }
}

function captureStreams() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let output = "";
  let diagnostics = "";
  stdout.on("data", (chunk) => (output += String(chunk)));
  stderr.on("data", (chunk) => (diagnostics += String(chunk)));
  return {
    streams: { stdout, stderr },
    stdout: () => output,
    stderr: () => diagnostics,
  };
}

async function runJsonCommand(
  command: readonly string[],
  connection: { server: string; projectId: string; actorId: string },
): Promise<{ session: AuthoringSession }> {
  const capture = captureStreams();
  const code = await runCli(
    [
      ...command,
      "--server",
      connection.server,
      "--organization",
      "local",
      "--project",
      connection.projectId,
      "--actor",
      connection.actorId,
      "--credential-source",
      "none",
      "--json",
    ],
    { env: {}, streams: capture.streams, registerSignalHandlers: false },
  );
  assert.equal(code, 0, capture.stderr());
  assert.equal(capture.stderr(), "");
  const terminal = JSON.parse(capture.stdout()) as {
    type: string;
    ok: boolean;
    result: { session: AuthoringSession };
  };
  assert.equal(terminal.type, "result");
  assert.equal(terminal.ok, true);
  return terminal.result;
}

async function waitForEvents(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for authoring events");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test("CLI authoring commands commit a fake transition visible to another client", async () => {
  const root = await mkdtemp(join(tmpdir(), "relay-cli-authoring-"));
  const environment = {
    RELAY_WORKSPACE_ROOT: process.env.RELAY_WORKSPACE_ROOT,
    RELAY_STATE_DIR: process.env.RELAY_STATE_DIR,
    RELAY_RECIPES_DIR: process.env.RELAY_RECIPES_DIR,
    GROK_DEVICE_RECIPES_DIR: process.env.GROK_DEVICE_RECIPES_DIR,
    RELAY_TESTS_DIR: process.env.RELAY_TESTS_DIR,
  };
  process.env.RELAY_WORKSPACE_ROOT = root;
  process.env.RELAY_STATE_DIR = join(root, "state");
  process.env.RELAY_RECIPES_DIR = join(root, "recipes");
  process.env.GROK_DEVICE_RECIPES_DIR = join(root, "recipes");
  process.env.RELAY_TESTS_DIR = join(root, "tests");

  const runtime = new FakeRuntime();
  let server: StartedServer | undefined;
  const eventAbort = new AbortController();
  let eventSubscription: Promise<void> | undefined;
  try {
    server = await startServer({
      host: "127.0.0.1",
      port: 0,
      authoringRuntime: runtime,
    });
    const serverUrl = `http://127.0.0.1:${server.port}`;
    const projectId = "project-cli-authoring";
    const actorId = "human:cli-author";
    const targetId = "device-cli-authoring";
    const poolId = "pool-cli-authoring";
    const connection = {
      url: serverUrl,
      auth: { type: "none" as const },
      organizationId: "local",
      projectId,
      actorId,
      actorKind: "human" as const,
    };
    const setup = new RelayClient(connection);
    const observer = new RelayClient({
      ...connection,
      actorId: "agent:app-observer",
      actorKind: "agent",
    });
    const events: EventEnvelope[] = [];
    let openEvents!: () => void;
    const eventsOpen = new Promise<void>((resolve) => (openEvents = resolve));
    eventSubscription = observer.events((event) => events.push(event), {
      signal: eventAbort.signal,
      onOpen: openEvents,
    });
    await eventsOpen;

    await setup.saveDevicePool({
      id: poolId,
      name: "CLI authoring fake devices",
      platform: "android",
      deviceSerials: [targetId],
    });
    const created = await setup.invoke("journey.create", {
      expectedRevision: 0,
      title: "CLI Authoring Integration",
      steps: [],
    });
    const initialJourney = await setup.journey(created.journey.id);
    const lease = await setup.lease({
      poolId,
      deviceSerial: targetId,
      expiresAt: Date.now() + 60_000,
    });
    const cliConnection = { server: serverUrl, projectId, actorId };

    const createdSession = await runJsonCommand(
      [
        "session",
        "create",
        "--input",
        JSON.stringify({
          journeyId: created.journey.id,
          target: { kind: "device", platform: "android", targetId },
          leaseId: lease.lease.id,
          expectedJourneyRevision: initialJourney.revision,
          expectedRecipeRevision: created.journey.updatedAt,
        }),
      ],
      cliConnection,
    );
    const sessionId = createdSession.session.id;
    assert.match(sessionId, /^authoring-/);
    assert.equal(createdSession.session.state, "preparing");

    const observed = await runJsonCommand(["session", "observe", sessionId], cliConnection);
    assert.equal(observed.session.state, "ready");
    const started = await runJsonCommand(["session", "start", sessionId], cliConnection);
    assert.equal(started.session.state, "recording");
    const interacted = await runJsonCommand(["session", "back", sessionId], cliConnection);
    assert.equal(interacted.session.take?.revisions.at(-1)?.actions.length, 1);
    const stopped = await runJsonCommand(["session", "stop", sessionId], cliConnection);
    assert.equal(stopped.session.state, "reviewing");
    const replayed = await runJsonCommand(["take", "replay", sessionId], cliConnection);
    assert.equal(replayed.session.take?.replayAttempts.at(-1)?.outcome, "passed");
    const committed = await runJsonCommand(
      [
        "session",
        "commit",
        sessionId,
        "--input",
        JSON.stringify({ destination: { kind: "new-screen", title: "CLI destination" } }),
      ],
      cliConnection,
    );
    assert.equal(committed.session.state, "committed");
    assert.ok(committed.session.committedTransitionId);

    await waitForEvents(() =>
      events.some(
        (event) =>
          event.payload.type === "authoring.committed" && event.payload.sessionId === sessionId,
      ),
    );
    const resourceEvent = events.find(
      (event) =>
        event.payload.type === "resource.updated" &&
        event.payload.resource === "recording-session" &&
        event.payload.resourceId === sessionId &&
        event.actorId === actorId,
    );
    assert.ok(resourceEvent);
    assert.match(resourceEvent.operationId, /^authoring\.session\./);
    const committedEvent = events.find(
      (event) =>
        event.payload.type === "authoring.committed" && event.payload.sessionId === sessionId,
    );
    assert.equal(committedEvent?.actorId, actorId);
    assert.equal(committedEvent?.actorKind, "human");
    assert.equal(committedEvent?.operationId, "authoring.session.commit");

    const visibleSession = await observer.authoringSession(sessionId);
    assert.equal(visibleSession.session.state, "committed");
    const finalJourney = await observer.journey(created.journey.id);
    assert.equal(finalJourney.revision, initialJourney.revision + 1);
    const transition = finalJourney.value.graph?.transitions.find(
      (item) => item.id === committed.session.committedTransitionId,
    );
    assert.ok(transition);
    assert.equal(transition.state, "recorded");
    assert.equal(transition.destination.kind, "screen");
    assert.notEqual(
      transition.destination.kind === "screen" ? transition.destination.screenId : undefined,
      transition.fromScreenId,
    );
    const destination = finalJourney.value.graph?.screens.find(
      (screen) =>
        transition.destination.kind === "screen" && screen.id === transition.destination.screenId,
    );
    assert.equal(destination?.title, "CLI destination");
    assert.deepEqual(
      runtime.executed.map((interaction) => interaction.kind),
      ["key"],
    );
    assert.equal(runtime.replayed.length, 1);
    assert.equal(runtime.replayed[0]?.[0]?.kind, "key");
  } finally {
    eventAbort.abort();
    await eventSubscription?.catch(() => undefined);
    await server?.close();
    for (const [name, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
});
