import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  assert.equal(fromEnvironment.config.timeoutMs, 180_000);
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
      const confirmed = [
        "app-map.scroll-surface.origin.review",
        "app-map.scroll-surface.origin.revoke",
      ].includes(descriptor.operationId);
      const parsed = parseCli(
        [...candidate.command.split(" "), ...arguments_, ...(confirmed ? ["--confirm"] : [])],
        {},
      );
      assert.equal(parsed.command, "invoke", candidate.command);
      if (parsed.command !== "invoke") continue;
      assert.equal(parsed.operationId, descriptor.operationId, candidate.command);
    }
  }
});

test("reviewed-origin commands require a CLI confirmation separate from their assertion", () => {
  const input =
    '{"expectedRevision":13,"reason":"Reviewed immutable first viewport.","assertion":"reviewed-document-top"}';
  assert.throws(
    () =>
      parseCli(
        [
          "screen",
          "origin",
          "review",
          "map-1",
          "screen-1",
          "variant-1",
          "capture-1",
          "--input",
          input,
        ],
        {},
      ),
    /requires --confirm/u,
  );
  const parsed = parseCli(
    [
      "screen",
      "origin",
      "review",
      "map-1",
      "screen-1",
      "variant-1",
      "capture-1",
      "--confirm",
      "--input",
      input,
    ],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command === "invoke") {
    assert.equal(parsed.operationId, "app-map.scroll-surface.origin.review");
    assert.equal(parsed.input.assertion, "reviewed-document-top");
    assert.equal(parsed.input.confirmation, "confirm");
  }
});

test("friendly inputs default to an object and path arguments override JSON fields", () => {
  const list = parseCli(["map", "list"], {});
  assert.equal(list.command, "invoke");
  if (list.command === "invoke") assert.deepEqual(list.input, {});

  const screenshot = parseCli(["target", "screenshot", "pixel-9"], {});
  assert.equal(screenshot.command, "invoke");
  if (screenshot.command === "invoke") {
    assert.equal(screenshot.operationId, "target.screenshot.capture");
    assert.deepEqual(screenshot.input, { serial: "pixel-9" });
  }

  const map = parseCli(
    [
      "map",
      "update",
      "checkout",
      "--input",
      '{"appMapId":"wrong","expectedRevision":7,"patch":{"name":"Checkout"}}',
    ],
    {},
  );
  assert.equal(map.command, "invoke");
  if (map.command === "invoke") {
    assert.deepEqual(map.input, {
      appMapId: "checkout",
      expectedRevision: 7,
      patch: { name: "Checkout" },
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
    [["screen", "list", "map-1"], "app-map.get", { appMapId: "map-1" }],
    [
      [
        "connection",
        "update",
        "map-1",
        "continue",
        "--input",
        '{"expectedRevision":3,"patch":{"label":"Continue"}}',
      ],
      "app-map.connection.update",
      {
        appMapId: "map-1",
        connectionId: "continue",
        expectedRevision: 3,
        patch: { label: "Continue" },
      },
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

test("input files preserve multiline values and cannot conflict with inline JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-cli-input-"));
  const path = join(root, "input.json");
  writeFileSync(path, JSON.stringify({ text: "alpha\nbeta\ngamma" }), "utf8");
  try {
    const parsed = parseCli(["operation", "invoke", "step.run", "--input-file", path], {});
    assert.equal(parsed.command, "invoke");
    if (parsed.command === "invoke") assert.deepEqual(parsed.input, { text: "alpha\nbeta\ngamma" });
    assert.throws(
      () =>
        parseCli(["operation", "invoke", "step.run", "--input", "{}", "--input-file", path], {}),
      /only one of --input or --input-file/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("input files resolve from the caller directory under package-manager wrappers", () => {
  const root = mkdtempSync(join(tmpdir(), "relay-cli-caller-"));
  const path = join(root, "input.json");
  writeFileSync(path, '{"expectedRevision":39}', "utf8");
  try {
    const parsed = parseCli(["connect", "update", "map", "edge", "--input-file", "input.json"], {
      INIT_CWD: root,
    });
    assert.equal(parsed.command, "invoke");
    if (parsed.command === "invoke") assert.equal(parsed.input.expectedRevision, 39);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
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

  const flow = parseCli(["flow", "run", "checkout", "main"], {});
  assert.equal(flow.command, "invoke");
  if (flow.command === "invoke") {
    assert.equal(flow.operationId, "app-map.flow.run");
    assert.deepEqual(flow.input, { appMapId: "checkout", flowId: "main" });
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
  const marked = parseCli(
    ["device", "screenshot", "pixel-9", "--mark", "78,88", "--file", "p.png"],
    {},
  );
  assert.equal(marked.command, "invoke");
  if (marked.command === "invoke") {
    assert.deepEqual(marked.input, { serial: "pixel-9", previewX: 78, previewY: 88 });
  }
  const snapshot = parseCli(["device", "snapshot", "pixel-9"], {});
  assert.equal(snapshot.command, "invoke");
  if (snapshot.command === "invoke") {
    assert.equal(snapshot.input.visual, true);
    assert.equal(snapshot.input.full, undefined);
    assert.deepEqual(snapshot.screenshotOutput, { kind: "default" });
  }
  const fullSnapshot = parseCli(["device", "snapshot", "pixel-9", "--full"], {});
  assert.equal(fullSnapshot.command, "invoke");
  if (fullSnapshot.command === "invoke") {
    assert.equal(fullSnapshot.input.full, true);
    assert.equal(fullSnapshot.input.visual, true);
  }
  const snapshotFile = parseCli(["device", "snapshot", "pixel-9", "--file", "tree.json"], {});
  assert.equal(snapshotFile.command, "invoke");
  if (snapshotFile.command === "invoke") {
    assert.equal(snapshotFile.input.full, true);
    assert.deepEqual(snapshotFile.screenshotOutput, {
      kind: "file",
      path: "tree.json",
      force: false,
    });
  }
  assert.throws(() => parseCli(["device", "screenshot", "pixel-9", "--full"], {}), /only valid/);
  assert.throws(() => parseCli(["device", "snapshot", "pixel-9", "--binary"], {}), /only valid/);
  const teach = parseCli(
    [
      "map",
      "teach",
      "settings",
      "--input",
      JSON.stringify({
        target: { kind: "device", platform: "android", targetId: "pixel-9" },
        leaseId: "lease-1",
        title: "Connections",
        interaction: { kind: "point", x: 540, y: 1275 },
      }),
    ],
    {},
  );
  assert.equal(teach.command, "invoke");
  if (teach.command === "invoke") {
    assert.equal(teach.operationId, "app-map.teach");
    assert.equal(teach.input.appMapId, "settings");
  }
  const teachScroll = parseCli(
    [
      "map",
      "teach",
      "settings",
      "--input",
      JSON.stringify({
        target: { kind: "device", platform: "android", targetId: "pixel-9" },
        leaseId: "lease-1",
        fromScreenId: "settings-top",
        interaction: {
          kind: "swipe",
          from: { x: 540, y: 1720 },
          to: { x: 540, y: 620 },
          durationMs: 280,
        },
      }),
    ],
    {},
  );
  assert.equal(teachScroll.command, "invoke");
  if (teachScroll.command === "invoke") {
    assert.deepEqual(teachScroll.input.interaction, {
      kind: "swipe",
      from: { x: 540, y: 1720 },
      to: { x: 540, y: 620 },
      durationMs: 280,
    });
  }
  assert.throws(
    () => parseCli(["device", "launch", "pixel-9", "Grok", "--mark", "1,2"], {}),
    /only valid/,
  );
  assert.throws(
    () => parseCli(["device", "screenshot", "pixel-9", "--mark", "nope"], {}),
    /<x>,<y>/,
  );
  const preview = parseCli(
    [
      "device",
      "interact",
      "pixel-9",
      "--preview",
      "--file",
      "preview.png",
      "--input",
      '{"kind":"label","label":"Back"}',
    ],
    {},
  );
  assert.equal(preview.command, "invoke");
  if (preview.command === "invoke") {
    assert.equal(preview.behavior, "screenshot");
    assert.equal(preview.input.preview, true);
    assert.deepEqual(preview.screenshotOutput, { kind: "file", path: "preview.png", force: false });
  }
});
