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
  assert.equal(parsed.config.ensureLocalServer, false);
  assert.equal(fromEnvironment.config.ensureLocalServer, false);

  const implicitLocal = parseCli(["connect"], {});
  assert.equal(implicitLocal.config.ensureLocalServer, true);
  const explicitLocal = parseCli(["connect", "--server", "http://127.0.0.1:8787"], {});
  assert.equal(explicitLocal.config.ensureLocalServer, false);
  const environmentLocal = parseCli(["connect"], { RELAY_URL: "http://127.0.0.1:8787" });
  assert.equal(environmentLocal.config.ensureLocalServer, false);
});

test("test compile accepts --full as an output choice without changing the request", () => {
  const parsed = parseCli(
    ["test", "compile", "grok-android", "settings", "--full", "--input", '{"targetProfileId":"android"}'],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") return;
  assert.equal(parsed.operationId, "app-map.test.compile");
  assert.equal(parsed.full, true);
  assert.deepEqual(parsed.input, {
    appMapId: "grok-android",
    testId: "settings",
    targetProfileId: "android",
  });
  assert.throws(() => parseCli(["activity", "list", "--full"], {}), /snapshot and test compile/);
});

test("verify-change --base selects the reviewed local plan path", () => {
  const preview = parseCli(
    ["verify-change", "--base", "main", "--config-file", "./reviewed.json", "--json"],
    {},
  );
  assert.deepEqual(
    preview.command === "verify-change"
      ? { base: preview.base, configFile: preview.configFile, confirm: preview.confirm }
      : undefined,
    { base: "main", configFile: "./reviewed.json", confirm: false },
  );

  const confirmed = parseCli(
    ["verify-change", "--base=main", "--config", "proof.json", "--confirm"],
    {},
  );
  assert.equal(confirmed.command, "verify-change");
  if (confirmed.command === "verify-change") {
    assert.equal(confirmed.confirm, true);
    assert.equal(confirmed.configFile, "proof.json");
    assert.equal(confirmed.legacy, true);
  }
  assert.throws(
    () => parseCli(["verify-change", "--base", "main", "--config", "a", "--config-file", "b"], {}),
    /only one/u,
  );
});

test("prove --base is the canonical local live Proof entry point", () => {
  const parsed = parseCli(
    ["prove", "--base", "main", "--config-file", "./reviewed.json", "--json"],
    {},
  );
  assert.equal(parsed.command, "prove");
  if (parsed.command === "prove") {
    assert.deepEqual(
      { base: parsed.base, configFile: parsed.configFile, confirm: parsed.confirm },
      { base: "main", configFile: "./reviewed.json", confirm: false },
    );
  }
  assert.throws(
    () => parseCli(["prove", "--base", "main", "--input", "{}"], {}),
    /reviewed config file.*--config-file/u,
  );
});

test("proof analyze routes offline selections through the compatibility verifier", () => {
  const parsed = parseCli(["proof", "analyze", "revision", "abcdef0", "--json"], {});
  assert.equal(parsed.command, "outcome");
  if (parsed.command === "outcome") {
    assert.deepEqual(parsed.intent, {
      kind: "proof-analyze",
      selection: { kind: "source-revision", sourceRevision: { vcs: "git", sha: "abcdef0" } },
    });
  }
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
        "proof.setup.apply",
        "proof.plan.approve",
        "proof.cancel",
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

test("Proof CLI flags preserve exact lifecycle inputs and explicit safety controls", () => {
  const inspected = parseCli(["proof", "inspect", "proof-1", "--history"], {});
  assert.equal(inspected.command, "invoke");
  if (inspected.command === "invoke") {
    assert.equal(inspected.operationId, "proof.inspect");
    assert.deepEqual(inspected.input, { proofId: "proof-1", includeHistory: true });
  }

  const approved = parseCli(
    [
      "proof",
      "approve-plan",
      "proof-1",
      "--confirm",
      "--input",
      '{"expectedVersion":3,"decisionId":"review-1","reason":"Reviewed plan."}',
    ],
    {},
  );
  assert.equal(approved.command, "invoke");
  if (approved.command === "invoke") {
    assert.equal(approved.operationId, "proof.plan.approve");
    assert.deepEqual(approved.input, {
      proofId: "proof-1",
      expectedVersion: 3,
      decisionId: "review-1",
      reason: "Reviewed plan.",
      confirm: true,
    });
  }

  const continued = parseCli(
    [
      "proof",
      "continue",
      "proof-1",
      "--input",
      '{"expectedVersion":4,"action":"request-plan-review","reason":"Needs review."}',
    ],
    {},
  );
  assert.equal(continued.command, "invoke");
  if (continued.command === "invoke") {
    assert.equal(continued.operationId, "proof.continue");
    assert.deepEqual(continued.input, {
      proofId: "proof-1",
      expectedVersion: 4,
      action: "request-plan-review",
      reason: "Needs review.",
    });
  }

  assert.throws(
    () => parseCli(["proof", "approve-plan", "proof-1", "--input", "{}"], {}),
    /requires --confirm/u,
  );
  assert.throws(() => parseCli(["proof", "list", "--history"], {}), /only valid on proof inspect/u);
});

test("prove waits for one server-owned outcome unless explicitly detached", () => {
  const waiting = parseCli(["prove", "proof-1", "--json"], {});
  assert.equal(waiting.command, "invoke");
  if (waiting.command === "invoke") {
    assert.equal(waiting.operationId, "proof.run");
    assert.deepEqual(waiting.input, { proofId: "proof-1", wait: true });
  }

  const detached = parseCli(["proof", "run", "proof-1", "--no-wait", "--json"], {});
  assert.equal(detached.command, "invoke");
  if (detached.command === "invoke") {
    assert.equal(detached.operationId, "proof.run");
    assert.deepEqual(detached.input, { proofId: "proof-1", wait: false });
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

test("Test run accepts explicit current target and revision shortcuts", () => {
  const parsed = parseCli(
    ["test", "run", "checkout", "smoke", "--target", "current", "--revision", "current"],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") return;
  assert.equal(parsed.operationId, "app-map.test.run");
  assert.equal(parsed.currentTarget, true);
  assert.equal(parsed.currentRevision, true);
  assert.deepEqual(parsed.input, { appMapId: "checkout", testId: "smoke" });

  assert.throws(
    () => parseCli(["map", "list", "--target", "current"], {}),
    /only valid on test run/,
  );
  const plan = parseCli(
    ["plan", "run", "grok-android", "grok-android-daily", "--revision", "current"],
    {},
  );
  assert.equal(plan.command, "invoke");
  if (plan.command !== "invoke") return;
  assert.equal(plan.operationId, "job.combine.start");
  assert.equal(plan.currentRevision, true);
  assert.throws(
    () => parseCli(["test", "run", "checkout", "smoke", "--revision", "latest"], {}),
    /accepts only 'current'/,
  );
});

test("--lane maps to laneId and does not require --input-file", () => {
  const testRun = parseCli(["test", "run", "grok-web", "open-home", "--lane", "grok-daily"], {});
  assert.equal(testRun.command, "invoke");
  if (testRun.command !== "invoke") return;
  assert.equal(testRun.operationId, "app-map.test.run");
  assert.deepEqual(testRun.input, {
    appMapId: "grok-web",
    testId: "open-home",
    laneId: "grok-daily",
  });

  const plan = parseCli(["plan", "run", "grok-web", "grok-web-daily", "--lane", "grok-daily"], {});
  assert.equal(plan.command, "invoke");
  if (plan.command !== "invoke") return;
  assert.equal(plan.operationId, "job.combine.start");
  assert.equal(plan.input.laneId, "grok-daily");
  assert.equal(plan.input.executionMode, "pilot");
  const planAll = parseCli(
    ["plan", "run", "grok-web", "grok-web-daily", "--lane", "grok-daily", "--all"],
    {},
  );
  assert.equal(planAll.command, "invoke");
  if (planAll.command !== "invoke") return;
  assert.equal(planAll.input.executionMode, "all");

  const combine = parseCli(
    ["combine", "run", "grok-web", "grok-hourly", "--lane", "grok-lab", "--all"],
    {},
  );
  assert.equal(combine.command, "invoke");
  if (combine.command !== "invoke") return;
  assert.equal(combine.operationId, "job.combine.start");
  assert.equal(combine.input.laneId, "grok-lab");
  assert.equal(combine.input.executionMode, "all");

  const preview = parseCli(
    [
      "device",
      "interact",
      "--preview",
      "--lane",
      "grok-lab",
      "--input",
      '{"kind":"label","label":"Imagine"}',
    ],
    {},
  );
  assert.equal(preview.command, "invoke");
  if (preview.command !== "invoke") return;
  assert.equal(preview.operationId, "target.interact");
  assert.deepEqual(preview.input, {
    kind: "label",
    label: "Imagine",
    preview: true,
    laneId: "grok-lab",
  });

  const snapshot = parseCli(["device", "snapshot", "--lane", "grok-lab", "--full"], {});
  assert.equal(snapshot.command, "invoke");
  if (snapshot.command !== "invoke") return;
  assert.equal(snapshot.operationId, "target.snapshot.capture");
  assert.deepEqual(snapshot.input, {
    laneId: "grok-lab",
    full: true,
    visual: true,
  });

  const recover = parseCli(["device", "recover", "--lane", "grok-daily"], {});
  assert.equal(recover.command, "invoke");
  if (recover.command === "invoke") {
    assert.equal(recover.operationId, "target.recover");
    assert.deepEqual(recover.input, { laneId: "grok-daily" });
  }
  assert.throws(
    () =>
      parseCli(
        ["test", "run", "grok-web", "open-home", "--lane", "grok-daily", "--revision", "current"],
        {},
      ),
    /omit --target and --revision/,
  );
  assert.throws(
    () => parseCli(["map", "list", "--lane", "grok-daily"], {}),
    /only valid on test run/,
  );
});

test("friendly aliases and lifecycle commands construct operation inputs", () => {
  const cases = [
    [["screen", "list", "map-1"], "app-map.get", { appMapId: "map-1" }],
    [
      [
        "screen",
        "alias-observe",
        "map-1",
        "home",
        "--input",
        '{"expectedRevision":4,"target":{"kind":"device","platform":"android","targetId":"pixel-9"},"leaseId":"lease-1"}',
      ],
      "app-map.screen.alias-observe",
      {
        appMapId: "map-1",
        screenId: "home",
        expectedRevision: 4,
        target: { kind: "device", platform: "android", targetId: "pixel-9" },
        leaseId: "lease-1",
      },
    ],
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

test("operation invoke rejects friendly-command-only flags instead of dropping them", () => {
  for (const argv of [
    ["operation", "invoke", "app-map.test.run", "--input", "{}", "--in", "language=de"],
    ["operation", "invoke", "app-map.test.run", "--input", "{}", "--lens", "visual"],
    ["operation", "invoke", "app-map.test.run", "--input", "{}", "--cell", "de"],
    ["operation", "invoke", "app-map.test.run", "--input", "{}", "--all"],
    ["operation", "invoke", "app-map.test.run", "--in", "language=de", "--lens", "visual"],
    ["operation", "invoke", "app-map.test.run", "--input", "{}", "--lane", "grok-daily"],
  ]) {
    assert.throws(() => parseCli(argv, {}), /only supported by friendly commands/);
  }
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

test("device survey --dir maps onto the scroll-survey operation input", () => {
  const parsed = parseCli(
    ["device", "survey", "ipad-1", "--dir", "/tmp/survey", "--input", '{"maxScrolls":6}'],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command === "invoke") {
    assert.equal(parsed.operationId, "target.scroll-survey.capture");
    assert.deepEqual(parsed.input, { serial: "ipad-1", maxScrolls: 6, dir: "/tmp/survey" });
  }

  const invoked = parseCli(
    [
      "operation",
      "invoke",
      "target.scroll-survey.capture",
      "--input",
      '{"serial":"ipad-1"}',
      "--dir",
      "./frames",
    ],
    {},
  );
  assert.equal(invoked.command, "invoke");
  if (invoked.command === "invoke") {
    assert.deepEqual(invoked.input, { serial: "ipad-1", dir: "./frames" });
  }

  assert.throws(
    () => parseCli(["device", "screenshot", "pixel-9", "--dir", "/tmp/survey"], {}),
    /only valid on device survey/,
  );
  assert.throws(
    () => parseCli(["activity", "list", "--dir", "/tmp/survey"], {}),
    /only valid on device survey/,
  );

  const forced = parseCli(["device", "survey", "ipad-1", "--dir", "/tmp/survey", "--force"], {});
  assert.equal(forced.command, "invoke");
  if (forced.command === "invoke") {
    assert.equal(forced.surveyForce, true);
    assert.deepEqual(forced.input, { serial: "ipad-1", dir: "/tmp/survey", force: true });
  }

  assert.throws(
    () => parseCli(["device", "survey", "ipad-1", "--force"], {}),
    /--force requires --dir/,
  );

  const kebab = parseCli(["device", "survey", "ipad-1", "--max-scrolls", "6"], {});
  assert.equal(kebab.command, "invoke");
  if (kebab.command === "invoke") {
    assert.deepEqual(kebab.input, { serial: "ipad-1", maxScrolls: 6 });
  }
  assert.throws(
    () => parseCli(["device", "survey", "ipad-1", "--max-scrolls", "0"], {}),
    /integer between 1 and 12/,
  );
  assert.throws(
    () => parseCli(["device", "screenshot", "pixel-9", "--max-scrolls", "6"], {}),
    /only valid on device survey/,
  );

  const unrestored = parseCli(
    ["device", "survey", "ipad-1", "--max-scrolls", "3", "--no-restore"],
    {},
  );
  assert.equal(unrestored.command, "invoke");
  if (unrestored.command === "invoke") {
    assert.deepEqual(unrestored.input, { serial: "ipad-1", maxScrolls: 3, restore: false });
  }
  assert.throws(
    () => parseCli(["device", "screenshot", "pixel-9", "--no-restore"], {}),
    /only valid on device survey/,
  );
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
  const jsonSnapshot = parseCli(["device", "snapshot", "pixel-9", "--json"], {});
  assert.equal(jsonSnapshot.command, "invoke");
  if (jsonSnapshot.command === "invoke") {
    assert.equal(jsonSnapshot.input.full, true);
    assert.equal(jsonSnapshot.input.visual, true);
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
  assert.throws(() => parseCli(["activity", "list", "--full"], {}), /only valid/);
  assert.throws(() => parseCli(["variable", "list", "grok-android", "--full"], {}), /only valid/);
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

test("test run freezes --commit/--pr/--branch into sourceRevision", () => {
  const parsed = parseCli(
    [
      "test",
      "run",
      "checkout",
      "smoke",
      "--commit=abc1234def5678",
      "--pr",
      "42",
      "--branch",
      "feature/checkout",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"D"}}',
    ],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command === "invoke") {
    assert.deepEqual(parsed.input.sourceRevision, {
      vcs: "git",
      sha: "abc1234def5678",
      prNumber: 42,
      branch: "feature/checkout",
    });
  }
});

test("sourceRevision auto-detects CI environment with flag precedence", () => {
  const fromEnv = parseCli(
    [
      "test",
      "run",
      "checkout",
      "smoke",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"D"}}',
    ],
    { GITHUB_SHA: "1234567890abcdef", GITHUB_REF_NAME: "agent-fix" },
  );
  if (fromEnv.command === "invoke") {
    assert.deepEqual(fromEnv.input.sourceRevision, {
      vcs: "git",
      sha: "1234567890abcdef",
      branch: "agent-fix",
    });
  }

  // Flags win over ambient environment.
  const flagWins = parseCli(
    [
      "test",
      "run",
      "checkout",
      "smoke",
      "--commit=aaaaaaaa",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"D"}}',
    ],
    { GITHUB_SHA: "1234567890abcdef" },
  );
  if (flagWins.command === "invoke") {
    assert.deepEqual(flagWins.input.sourceRevision, { vcs: "git", sha: "aaaaaaaa" });
  }

  // No flags and no CI environment claims no binding.
  const absent = parseCli(
    [
      "test",
      "run",
      "checkout",
      "smoke",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"D"}}',
    ],
    {},
  );
  if (absent.command === "invoke") {
    assert.equal(absent.input.sourceRevision, undefined);
  }
});

test("generic CI variables also feed sourceRevision auto-detection", () => {
  const parsed = parseCli(
    [
      "test",
      "run",
      "checkout",
      "smoke",
      "--input",
      '{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"D"}}',
    ],
    {
      CI_COMMIT_SHA: "bbbbbbb22222",
      CI_COMMIT_REF_NAME: "main",
      CI_PR_NUMBER: "17",
    },
  );
  if (parsed.command === "invoke") {
    assert.deepEqual(parsed.input.sourceRevision, {
      vcs: "git",
      sha: "bbbbbbb22222",
      prNumber: 17,
      branch: "main",
    });
  }
});

test("sourceRevision flags are rejected off test run and on malformed values", () => {
  assert.throws(
    () => parseCli(["device", "list", "--commit=abc1234"], {}),
    /only valid on test run/u,
  );
  assert.throws(
    () => parseCli(["test", "run", "a", "b", "--commit", "ZZZZ"], {}),
    /lowercase git SHA/u,
  );
  assert.throws(() => parseCli(["test", "run", "a", "b", "--pr", "zero"], {}), /positive integer/u);
});

test("outcome commands resolve ordinary intent without raw JSON mechanics", () => {
  assert.deepEqual(parseCli(["connect"], {}), {
    config: parseCli(["help"], {}).config,
    command: "outcome",
    intent: { kind: "connect-target" },
  });

  const record = parseCli(["record", "Checkout smoke", "--confirm"], {});
  assert.equal(record.command, "outcome");
  if (record.command === "outcome") {
    assert.deepEqual(record.intent, {
      kind: "record-test",
      title: "Checkout smoke",
      confirmControl: true,
    });
  }

  const run = parseCli(["run", "checkout-smoke", "--map", "checkout"], {});
  assert.equal(run.command, "outcome");
  if (run.command === "outcome") {
    assert.deepEqual(run.intent, {
      kind: "run-test",
      appMapId: "checkout",
      testId: "checkout-smoke",
    });
  }

  const repeat = parseCli(
    ["repeat", "locale-smoke", "--in", "language=ja,pt", "--lens", "visual"],
    {},
  );
  assert.equal(repeat.command, "outcome");
  if (repeat.command === "outcome") {
    assert.deepEqual(repeat.intent, {
      kind: "repeat-test",
      testId: "locale-smoke",
      repeat: { dimensions: [{ id: "language", values: ["ja", "pt"] }] },
      evidence: "visual",
    });
  }

  const multiRepeat = parseCli(
    [
      "repeat",
      "release-smoke",
      "--each",
      "language=supported",
      "--each",
      "theme=light,dark",
      "--strategy",
      "pairwise",
      "--pilot",
      "language=pt-BR,theme=dark",
      "--resume",
      "untouched",
    ],
    {},
  );
  assert.equal(multiRepeat.command, "outcome");
  if (multiRepeat.command === "outcome") {
    assert.deepEqual(multiRepeat.intent, {
      kind: "repeat-test",
      testId: "release-smoke",
      repeat: {
        dimensions: [
          { id: "language", values: "supported" },
          { id: "theme", values: ["light", "dark"] },
        ],
        strategy: "pairwise",
        pilot: { mode: "specified", case: { language: "pt-BR", theme: "dark" } },
        resume: "untouched",
      },
    });
  }

  const continuation = parseCli(["continue-repeat", "repeat-workflow", "2", "--confirm"], {});
  assert.equal(continuation.command, "outcome");
  if (continuation.command === "outcome") {
    assert.deepEqual(continuation.intent, {
      kind: "continue-repeat",
      workflowId: "repeat-workflow",
      expectedVersion: 2,
      confirmRemaining: true,
    });
  }

  assert.throws(() => parseCli(["record", "Smoke"], {}), /requires --confirm/u);
  assert.throws(
    () => parseCli(["continue-repeat", "repeat-workflow", "2"], {}),
    /requires --confirm/u,
  );
  assert.throws(
    () => parseCli(["continue-repeat", "repeat-workflow", "version-2", "--confirm"], {}),
    /positive integer/u,
  );
  assert.throws(() => parseCli(["run", "smoke", "--input", "{}"], {}), /do not accept --input/u);
});

test("export accepts --out and --output as the review directory", () => {
  for (const flag of ["--out", "--output"] as const) {
    const parsed = parseCli(["export", "run-42", flag, "./review"], {});
    assert.equal(parsed.command, "outcome");
    if (parsed.command === "outcome") {
      assert.deepEqual(parsed.intent, {
        kind: "export-evidence",
        runId: "run-42",
        outputDir: "./review",
      });
    }
  }
});

test("browser capture-plan uses shared connection and JSON input parsing", () => {
  const parsed = parseCli(
    [
      "browser",
      "capture-plan",
      "plans",
      "capture",
      "--input",
      '{"name":"Plans","expectedRevision":3}',
      "--json",
    ],
    {},
  );
  assert.equal(parsed.command, "browser-capture-plan");
  if (parsed.command !== "browser-capture-plan") throw new Error("Wrong command");
  assert.equal(parsed.input.appMapId, "plans");
  assert.equal(parsed.input.id, "capture");
  assert.equal(parsed.config.output, "json");
});

test("the advertised walkthrough export accepts --out", () => {
  const parsed = parseCli(
    ["--out", "/tmp/relay-review", "run", "walkthrough-pack", "get", "run-1"],
    {},
  );
  assert.equal(parsed.command, "invoke");
  if (parsed.command !== "invoke") return;
  assert.equal(parsed.operationId, "run.walkthrough-pack.get");
  assert.equal(parsed.outDir, "/tmp/relay-review");
});

test("--out is accepted on run verbs and rejected elsewhere", () => {
  const run = parseCli(
    ["test", "run", "checkout", "smoke", "--out", "/tmp/relay-out", "--json"],
    {},
  );
  assert.equal(run.command, "invoke");
  if (run.command !== "invoke") throw new Error("expected invoke");
  assert.equal(run.outDir, "/tmp/relay-out");
  const watch = parseCli(["job", "watch", "job-1", "--out", "/tmp/relay-out"], {});
  assert.equal(watch.command, "invoke");
  if (watch.command !== "invoke") throw new Error("expected invoke");
  assert.equal(watch.outDir, "/tmp/relay-out");
  assert.throws(
    () => parseCli(["map", "list", "--out", "/tmp/relay-out"], {}),
    /only valid on run verbs/,
  );
  assert.throws(
    () => parseCli(["--help", "--out", "/tmp/relay-out"], {}),
    /only valid on run verbs/,
  );
});
