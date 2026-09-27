import assert from "node:assert/strict";
import test from "node:test";
import {
  operationDefinitions,
  REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
} from "@relay/protocol";
import {
  cliOperationDescriptors,
  cliResourceDescriptors,
  mappedCommandDescriptors,
  resolveCommand,
  resolveResourceCommand,
} from "./commands.js";
import { renderHelp } from "./help.js";

test("every registry operation is mapped or excluded exactly once", () => {
  const coverage = new Map<string, number>();
  for (const descriptor of cliOperationDescriptors) {
    coverage.set(descriptor.operationId, (coverage.get(descriptor.operationId) ?? 0) + 1);
    if ("exclusion" in descriptor) assert.ok(descriptor.reason.trim());
    else assert.ok(descriptor.paths.length > 0);
  }

  assert.deepEqual([...coverage.keys()].sort(), operationDefinitions.map(({ id }) => id).sort());
  assert.deepEqual(
    [...coverage.entries()].filter(([, count]) => count !== 1),
    [],
  );
});

test("friendly command signatures are unique", () => {
  const paths = mappedCommandDescriptors.flatMap((descriptor) =>
    descriptor.paths.map(
      (candidate) => `${candidate.command} ${(candidate.arguments ?? []).join(" ")}`,
    ),
  );
  paths.push(
    ...cliResourceDescriptors.map(
      (descriptor) => `${descriptor.path.command} ${(descriptor.path.arguments ?? []).join(" ")}`,
    ),
  );
  assert.equal(new Set(paths).size, paths.length);
});

test("Proof lifecycle commands resolve to canonical operations", () => {
  assert.deepEqual(resolveCommand(["prove"], { baseRef: "origin/main" }), {
    operationId: "proof.prepare",
    commandPath: "prove",
    input: { baseRef: "origin/main" },
  });
  assert.deepEqual(resolveCommand(["proof", "prepare"]), {
    operationId: "proof.prepare",
    commandPath: "proof prepare",
    input: {},
  });
  assert.deepEqual(resolveCommand(["proof", "start"]), {
    operationId: "proof.start",
    commandPath: "proof start",
    input: {},
  });
  assert.deepEqual(resolveCommand(["proof", "list"], { state: "ready", limit: 10 }), {
    operationId: "proof.list",
    commandPath: "proof list",
    input: { state: "ready", limit: 10 },
  });
  assert.deepEqual(resolveCommand(["proof", "inspect", "proof-1"]), {
    operationId: "proof.inspect",
    commandPath: "proof inspect",
    input: { proofId: "proof-1" },
  });
  assert.deepEqual(resolveCommand(["proof", "approve-plan", "proof-1"], { expectedVersion: 3 }), {
    operationId: "proof.plan.approve",
    commandPath: "proof approve-plan",
    input: { proofId: "proof-1", expectedVersion: 3 },
  });
  assert.deepEqual(resolveCommand(["prove", "proof-1"], { wait: true }), {
    operationId: "proof.run",
    commandPath: "prove",
    input: { proofId: "proof-1", wait: true },
  });
  assert.deepEqual(resolveCommand(["proof", "run", "proof-1"], { expectedVersion: 3 }), {
    operationId: "proof.run",
    commandPath: "proof run",
    input: { proofId: "proof-1", expectedVersion: 3 },
  });
  assert.deepEqual(resolveCommand(["proof", "continue", "proof-1"], { expectedVersion: 3 }), {
    operationId: "proof.continue",
    commandPath: "proof continue",
    input: { proofId: "proof-1", expectedVersion: 3 },
  });
  assert.deepEqual(resolveCommand(["proof", "cancel", "proof-1"], { expectedVersion: 3 }), {
    operationId: "proof.cancel",
    commandPath: "proof cancel",
    input: { proofId: "proof-1", expectedVersion: 3 },
  });
  assert.deepEqual(
    resolveCommand(["proof", "retry-merge-check", "proof-1", "publication-1"], {
      expectedProofVersion: 3,
    }),
    {
      operationId: "proof.publication.retry",
      commandPath: "proof retry-merge-check",
      input: {
        proofId: "proof-1",
        publicationId: "publication-1",
        expectedProofVersion: 3,
      },
    },
  );
  assert.deepEqual(resolveCommand(["proof", "rerun-affected", "proof-1"], { expectedVersion: 3 }), {
    operationId: "proof.rerun-affected",
    commandPath: "proof rerun-affected",
    input: { proofId: "proof-1", expectedVersion: 3 },
  });
});

test("compiled Recipe storage has no public CLI namespace", () => {
  assert.deepEqual(
    cliOperationDescriptors.filter(({ operationId }) => operationId.startsWith("recipe.")),
    [],
  );
  assert.throws(() => resolveCommand(["recipe", "list"]), /Unknown command/);
});

test("every friendly path resolves with its declared arguments", () => {
  for (const descriptor of mappedCommandDescriptors) {
    for (const candidate of descriptor.paths) {
      const arguments_ = (candidate.arguments ?? []).map((key) => `${key}-value`);
      const resolved = resolveCommand([...candidate.command.split(" "), ...arguments_]);
      assert.equal(resolved.operationId, descriptor.operationId, candidate.command);
      assert.equal(resolved.commandPath, candidate.command);
    }
  }
});

test("device health exposes the bounded read-only supervisor projection", () => {
  const resolved = resolveCommand(["device", "health", "ipad-1"]);
  assert.equal(resolved.operationId, "target.health.get");
  assert.deepEqual(resolved.input, { serial: "ipad-1" });
});

test("browser authentication commands expose only exact reviewed fixture inputs", () => {
  assert.deepEqual(
    resolveCommand(["browser", "auth", "save", "browser-1"], {
      name: "Reviewed staging account",
    }),
    {
      operationId: "target.browser-auth.save",
      commandPath: "browser auth save",
      input: { targetId: "browser-1", name: "Reviewed staging account" },
    },
  );
  assert.deepEqual(resolveCommand(["browser", "auth", "list", "browser-1"]), {
    operationId: "target.browser-auth.list",
    commandPath: "browser auth list",
    input: { targetId: "browser-1" },
  });
  assert.deepEqual(
    resolveCommand([
      "browser",
      "auth",
      "revoke",
      "browser-1",
      "authfx:8bb4854a-182c-4df2-825f-bbc3c2a2dfac:2",
    ]),
    {
      operationId: "target.browser-auth.revoke",
      commandPath: "browser auth revoke",
      input: {
        targetId: "browser-1",
        reference: "authfx:8bb4854a-182c-4df2-825f-bbc3c2a2dfac:2",
      },
    },
  );
  assert.deepEqual(
    resolveCommand([
      "browser",
      "auth",
      "probe",
      "browser-1",
      "authfx:8bb4854a-182c-4df2-825f-bbc3c2a2dfac:2",
    ]),
    {
      operationId: "target.browser-auth.probe",
      commandPath: "browser auth probe",
      input: {
        targetId: "browser-1",
        reference: "authfx:8bb4854a-182c-4df2-825f-bbc3c2a2dfac:2",
      },
    },
  );
  assert.deepEqual(resolveCommand(["browser", "auth", "health", "grok-com"]), {
    operationId: "target.browser-auth.health",
    commandPath: "browser auth health",
    input: { targetId: "grok-com" },
  });
});

test("all plan-035 authoring operations have friendly command paths", () => {
  const authoringOperationIds = [
    "authoring.session.list",
    "authoring.session.get",
    "authoring.session.create",
    "authoring.session.observe",
    "authoring.session.capture",
    "authoring.session.start",
    "authoring.session.interact",
    "authoring.session.stop",
    "authoring.take.optimization.get",
    "authoring.take.trim",
    "authoring.take.reorder",
    "authoring.take.replace",
    "authoring.take.replay",
    "authoring.session.commit",
    "authoring.session.discard",
    "authoring.session.cancel",
    "authoring.session.cleanup",
  ] as const;
  const mappedOperationIds = new Set(
    mappedCommandDescriptors.map(({ operationId }) => operationId),
  );

  assert.deepEqual(
    authoringOperationIds.filter((operationId) => !mappedOperationIds.has(operationId)),
    [],
  );
});

test("path arguments merge into full operation input without hiding revision metadata", () => {
  assert.deepEqual(
    resolveCommand(["screen", "update", "checkout", "home"], {
      expectedRevision: 7,
      patch: { title: "Home" },
    }),
    {
      operationId: "app-map.screen.update",
      commandPath: "screen update",
      input: {
        appMapId: "checkout",
        screenId: "home",
        expectedRevision: 7,
        patch: { title: "Home" },
      },
    },
  );
});

test("screen and connection commands use granular App Map operations", () => {
  assert.deepEqual(resolveCommand(["map", "duplicate", "map-1", "map-2"]), {
    operationId: "app-map.duplicate",
    commandPath: "map duplicate",
    input: { sourceAppMapId: "map-1", appMapId: "map-2" },
  });
  assert.equal(resolveCommand(["screen", "list", "map-1"]).operationId, "app-map.get");
  assert.equal(
    resolveCommand(["connection", "update", "map-1", "connection-1"], {
      expectedRevision: 3,
      patch: { label: "Continue" },
    }).operationId,
    "app-map.connection.update",
  );
  assert.deepEqual(
    resolveCommand(["screen", "consolidate", "map-1", "settings"], {
      expectedRevision: 8,
      sourceScreenIds: ["settings-middle", "settings-bottom"],
      dryRun: true,
    }),
    {
      operationId: "app-map.screen.consolidate",
      commandPath: "screen consolidate",
      input: {
        appMapId: "map-1",
        targetScreenId: "settings",
        expectedRevision: 8,
        sourceScreenIds: ["settings-middle", "settings-bottom"],
        dryRun: true,
      },
    },
  );
});

test("variable help says appLocale stays when the Test can name a screen", () => {
  const help = renderHelp("variable");
  assert.match(
    help,
    /appLocale Variables stay when the compiled Test has an expect-screen; they relaunch if stay cannot be proved/u,
  );
  assert.match(help, /apply\.relaunch: true still relaunches/u);
  assert.match(help, /variable infer <appMapId> <variableId>/u);
  assert.match(help, /Infer remaining Variable rows from 1-8 taught examples/u);
  assert.match(help, /taughtRows/u);
});

test("device and Combine help name the Test-run apply path and evidence folder", () => {
  const device = renderHelp("device");
  assert.match(device, /relay variable save/u);
  assert.match(device, /relay test run <map> <test> --in language=<tag>/u);

  const combine = renderHelp("combine");
  assert.match(combine, /portable review folder/u);
  assert.match(combine, /Test checklist/u);
  assert.match(combine, /--lane grok-lab/u);
});

test("authoring vocabulary exposes Variables, Tests, and saved Combines", () => {
  for (const command of ["variable list", "test list", "combine list"]) {
    const resolved = resolveCommand([...command.split(" "), "grok-android"]);
    assert.equal(resolved.operationId, "app-map.get", command);
    assert.deepEqual(resolved.input, { appMapId: "grok-android" }, command);
  }
  assert.deepEqual(resolveCommand(["combine", "preflight", "grok-android", "locale-x-tour"]), {
    operationId: "app-map.combine.preflight",
    commandPath: "combine preflight",
    input: { appMapId: "grok-android", combineId: "locale-x-tour" },
  });
});

test("device locale maps to a verified per-app locale set", () => {
  assert.deepEqual(resolveCommand(["device", "locale", "pixel-1", "ai.x.grok", "he"]), {
    operationId: "target.app.locale.set",
    commandPath: "device locale",
    input: { serial: "pixel-1", package: "ai.x.grok", locale: "he" },
  });
  const help = renderHelp("device");
  assert.match(help, /device locale <serial> <package> <locale>/u);
  assert.match(help, /verify it took/u);
  assert.match(help, /fails when the app still reports another language/u);
});

test("connect get is a CLI projection of app-map.get", () => {
  assert.deepEqual(resolveCommand(["connect", "get", "checkout", "continue"]), {
    operationId: "app-map.get",
    commandPath: "connect get",
    input: { appMapId: "checkout", connectionId: "continue" },
  });
  const help = renderHelp("connect");
  assert.match(help, /connect get <appMapId> <connectionId>/u);
  assert.match(help, /tap targets, reveal/u);
  assert.match(help, /CLI projection of app-map.get/u);
});

test("Test help exposes graph creation, semantic edits, and the required run target", () => {
  const help = renderHelp("test");
  assert.match(help, /intentSchemaVersion 1/);
  assert.match(help, /test\.patch, step\.add/);
  assert.match(help, /expectedRevision \(number, required\)/);
  assert.match(help, /Required unless --lane is set/);
  assert.match(help, /forceRecaptureScreenIds/);
  assert.match(help, /"kind":"browser","platform":"browser"/);
  assert.match(help, /freezes an exact revision and target/);
  assert.match(help, /eventId/);
  assert.match(help, /relay test save checkout smoke/);
  assert.match(help, /relay test run checkout smoke/);
});

test("session replay is an alias of take replay", () => {
  assert.deepEqual(resolveCommand(["session", "replay", "authoring-1"]), {
    operationId: "authoring.take.replay",
    commandPath: "session replay",
    input: { sessionId: "authoring-1" },
  });
});

test("device survey exposes the canonical scroll-survey operation and bounded input help", () => {
  assert.deepEqual(resolveCommand(["device", "survey", "ipad-1"], { maxScrolls: 6 }), {
    operationId: "target.scroll-survey.capture",
    commandPath: "device survey",
    input: { serial: "ipad-1", maxScrolls: 6 },
  });
  const descriptor = mappedCommandDescriptors.find(
    (candidate) => candidate.operationId === "target.scroll-survey.capture",
  );
  assert.ok(descriptor && !("exclusion" in descriptor));
  const help = descriptor.paths.find((candidate) => candidate.command === "device survey");
  assert.equal(help?.inputHelp?.[0]?.name, "maxScrolls");
  assert.match(help?.inputHelp?.[0]?.type ?? "", /1-12/u);
  assert.equal(help?.inputHelp?.[1]?.name, "dir");
  assert.match(help?.inputHelp?.[1]?.description ?? "", /review tree/u);
  assert.equal(help?.inputHelp?.[2]?.name, "force");
  assert.match(help?.note ?? "", /exclusive lease/u);
  assert.match(help?.note ?? "", /--dir/u);
  assert.match(help?.note ?? "", /megabytes/u);
  assert.ok(help?.examples?.some((example) => example.includes("--dir")));
});

test("iPad observation and recovery help exposes the proof-first lifecycle", () => {
  const snapshot = mappedCommandDescriptors.find(
    (descriptor) => descriptor.operationId === "target.snapshot.capture",
  );
  const observe = snapshot?.paths.find((candidate) => candidate.command === "device observe");
  const deviceSnapshot = snapshot?.paths.find(
    (candidate) => candidate.command === "device snapshot",
  );
  const recover = mappedCommandDescriptors
    .find((descriptor) => descriptor.operationId === "target.recover")
    ?.paths.find((candidate) => candidate.command === "device recover");

  for (const help of [observe, deviceSnapshot]) {
    assert.match(help?.summary ?? "", /digest/i);
    assert.match(help?.summary ?? "", /--full prints the raw tree/);
    assert.match(help?.summary ?? "", /--file writes a review tree/);
    assert.match(help?.note ?? "", /digest/i);
    assert.match(help?.note ?? "", /--full/);
    assert.match(help?.note ?? "", /--file/);
    assert.match(help?.note ?? "", /Read-only/i);
    assert.match(help?.note ?? "", /pixels/i);
    assert.ok(
      help?.inputHelp?.some(
        (field) => field.name === "full" && /set by --full/.test(field.description),
      ),
    );
    assert.ok(
      help?.inputHelp?.every((field) => field.name !== "full" || !/--file/.test(field.description)),
    );
  }
  assert.match(recover?.summary ?? "", /only when necessary/i);
  assert.match(recover?.note ?? "", /first proves/i);
  assert.match(recover?.note ?? "", /never resets the app/i);
  assert.doesNotMatch(recover?.note ?? "", /restart the XCTest runner/i);
});

test("screen capture-scroll targets one durable Screen Variant", () => {
  assert.deepEqual(
    resolveCommand(["screen", "capture-scroll", "map-1", "settings", "settings-ja"], {
      expectedRevision: 12,
      target: { kind: "device", platform: "ios", targetId: "ipad-1" },
      leaseId: "lease-1",
      maxScrolls: 6,
    }),
    {
      operationId: "app-map.scroll-surface.capture",
      commandPath: "screen capture-scroll",
      input: {
        appMapId: "map-1",
        screenId: "settings",
        variantId: "settings-ja",
        expectedRevision: 12,
        target: { kind: "device", platform: "ios", targetId: "ipad-1" },
        leaseId: "lease-1",
        maxScrolls: 6,
      },
    },
  );
  const descriptor = mappedCommandDescriptors.find(
    (candidate) => candidate.operationId === "app-map.scroll-surface.capture",
  );
  const help = descriptor?.paths.find((candidate) => candidate.command === "screen capture-scroll");
  assert.match(help?.note ?? "", /Explicitly opts/u);
  assert.match(help?.note ?? "", /should remain viewport-only/u);
});

test("screen regenerate-scroll rebuilds derived views without device input", () => {
  assert.deepEqual(
    resolveCommand(
      ["screen", "regenerate-scroll", "map-1", "settings", "settings-ja", "capture-1"],
      { expectedRevision: 13 },
    ),
    {
      operationId: "app-map.scroll-surface.regenerate",
      commandPath: "screen regenerate-scroll",
      input: {
        appMapId: "map-1",
        screenId: "settings",
        variantId: "settings-ja",
        captureId: "capture-1",
        expectedRevision: 13,
      },
    },
  );
});

test("screen origin review commands are evidence-only and do not request a lease", () => {
  const scope = ["map-1", "settings", "settings-ja", "capture-1"];
  assert.deepEqual(resolveCommand(["screen", "origin", "inspect", ...scope]), {
    operationId: "app-map.scroll-surface.origin.inspect",
    commandPath: "screen origin inspect",
    input: {
      appMapId: "map-1",
      screenId: "settings",
      variantId: "settings-ja",
      captureId: "capture-1",
    },
  });
  const decision = {
    expectedRevision: 13,
    reason: "Reviewed immutable first viewport.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVIEW_ASSERTION,
  };
  assert.deepEqual(resolveCommand(["screen", "origin", "review", ...scope], decision), {
    operationId: "app-map.scroll-surface.origin.review",
    commandPath: "screen origin review",
    input: {
      appMapId: "map-1",
      screenId: "settings",
      variantId: "settings-ja",
      captureId: "capture-1",
      ...decision,
    },
  });
  const revocation = {
    expectedRevision: 13,
    reason: "Revoked immutable first viewport.",
    assertion: REVIEWED_DOCUMENT_ORIGIN_REVOKE_ASSERTION,
  };
  assert.deepEqual(
    resolveCommand(["screen", "origin", "revoke", ...scope, "reviewed-origin-1"], revocation),
    {
      operationId: "app-map.scroll-surface.origin.revoke",
      commandPath: "screen origin revoke",
      input: {
        appMapId: "map-1",
        screenId: "settings",
        variantId: "settings-ja",
        captureId: "capture-1",
        projectionId: "reviewed-origin-1",
        ...revocation,
      },
    },
  );
});

test("persisted run replay has one friendly watched command", () => {
  assert.deepEqual(resolveCommand(["run", "replay", "run-1"]), {
    operationId: "run.replay",
    commandPath: "run replay",
    input: { runId: "run-1" },
    behavior: "job-start-watch",
  });
});

test("run visual review round-trips approve-new-baseline", () => {
  assert.deepEqual(
    resolveCommand(["run", "visual", "review", "run-7"], {
      comparisonId: "cmp-1",
      action: "approve-new-baseline",
    }),
    {
      operationId: "run.visual.review",
      commandPath: "run visual review",
      input: { runId: "run-7", comparisonId: "cmp-1", action: "approve-new-baseline" },
    },
  );
  const help = renderHelp("run");
  assert.match(help, /approve-new-baseline/u);
  assert.match(help, /human:local-cli/u);
  const visual = mappedCommandDescriptors.find((item) => item.operationId === "run.visual.review");
  const actionHelp = visual?.paths[0]?.inputHelp?.find((field) => field.name === "action");
  assert.match(actionHelp?.type ?? "", /approve-new-baseline/u);
  assert.doesNotMatch(actionHelp?.type ?? "", /"approve" \| "reject"/u);
});

test("run capture review records Looks correct without a baseline action", () => {
  assert.deepEqual(
    resolveCommand(["run", "capture", "review", "run-8"], {
      captureId: "frames/001.png::aaa",
      action: "accept",
      imageSha256: "aaa",
    }),
    {
      operationId: "run.capture.review",
      commandPath: "run capture review",
      input: {
        runId: "run-8",
        captureId: "frames/001.png::aaa",
        action: "accept",
        imageSha256: "aaa",
      },
    },
  );
});

test("plan capture review lists and bulk-accepts exact Plan screenshots", () => {
  assert.deepEqual(resolveCommand(["plan", "capture", "review", "plan-1"]), {
    operationId: "job.combine.capture.review",
    commandPath: "plan capture review",
    input: { batchId: "plan-1" },
  });
  assert.deepEqual(
    resolveCommand(["plan", "capture", "review", "plan-1"], {
      pending: true,
      screen: "Settings",
      device: "iPad",
      account: "Member",
    }),
    {
      operationId: "job.combine.capture.review",
      commandPath: "plan capture review",
      input: {
        batchId: "plan-1",
        pending: true,
        screen: "Settings",
        device: "iPad",
        account: "Member",
      },
    },
  );
  assert.deepEqual(
    resolveCommand(["plan", "capture", "review", "apply", "plan-1"], {
      action: "accept",
      items: [{ runId: "run-8", captureId: "frames/001.png::aaa", imageSha256: "aaa" }],
      pending: true,
      screen: "Settings",
    }),
    {
      operationId: "job.combine.capture.review.apply",
      commandPath: "plan capture review apply",
      input: {
        batchId: "plan-1",
        action: "accept",
        items: [{ runId: "run-8", captureId: "frames/001.png::aaa", imageSha256: "aaa" }],
        pending: true,
        screen: "Settings",
      },
    },
  );
});

test("one failed check is inspectable and selectively retryable", () => {
  assert.deepEqual(resolveCommand(["repair", "retry", "run-1", "usage"]), {
    operationId: "run.repair.retry",
    commandPath: "repair retry",
    input: { runId: "run-1", checkId: "usage" },
    behavior: "job-start-watch",
  });
  assert.deepEqual(resolveCommand(["repair", "get", "run-1", "usage"]), {
    operationId: "run.repair.get",
    commandPath: "repair get",
    input: { runId: "run-1", checkId: "usage" },
  });
});

test("unknown session verbs point at family help instead of four arbitrary commands", () => {
  assert.throws(
    () => resolveCommand(["session", "reploy", "authoring-1"]),
    (error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      return (
        /relay session --help/.test(message) &&
        /session begin/.test(message) &&
        /session tap/.test(message) &&
        /session replay/.test(message) &&
        /session commit/.test(message)
      );
    },
  );
});

test("authoring interaction aliases construct explicit session inputs", () => {
  assert.deepEqual(resolveCommand(["session", "back", "session-1"]), {
    operationId: "authoring.session.interact",
    commandPath: "session back",
    input: { sessionId: "session-1", interaction: { kind: "key", key: "back" } },
  });
  assert.deepEqual(
    resolveCommand(["session", "tap", "session-1"], {
      interaction: { kind: "swipe", target: { x: 0.25, y: 0.75 } },
    }).input,
    { sessionId: "session-1", interaction: { kind: "tap", target: { x: 0.25, y: 0.75 } } },
  );
  assert.deepEqual(
    resolveCommand(["proposal", "batch", "proposal-1"], {
      interaction: {
        steps: [
          { kind: "tap", target: { identifier: "send" } },
          { kind: "sleep", ms: 1_000 },
          { kind: "tap", target: { identifier: "stop" } },
        ],
        label: "Interrupt response",
      },
    }).input,
    {
      sessionId: "proposal-1",
      interaction: {
        kind: "steps",
        steps: [
          { kind: "tap", target: { identifier: "send" } },
          { kind: "sleep", ms: 1_000 },
          { kind: "tap", target: { identifier: "stop" } },
        ],
        label: "Interrupt response",
      },
    },
  );
});

test("Combine analysis has one direct public command", () => {
  assert.equal(
    resolveCommand(["combine", "analyze", "batch-1"]).operationId,
    "job.combine.analysis",
  );
  const optionStart = mappedCommandDescriptors.find(
    (descriptor) => descriptor.operationId === "job.combine.start",
  );
  assert.ok(optionStart && !("exclusion" in optionStart));
  assert.match(optionStart.paths[0]?.examples?.[0] ?? "", /combine run|variableIds|combineId/);
  assert.match(optionStart.paths[0]?.examples?.[0] ?? "", /platform/);
  assert.match(optionStart.paths[0]?.note ?? "", /--cell|--all|one cell/u);
  assert.match(optionStart.paths[0]?.note ?? "", /default serial|fills missing/u);
  assert.match(optionStart.paths[0]?.note ?? "", /localAdmission/u);
  const combineRun = optionStart.paths.find((path) => path.command === "combine run");
  assert.ok(combineRun?.inputHelp?.some((item) => item.name === "cellTargetBindings"));
  assert.ok(combineRun?.inputHelp?.some((item) => item.name === "localAdmission"));
});

test("App Map vocabulary resolves to canonical granular operations", () => {
  const cases = [
    [["map", "list"], "app-map.list", {}],
    [["map", "get", "checkout"], "app-map.get", { appMapId: "checkout" }],
    [["map", "update", "checkout"], "app-map.update", { appMapId: "checkout" }],
    [
      ["connect", "update", "checkout", "continue"],
      "app-map.connection.update",
      { appMapId: "checkout", connectionId: "continue" },
    ],
    [
      ["connect", "run", "checkout", "continue"],
      "app-map.connection.run",
      { appMapId: "checkout", connectionId: "continue" },
    ],
    [
      ["flow", "run", "checkout", "main"],
      "app-map.flow.run",
      { appMapId: "checkout", flowId: "main" },
    ],
    [
      ["routine", "run", "login", "pixel-9"],
      "action.run",
      { actionId: "login", serial: "pixel-9" },
    ],
    [["device", "screenshot", "pixel-9"], "target.screenshot.capture", { serial: "pixel-9" }],
    [["target", "devices"], "target.devices.list", {}],
    [["device", "survey", "pixel-9"], "target.scroll-survey.capture", { serial: "pixel-9" }],
    [
      ["connect", "get", "checkout", "continue"],
      "app-map.get",
      { appMapId: "checkout", connectionId: "continue" },
    ],
    [
      ["device", "locale", "pixel-9", "com.example.app", "de"],
      "target.app.locale.set",
      { serial: "pixel-9", package: "com.example.app", locale: "de" },
    ],

    [
      ["device", "launch", "ipad-1", "Settings"],
      "target.app.launch",
      { serial: "ipad-1", app: "Settings" },
    ],
    [["device", "recover", "ipad-1"], "target.recover", { serial: "ipad-1" }],
    [["proposal", "record", "proposal-1"], "authoring.session.start", { sessionId: "proposal-1" }],
    [
      ["proposal", "optimize", "proposal-1"],
      "authoring.take.optimization.get",
      { sessionId: "proposal-1" },
    ],
    [["proposal", "accept", "proposal-1"], "authoring.session.commit", { sessionId: "proposal-1" }],
    [["run", "watch", "job-1"], "job.get", { jobId: "job-1" }],
    [["activity", "follow"], "event.stream", {}],
    [
      ["test", "run", "grok-ios", "settings-tour"],
      "app-map.test.run",
      { appMapId: "grok-ios", testId: "settings-tour" },
    ],
    [
      ["test", "edit", "grok-ios", "checkout"],
      "app-map.test.edit",
      { appMapId: "grok-ios", testId: "checkout" },
    ],
    [
      ["test", "undo", "grok-ios", "checkout"],
      "app-map.test.undo",
      { appMapId: "grok-ios", testId: "checkout" },
    ],
    [
      ["test", "redo", "grok-ios", "checkout"],
      "app-map.test.redo",
      { appMapId: "grok-ios", testId: "checkout" },
    ],
    [
      ["test", "compile", "grok-ios", "checkout"],
      "app-map.test.compile",
      { appMapId: "grok-ios", testId: "checkout" },
    ],
    [
      ["combine", "run", "grok-ios", "language-x-settings"],
      "job.combine.start",
      { appMapId: "grok-ios", combineId: "language-x-settings" },
    ],
    [["lane", "list"], "lane.list", {}],
    [["lane", "save", "grok-daily"], "lane.save", { id: "grok-daily" }],
    [["lane", "remove", "grok-lab"], "lane.remove", { laneId: "grok-lab" }],
  ] as const;

  for (const [argv, operationId, input] of cases) {
    const resolved = resolveCommand(argv);
    assert.equal(resolved.operationId, operationId, argv.join(" "));
    assert.deepEqual(resolved.input, input, argv.join(" "));
  }
  assert.equal(resolveCommand(["device", "screenshot", "pixel-9"]).behavior, "screenshot");
  assert.equal(resolveCommand(["run", "watch", "job-1"]).behavior, "job-watch");
  assert.equal(resolveCommand(["activity", "follow"]).behavior, "event-stream");
  assert.equal(
    resolveCommand(["test", "run", "grok-ios", "settings-tour"]).behavior,
    "job-start-watch",
  );
});

test("declared read-only resources build encoded paths", () => {
  assert.deepEqual(resolveResourceCommand(["run", "get", "run/a"]), {
    resourceId: "run.get",
    commandPath: "run get",
    resourcePath: "/runs/run%2Fa",
  });
  assert.deepEqual(resolveResourceCommand(["run", "story", "run/a"]), {
    resourceId: "run.story",
    commandPath: "run story",
    resourcePath: "/runs/run%2Fa/story",
  });
  assert.deepEqual(resolveResourceCommand(["run", "replay-offline", "run/a"]), {
    resourceId: "run.replay.offline",
    commandPath: "run replay-offline",
    resourcePath: "/runs/run%2Fa/replay-offline",
  });
  assert.deepEqual(
    resolveResourceCommand(["run", "evidence", "run/a"], {
      limit: 200,
      includeBodies: true,
    }),
    {
      resourceId: "run.evidence",
      commandPath: "run evidence",
      resourcePath: "/runs/run%2Fa/evidence?limit=200&includeBodies=true",
    },
  );
  assert.deepEqual(
    resolveResourceCommand(["activity", "list"], { limit: 20, cursor: "next/value" }),
    {
      resourceId: "activity.list",
      commandPath: "activity list",
      resourcePath: "/activity?limit=20&cursor=next%2Fvalue",
    },
  );
  assert.throws(
    () => resolveResourceCommand(["activity", "list"], { limit: 0 }),
    /positive integer/,
  );
});

test("run evidence CLI resource exposes packet provenance through the canonical route", () => {
  const descriptor = cliResourceDescriptors.find((item) => item.resourceId === "run.evidence");
  assert.ok(descriptor);
  assert.match(descriptor.label, /packet provenance/u);
  assert.match(descriptor.path.summary ?? "", /coverage/u);
  assert.deepEqual(
    descriptor.resourcePath({ runId: "emulator-run" }),
    "/runs/emulator-run/evidence",
  );
});

test("root help documents exit codes, --confirm, and the machine envelopes", () => {
  const help = renderHelp();
  for (const code of ["0", "2", "3", "4", "5", "6", "7", "8", "9"]) {
    assert.ok(new RegExp(`^  ${code}  `, "m").test(help), `exit code ${code} documented`);
  }
  assert.match(help, /5 {2}validation \(client-side input problem/u);
  assert.match(help, /9 {2}operation failed/u);
  assert.match(help, /--confirm/u);
  assert.match(help, /-h, --help/u);
  assert.match(help, /"type":"result","ok":true/u);
  assert.match(help, /"type":"error","ok":false/u);
  assert.match(help, /relay doctor/u);
  assert.match(
    help,
    /relay goal run --url http:\/\/127\.0\.0\.1:3000 --goal "Open settings" --confirm/u,
  );
  assert.match(help, /Inspect a Run\s+relay inspect <runOrWorkflowId>/u);
  assert.match(help, /10 verification incomplete/u);
  assert.match(help, /screenshots are awaiting review/u);
});

test("browser commands reuse canonical navigation, capture, and semantic input", () => {
  assert.equal(resolveCommand(["browser", "open", "web"]).operationId, "target.open");
  assert.deepEqual(resolveCommand(["browser", "navigate", "web", "https://example.com"]).input, {
    serial: "web",
    app: "https://example.com",
  });
  assert.deepEqual(resolveCommand(["browser", "click", "web", "Business"]).input, {
    serial: "web",
    label: "Business",
    kind: "label",
  });
  assert.equal(
    resolveCommand(["browser", "snapshot", "web"]).operationId,
    "target.snapshot.capture",
  );
  assert.equal(
    resolveCommand(["browser", "screenshot", "web"]).operationId,
    "target.screenshot.capture",
  );
});
