import assert from "node:assert/strict";
import test from "node:test";
import { mappedCommandDescriptors } from "./commands.js";
import { parseCli, redactedConfig } from "./config.js";

test("global configuration uses CLI over environment over defaults", () => {
  const parsed = parseCli(
    [
      "operation",
      "invoke",
      "system.health.get",
      "--input",
      "{}",
      "--server",
      "https://cli.example",
      "--organization=cli-org",
      "--project",
      "cli-project",
      "--actor",
      "agent:cli",
      "--timeout",
      "321",
      "--no-wait",
    ],
    {
      RELAY_URL: "https://env.example",
      RELAY_ORGANIZATION_ID: "env-org",
      RELAY_PROJECT_ID: "env-project",
      RELAY_ACTOR_ID: "human:env",
      RELAY_TIMEOUT_MS: "999",
      RELAY_WAIT: "true",
    },
  );

  assert.equal(parsed.config.connection.url, "https://cli.example");
  assert.equal(parsed.config.connection.organizationId, "cli-org");
  assert.equal(parsed.config.connection.projectId, "cli-project");
  assert.equal(parsed.config.connection.actorId, "agent:cli");
  assert.equal(parsed.config.connection.actorKind, "agent");
  assert.equal(parsed.config.timeoutMs, 321);
  assert.equal(parsed.config.wait, false);

  const fromEnvironment = parseCli(["operation", "invoke", "system.health.get", "--input", "{}"], {
    RELAY_URL: "https://env.example",
    RELAY_PROJECT_ID: "env-project",
  });
  assert.equal(fromEnvironment.config.connection.url, "https://env.example");
  assert.equal(fromEnvironment.config.connection.projectId, "env-project");
  assert.equal(fromEnvironment.config.connection.organizationId, "local");
});

test("credential source reads a named environment variable and redacts its value", () => {
  const secret = "super-secret-token";
  const parsed = parseCli(
    [
      "operation",
      "invoke",
      "system.health.get",
      "--input",
      "{}",
      "--credential-source",
      "env:MY_RELAY_TOKEN",
    ],
    { MY_RELAY_TOKEN: secret },
  );

  assert.deepEqual(parsed.config.connection.auth, { type: "bearer", token: secret });
  const rendered = JSON.stringify(redactedConfig(parsed.config));
  assert.doesNotMatch(rendered, /super-secret-token/);
  assert.match(rendered, /env:MY_RELAY_TOKEN/);
  assert.match(rendered, /configured/);
});

test("an explicitly selected environment credential must exist", () => {
  assert.throws(
    () =>
      parseCli(
        [
          "operation",
          "invoke",
          "system.health.get",
          "--input",
          "{}",
          "--credential-source",
          "env:MISSING_TOKEN",
        ],
        {},
      ),
    /MISSING_TOKEN is not set/,
  );
  assert.throws(
    () =>
      parseCli(["operation", "invoke", "system.health.get", "--input", "{}"], {
        RELAY_CREDENTIAL_SOURCE: "env:MISSING_FROM_ENV",
      }),
    /MISSING_FROM_ENV is not set/,
  );
});

test("the absent default credential source remains unauthenticated", () => {
  const parsed = parseCli(["operation", "invoke", "system.health.get", "--input", "{}"], {});

  assert.deepEqual(parsed.config.credentialSource, {
    type: "env",
    name: "RELAY_AUTH_TOKEN",
  });
  assert.deepEqual(parsed.config.connection.auth, { type: "none" });
});

test("--help and -h are accepted as global switches", () => {
  assert.deepEqual(parseCli(["--help"], {}).command, "help");
  assert.deepEqual(parseCli(["-h"], {}).command, "help");
  for (const [argv, family] of [
    [["operation", "--help"], "operation"],
    [["operation", "-h"], "operation"],
    [["help", "target"], "target"],
    [["session", "--help"], "session"],
  ] as const) {
    const parsed = parseCli(argv, {});
    assert.equal(parsed.command, "help");
    if (parsed.command === "help") assert.equal(parsed.helpFamily, family);
  }
});

test("machine output modes and wait switches reject ambiguous combinations", () => {
  assert.throws(() => parseCli(["help", "--json", "--ndjson"], {}), /only one/);
  assert.throws(() => parseCli(["help", "--wait", "--no-wait"], {}), /only one/);
});

test("every friendly command path parses to its descriptor operation", () => {
  for (const descriptor of mappedCommandDescriptors) {
    for (const candidate of descriptor.paths) {
      const arguments_ = (candidate.arguments ?? []).map((key) => `${key}-value`);
      const parsed = parseCli([...candidate.command.split(" "), ...arguments_], {});
      assert.equal(parsed.command, "invoke", candidate.command);
      if (parsed.command !== "invoke") continue;
      assert.equal(parsed.operationId, descriptor.operationId, candidate.command);
    }
  }
});

test("friendly inputs default to an object and path arguments override JSON fields", () => {
  const list = parseCli(["journey", "list"], {});
  assert.equal(list.command, "invoke");
  if (list.command === "invoke") assert.deepEqual(list.input, {});

  const screenshot = parseCli(["target", "screenshot", "pixel-9"], {});
  assert.equal(screenshot.command, "invoke");
  if (screenshot.command === "invoke") {
    assert.equal(screenshot.operationId, "target.screenshot.capture");
    assert.deepEqual(screenshot.input, { serial: "pixel-9" });
  }

  const journey = parseCli(
    [
      "journey",
      "update",
      "checkout",
      "--input",
      '{"journeyId":"wrong","expectedRevision":7,"value":{"title":"Checkout"}}',
    ],
    {},
  );
  assert.equal(journey.command, "invoke");
  if (journey.command === "invoke") {
    assert.deepEqual(journey.input, {
      journeyId: "checkout",
      expectedRevision: 7,
      value: { title: "Checkout" },
    });
  }
});

test("event follow retains its command path and rejects single-object JSON output", () => {
  const parsed = parseCli(["system", "events", "follow", "--ndjson"], {});
  assert.equal(parsed.command, "invoke");
  if (parsed.command === "invoke") {
    assert.equal(parsed.commandPath, "system events follow");
    assert.equal(parsed.operationId, "event.stream");
  }
  assert.throws(
    () => parseCli(["system", "events", "follow", "--json"], {}),
    /stream; use --ndjson.*instead of --json/,
  );
});

test("friendly aliases and lifecycle commands construct operation inputs", () => {
  const cases = [
    [["screen", "list", "journey-1"], "journey.document.get", { journeyId: "journey-1" }],
    [
      ["connection", "update", "journey-1", "--input", '{"expectedRevision":3}'],
      "journey.document.update",
      { journeyId: "journey-1", expectedRevision: 3 },
    ],
    [
      ["session", "tap", "session-1", "--input", '{"interaction":{"target":{"x":4,"y":8}}}'],
      "authoring.session.interact",
      { sessionId: "session-1", interaction: { kind: "tap", target: { x: 4, y: 8 } } },
    ],
    [
      ["take", "replace", "session-1", "action-2"],
      "authoring.take.replace",
      { sessionId: "session-1", actionId: "action-2" },
    ],
    [["collection", "run", "smoke"], "collection.run", { collectionId: "smoke" }],
    [["run", "pin", "update", "run-1"], "run.pin.update", { runId: "run-1" }],
    [
      ["discovery", "capture", "discovery-1", "pixel-9"],
      "discovery.capture",
      { sessionId: "discovery-1", serial: "pixel-9" },
    ],
    [
      ["policy", "privacy", "update", "--input", '{"enabled":true}'],
      "workspace.privacy.update",
      { enabled: true },
    ],
  ] as const;

  for (const [argv, operationId, input] of cases) {
    const parsed = parseCli(argv, {});
    assert.equal(parsed.command, "invoke");
    if (parsed.command !== "invoke") continue;
    assert.equal(parsed.operationId, operationId);
    assert.deepEqual(parsed.input, input);
  }
});

test("generic invocation still requires explicit object input", () => {
  assert.throws(
    () => parseCli(["operation", "invoke", "system.health.get"], {}),
    /requires --input/,
  );
  assert.throws(
    () => parseCli(["operation", "invoke", "system.health.get", "--input", "[]"], {}),
    /JSON object/,
  );
});

test("target and session mutations report missing explicit identities", () => {
  assert.throws(
    () => parseCli(["target", "screenshot"], {}),
    /target screenshot requires <serial>/,
  );
  assert.throws(() => parseCli(["session", "tap"], {}), /session tap requires <sessionId>/);
  assert.throws(
    () => parseCli(["take", "replace", "session-1"], {}),
    /take replace requires <actionId>/,
  );
});

test("resource commands and App Map aliases parse with explicit behavior", () => {
  const resource = parseCli(
    ["activity", "list", "--input", '{"limit":25,"cursor":"next/value"}'],
    {},
  );
  assert.deepEqual(resource, {
    config: resource.config,
    command: "resource",
    resourceId: "activity.list",
    resourcePath: "/activity?limit=25&cursor=next%2Fvalue",
    commandPath: "activity list",
  });

  const flow = parseCli(["flow", "run", "checkout", "Main"], {});
  assert.equal(flow.command, "invoke");
  if (flow.command === "invoke") {
    assert.equal(flow.operationId, "job.graph-path.start");
    assert.deepEqual(flow.input, { recipe: "checkout", flowName: "Main" });
  }

  const follow = parseCli(["activity", "follow", "--ndjson"], {});
  assert.equal(follow.command, "invoke");
  if (follow.command === "invoke") assert.equal(follow.behavior, "event-stream");
  assert.throws(() => parseCli(["activity", "follow", "--json"], {}), /stream; use --ndjson/);
});

test("screenshot output flags reject ambiguous or unrelated use", () => {
  const file = parseCli(["device", "screenshot", "pixel-9", "--file", "shot.png"], {});
  assert.equal(file.command, "invoke");
  if (file.command === "invoke") {
    assert.deepEqual(file.screenshotOutput, { kind: "file", path: "shot.png", force: false });
  }

  const binary = parseCli(["target", "screenshot", "pixel-9", "--binary"], {});
  assert.equal(binary.command, "invoke");
  if (binary.command === "invoke") assert.deepEqual(binary.screenshotOutput, { kind: "binary" });

  assert.throws(
    () => parseCli(["device", "screenshot", "pixel-9", "--binary", "--json"], {}),
    /cannot be combined/,
  );
  assert.throws(
    () => parseCli(["device", "screenshot", "pixel-9", "--file", "a.png", "--binary"], {}),
    /only one/,
  );
  assert.throws(() => parseCli(["map", "list", "--file", "a.png"], {}), /only valid/);
  assert.throws(
    () => parseCli(["device", "screenshot", "pixel-9", "--force"], {}),
    /requires --file/,
  );
});
