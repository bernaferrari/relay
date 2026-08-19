import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  validateRecipeSteps,
  listRecipes,
  readRecipe,
  saveRecipe,
  listRecipeHistory,
  deleteRecipe,
  builtinRecipes,
  describeRecipeStep,
  glyphsForStep,
  readRecipeEvidenceImage,
  saveRecipeEvidenceImage,
  testsRoot,
  freezeRecipeExecution,
} from "./recipes.js";
import { formatRecipeYaml, parseRecipeYaml, recipeYamlPath } from "./recipe-yaml.js";

// Isolate the on-disk store in a temp dir for the whole suite.
let tmp = "";
before(async () => {
  tmp = await mkdtemp(join(tmpdir(), "recipes-test-"));
  process.env.RELAY_RECIPES_DIR = tmp;
  process.env.RELAY_TESTS_DIR = join(tmp, "tests");
});
after(async () => {
  delete process.env.RELAY_RECIPES_DIR;
  delete process.env.RELAY_TESTS_DIR;
  await rm(tmp, { recursive: true, force: true });
});

describe("recipe store roundtrip", () => {
  it("save → list (custom after builtins) → read → delete → gone", async () => {
    const saved = await saveRecipe({
      expectedRevision: 0,
      title: "My Recipe",
      description: "a test",
      steps: [{ kind: "sleep", ms: 50 }],
    });
    assert.equal(saved.source, "custom");
    assert.match(saved.id, /^custom-my-recipe-/);
    assert.equal(saved.steps.length, 1);

    const all = await listRecipes();
    const builtinCount = builtinRecipes().length;
    assert.equal(all.length, builtinCount + 1);
    // builtins come first
    assert.equal(all[0]!.source, "builtin");
    assert.equal(all[0]!.id, "update-last-alpha");
    // custom appears after builtins
    const custom = all.find((r) => r.id === saved.id);
    assert.ok(custom, "custom recipe appears in list");
    assert.equal(custom!.source, "custom");

    const read = await readRecipe(saved.id);
    assert.ok(read, "readRecipe returns the recipe");
    assert.equal(read!.title, "My Recipe");
    assert.equal(read!.source, "custom");

    await deleteRecipe(saved.id);
    const gone = await readRecipe(saved.id);
    assert.equal(gone, null, "deleted recipe is gone");
  });

  it("reads builtins by id without touching disk", async () => {
    const logout = await readRecipe("logout");
    assert.ok(logout);
    assert.equal(logout!.source, "builtin");
    assert.deepEqual(logout!.steps, [{ kind: "flow", flow: "logout" }]);
  });

  it("persists recorder screenshots outside recipe YAML", async () => {
    const saved = await saveRecipe({ expectedRevision: 0, title: "Evidence", steps: [] });
    const image = Buffer.from("recorded-image");
    const result = await saveRecipeEvidenceImage({
      recipeId: saved.id,
      evidenceId: "ev-test",
      base64: image.toString("base64"),
    });
    assert.equal(result.bytes, image.byteLength);
    assert.equal(result.deduplicated, false);
    assert.match(result.sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(await readRecipeEvidenceImage(saved.id, "ev-test"), image);
    const duplicate = await saveRecipeEvidenceImage({
      recipeId: saved.id,
      evidenceId: "ev-duplicate",
      base64: image.toString("base64"),
    });
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.sha256, result.sha256);
    assert.deepEqual(await readRecipeEvidenceImage(saved.id, "ev-duplicate"), image);
    await deleteRecipe(saved.id);
    assert.equal(await readRecipeEvidenceImage(saved.id, "ev-test"), null);
  });

  it("writes new custom recipes as deterministic, editable YAML", async () => {
    const saved = await saveRecipe({
      expectedRevision: 0,
      title: "YAML smoke",
      variables: { account_tier: "Pro" },
      steps: [{ kind: "type", text: "{{account_tier}}" }],
    });
    const source = await readFile(recipeYamlPath(testsRoot(), saved.id), "utf8");
    assert.match(source, /^schemaVersion: 1/m);
    assert.match(source, /^recordingFormatVersion: 2/m);
    assert.match(source, /^name: YAML smoke/m);
    assert.match(source, /account_tier: Pro/);
    const read = await readRecipe(saved.id);
    assert.deepEqual(read?.variables, { account_tier: "Pro" });
    assert.equal(read?.steps[0]?.kind, "type");
  });

  it("lists YAML history when a git-native test is edited", async () => {
    const first = await saveRecipe({
      id: "history-yaml",
      expectedRevision: 0,
      title: "First draft",
      steps: [{ kind: "sleep", ms: 10 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveRecipe({
      id: first.id,
      expectedRevision: first.updatedAt,
      title: "Second draft",
      steps: [{ kind: "sleep", ms: 20 }],
    });

    const history = await listRecipeHistory(first.id);
    assert.equal(history.length, 1);
    assert.equal(history[0]?.title, "First draft");
    assert.equal(history[0]?.steps[0]?.kind, "sleep");
    await deleteRecipe(first.id);
  });
});

describe("frozen recipe execution", () => {
  it("captures transitive reusable flows before queueing", async () => {
    const child = await saveRecipe({
      id: "custom-frozen-child",
      expectedRevision: 0,
      title: "Frozen child",
      steps: [{ kind: "sleep", ms: 10 }],
    });
    const root = await saveRecipe({
      id: "custom-frozen-root",
      expectedRevision: 0,
      title: "Frozen root",
      steps: [{ kind: "module", recipeId: child.id }],
    });
    const frozen = await freezeRecipeExecution(root.id);
    await saveRecipe({
      ...child,
      expectedRevision: child.updatedAt,
      steps: [{ kind: "sleep", ms: 999 }],
    });
    assert.deepEqual(frozen.recipeGraph[child.id]?.steps, [{ kind: "sleep", ms: 10 }]);
  });
});

describe("recipe YAML", () => {
  it("round-trips through a stable, schema-versioned source format", () => {
    const recipe = parseRecipeYaml(
      `schemaVersion: 1\nrecordingFormatVersion: 2\nid: yaml-roundtrip\nname: YAML roundtrip\nsteps:\n  - kind: sleep\n    ms: 10\n`,
    );
    const output = formatRecipeYaml(recipe);
    assert.match(output, /^recordingFormatVersion: 2/m);
    assert.equal(output, formatRecipeYaml(parseRecipeYaml(output)));
    assert.equal(recipe.title, "YAML roundtrip");
  });

  it("canonicalizes unordered values to avoid noisy Git diffs", () => {
    const first = parseRecipeYaml(
      [
        "schemaVersion: 1",
        "id: stable-diff",
        "name: Stable diff",
        "variables:",
        "  z_account: secondary",
        "  a_account: primary",
        "steps:",
        "  - kind: module",
        "    recipeId: sign-in",
        "    bindings:",
        "      z_account: '{{z_account}}'",
        "      a_account: '{{a_account}}'",
      ].join("\n"),
    );
    const second = parseRecipeYaml(
      [
        "schemaVersion: 1",
        "id: stable-diff",
        "name: Stable diff",
        "variables:",
        "  a_account: primary",
        "  z_account: secondary",
        "steps:",
        "  - kind: module",
        "    recipeId: sign-in",
        "    bindings:",
        "      a_account: '{{a_account}}'",
        "      z_account: '{{z_account}}'",
      ].join("\n"),
    );

    assert.equal(formatRecipeYaml(first), formatRecipeYaml(second));
    assert.match(
      formatRecipeYaml(first),
      /variables:\n  a_account: primary\n  z_account: secondary/,
    );
  });

  it("keeps reusable-flow parameters and module bindings reviewable in YAML", () => {
    const recipe = parseRecipeYaml(
      [
        "schemaVersion: 1",
        "id: sign-in-suite",
        "name: Sign-in suite",
        "parameters:",
        "  - name: login_email",
        "    label: Test account",
        "    required: true",
        "steps:",
        "  - kind: module",
        "    recipeId: recorded-email-sign-in",
        "    bindings:",
        "      login_email: '{{account_email}}'",
      ].join("\n"),
    );
    assert.deepEqual(recipe.parameters, [
      { name: "login_email", label: "Test account", required: true },
    ]);
    assert.deepEqual(recipe.steps, [
      {
        kind: "module",
        recipeId: "recorded-email-sign-in",
        bindings: { login_email: "{{account_email}}" },
      },
    ]);
    assert.match(formatRecipeYaml(recipe), /parameters:\n  - name: login_email/);
  });

  it("rejects aliases, duplicate fields, unknown schemas, and unknown fields", () => {
    assert.throws(
      () => parseRecipeYaml(`schemaVersion: 1\nid: alias\nname: &name Alias\nsteps: []\n`),
      /anchors and aliases/i,
    );
    assert.throws(
      () =>
        parseRecipeYaml(
          `schemaVersion: 1\nschemaVersion: 1\nid: duplicate\nname: Duplicate\nsteps: []\n`,
        ),
      /map keys must be unique/i,
    );
    assert.throws(
      () => parseRecipeYaml(`schemaVersion: 2\nid: future\nname: Future\nsteps: []\n`),
      /unsupported Relay test schemaVersion/i,
    );
    assert.throws(
      () =>
        parseRecipeYaml(
          `schemaVersion: 1\nrecordingFormatVersion: 1\nid: old-recording\nname: Old recording\nsteps: []\n`,
        ),
      /recordingFormatVersion must be 2/i,
    );
    assert.throws(
      () => parseRecipeYaml(`schemaVersion: 1\nid: extra\nname: Extra\nsteps: []\nunknown: true\n`),
      /unknown Relay test field/i,
    );
  });
});

describe("packaged recipe CRUD", () => {
  it("allows a packaged recipe to be edited in place", async () => {
    const builtin = await readRecipe("logout");
    const saved = await saveRecipe({
      id: "logout",
      expectedRevision: builtin?.updatedAt ?? 0,
      title: "Custom logout",
      steps: [],
    });
    assert.equal(saved.id, "logout");
    assert.equal(saved.source, "custom");
    assert.equal((await readRecipe("logout"))?.title, "Custom logout");
  });

  it("removing a packaged override restores its immutable runtime default", async () => {
    await deleteRecipe("logout");
    assert.equal((await readRecipe("logout"))?.source, "builtin");
    assert.equal(
      (await listRecipes()).some((recipe) => recipe.id === "logout"),
      true,
    );
  });
});

describe("validateRecipeSteps", () => {
  it("validates compiled semantic reveal navigation", () => {
    const step = {
      kind: "reveal" as const,
      target: { identifier: "kids-mode" },
      navigation: [
        {
          schemaVersion: 1 as const,
          surfaceId: "settings",
          captureId: "settings-r1",
          documentHeight: 2_400,
          viewportHeight: 800,
          targetOrder: 1,
          targetDocumentY: 2_000,
          anchors: [
            { order: 0, documentY: 200, target: { identifier: "appearance" } },
            { order: 1, documentY: 2_000, target: { identifier: "kids-mode" } },
          ],
        },
      ],
    };
    assert.deepEqual(validateRecipeSteps([step]), [step]);
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            ...step,
            navigation: [{ ...step.navigation[0]!, targetOrder: 4 }],
          },
        ]),
      /targetOrder is not indexed/,
    );
  });

  it("validates executable logical-surface captures", () => {
    const step = {
      kind: "capture-surface" as const,
      screenId: "settings",
      screenTitle: "Settings",
      variantId: "settings-it",
      surfaceId: "settings-surface",
      baselineCaptureId: "capture-v1",
      reason: "Stable settings content is compared as a complete surface.",
      maxScrolls: 3,
      forceRecapture: true,
      baseline: { compositeWidth: 1080, compositeHeight: 4200, semanticNodeCount: 42 },
    };
    assert.deepEqual(validateRecipeSteps([step]), [step]);
    assert.equal(describeRecipeStep(step), "Capture full surface · Settings");
    assert.deepEqual(glyphsForStep(step), ["swipe", "shot", "store"]);
    assert.throws(
      () => validateRecipeSteps([{ ...step, maxScrolls: 7 }]),
      /maxScrolls must be an integer from 1 to 6/,
    );
    assert.throws(
      () => validateRecipeSteps([{ ...step, forceRecapture: "yes" }]),
      /forceRecapture must be a boolean/,
    );
  });

  it("keeps tour origin identity and prelude inside the walk", () => {
    const originFingerprint = "a".repeat(64);
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "tour",
          originVerifiedBySetup: true,
          originTitle: "Settings",
          originFingerprint,
          preludeSteps: [{ kind: "tap", target: { identifier: "sidebar.settings.button" } }],
          fallbackStops: [{ label: "Appearance", evidenceSurface: "preview" }],
          landmarkStops: [{ label: "Profile" }, { label: "Appearance" }],
          scrollSearch: { maxScrolls: 20, amount: 0.5 },
          excludeLanguageRows: true,
        },
      ]),
      [
        {
          kind: "tour",
          originVerifiedBySetup: true,
          originTitle: "Settings",
          originFingerprint,
          preludeSteps: [{ kind: "tap", target: { identifier: "sidebar.settings.button" } }],
          fallbackStops: [{ label: "Appearance", evidenceSurface: "preview" }],
          landmarkStops: [{ label: "Profile" }, { label: "Appearance" }],
          scrollSearch: { maxScrolls: 20, amount: 0.5 },
          excludeLanguageRows: true,
        },
      ],
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "tour", originFingerprint: "not-a-fingerprint" }]),
      /originFingerprint/,
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "tour", scrollSearch: { amount: 0.95 } }]),
      /scrollSearch\.amount/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "tour", fallbackStops: [{ label: "Appearance", evidenceSurface: "slow" }] },
        ]),
      /evidenceSurface/,
    );
  });

  it("preserves stable accessibility identifiers as first-class targets", () => {
    assert.deepEqual(
      validateRecipeSteps([
        { kind: "tap", target: { identifier: "chat_text_input" } },
        {
          kind: "expect",
          target: { identifier: "conversation_top_bar" },
          condition: "visible",
        },
      ]),
      [
        { kind: "tap", target: { identifier: "chat_text_input" } },
        {
          kind: "expect",
          target: { identifier: "conversation_top_bar" },
          condition: "visible",
        },
      ],
    );
  });

  it("supports explicit Android build evidence and lifecycle steps", () => {
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "app",
          action: "inspect",
          app: "com.example.chat",
          version: "2.4.",
          versionMatch: "contains",
          as: "chat_version",
        },
        {
          kind: "app",
          action: "update",
          app: "com.example.chat",
          artifact: "/builds/chat.apk",
        },
      ]),
      [
        {
          kind: "app",
          action: "inspect",
          app: "com.example.chat",
          version: "2.4.",
          versionMatch: "contains",
          as: "chat_version",
        },
        {
          kind: "app",
          action: "update",
          app: "com.example.chat",
          artifact: "/builds/chat.apk",
        },
      ],
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "app", action: "update", app: "com.example.chat" }]),
      /requires a local APK/i,
    );
  });

  it("preserves validated recording evidence and selector candidates", () => {
    const [step] = validateRecipeSteps([
      {
        kind: "tap",
        target: {
          ref: "@e1",
          point: {
            x: 10,
            y: 20,
            fallbackPolicy: "reviewed",
            anchor: { horizontal: "right", vertical: "bottom" },
            referenceBounds: { width: 1080, height: 2400 },
            relativeTo: {
              target: { identifier: "sign-in-button" },
              xRatio: 0.8,
              yRatio: 0.5,
            },
          },
        },
        group: "Sign in",
        evidence: {
          id: "ev-1",
          recordedAt: 123,
          serial: "pixel",
          capture: {
            schemaVersion: 1,
            uiTreeCapturedAt: 121,
            screenshotCapturedAt: 124,
            status: "complete",
          },
          deviceBounds: { width: 1080, height: 2400 },
          pointer: { x: 10, y: 20 },
          node: { label: "Sign in", role: "button", ref: "@e1" },
          nodes: [
            {
              label: "Sign in",
              role: "button",
              ref: "@e1",
              index: 2,
              parentIndex: 1,
              rect: { x: 8, y: 16, width: 120, height: 48 },
            },
          ],
          candidates: [
            {
              strategy: "label",
              label: 'label "Sign in"',
              source: "element",
              confidence: "high",
              target: { label: "Sign in", point: { x: 10, y: 20 } },
            },
          ],
          screenshot: {
            recipeId: "custom-test",
            id: "ev-1",
            capturedAt: 124,
            mime: "image/png",
            bytes: 1024,
            sha256: "a".repeat(64),
          },
        },
      },
    ]);
    assert.equal(step?.kind, "tap");
    assert.deepEqual(step?.kind === "tap" ? step.target.point?.anchor : undefined, {
      horizontal: "right",
      vertical: "bottom",
    });
    assert.equal(step?.kind === "tap" ? step.target.point?.fallbackPolicy : undefined, "reviewed");
    assert.deepEqual(step?.kind === "tap" ? step.target.point?.relativeTo : undefined, {
      target: { identifier: "sign-in-button" },
      xRatio: 0.8,
      yRatio: 0.5,
    });
    assert.equal(step?.kind === "tap" ? step.evidence?.node?.label : undefined, "Sign in");
    assert.equal(step?.kind === "tap" ? step.evidence?.nodes?.length : undefined, 1);
    assert.equal(step?.kind === "tap" ? step.evidence?.nodes?.[0]?.parentIndex : undefined, 1);
    assert.equal(step?.kind === "tap" ? step.evidence?.capture?.status : undefined, "complete");
    assert.equal(step?.group, "Sign in");
    assert.equal(
      step?.kind === "tap" ? step.evidence?.candidates?.[0]?.strategy : undefined,
      "label",
    );
  });

  it("rejects unsafe element-relative point anchors", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "tap",
            target: { label: "Home", point: { x: 20, y: 40, fallbackPolicy: "automatic" } },
          },
        ]),
      /fallbackPolicy must be reviewed/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "tap",
            target: {
              point: {
                x: 20,
                y: 40,
                relativeTo: { target: { identifier: "row" }, xRatio: 1.2, yRatio: 0.5 },
              },
            },
          },
        ]),
      /xRatio\/yRatio between 0 and 1/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "tap",
            target: {
              point: {
                x: 20,
                y: 40,
                relativeTo: { target: {}, xRatio: 0.5, yRatio: 0.5 },
              },
            },
          },
        ]),
      /must contain a semantic selector/,
    );
  });

  it("keeps recording context on non-target actions and pinned swipe endpoints", () => {
    const [scroll, swipe] = validateRecipeSteps([
      {
        id: "step-scroll",
        kind: "scroll",
        direction: "down",
        evidence: {
          id: "ev-scroll",
          recordedAt: 123,
          screenshot: {
            recipeId: "custom-test",
            id: "ev-scroll",
            capturedAt: 124,
            mime: "image/png",
          },
        },
      },
      {
        id: "step-swipe",
        kind: "swipe",
        from: {
          x: 540,
          y: 1600,
          anchor: { horizontal: "center", vertical: "bottom" },
          referenceBounds: { width: 1080, height: 2400 },
        },
        to: {
          x: 540,
          y: 600,
          anchor: { horizontal: "center", vertical: "top" },
          referenceBounds: { width: 1080, height: 2400 },
        },
      },
    ]);
    assert.equal(scroll?.id, "step-scroll");
    assert.equal(scroll?.evidence?.screenshot?.id, "ev-scroll");
    assert.equal(swipe?.kind, "swipe");
    assert.deepEqual(swipe?.kind === "swipe" ? swipe.from.anchor : undefined, {
      horizontal: "center",
      vertical: "bottom",
    });
  });

  it("accepts every step kind with valid fields", () => {
    const steps = [
      { kind: "tap", target: { ref: "@e1" }, expectedApp: "bitpit.launcher" },
      { kind: "type", text: "hi", target: { label: "Field" } },
      { kind: "scroll", direction: "down", amount: 0.5 },
      { kind: "swipe", from: { x: 540, y: 1600 }, to: { x: 540, y: 600 }, durationMs: 300 },
      { kind: "key", key: "back" },
      { kind: "sleep", ms: 100 },
      { kind: "wait-for", target: { text: "Welcome" }, timeoutMs: 5000 },
      {
        kind: "wait-response",
        target: { text: "Assistant response" },
        busyTarget: { text: "Stop generating" },
        idleTarget: { label: "Send" },
        timeoutMs: 90_000,
        stableForMs: 2_000,
      },
      { kind: "expect", target: { label: "Sign in" }, condition: "visible" },
      { kind: "expect", target: { text: "Welcome" }, condition: "gone", timeoutMs: 3000 },
      {
        kind: "expect-screen",
        screenId: "home",
        screenTitle: "Home",
        fingerprint: "a".repeat(64),
        repairCheckpoint: {
          sourceRunId: "run-1",
          sourceCheckId: "visit-home",
          sourceInputDigest: "digest-1",
          transitionId: "open-home",
        },
      },
      { kind: "extract", as: "response", target: { ref: "@answer" }, role: "assistant" },
      { kind: "assert-content", input: "response", expected: "France", match: "contains" },
      {
        kind: "evaluate-semantic",
        input: "response",
        criteria: ["Identifies the correct country"],
        threshold: 0.9,
      },
      {
        kind: "pause",
        message: "approve the Okta sign-in",
        reason: "consent",
        resumeLabel: "Continue test",
        timeoutMs: 600_000,
        verifyAfter: { target: { label: "Welcome" }, timeoutMs: 15_000 },
      },
      { kind: "screenshot", caption: "after login" },
      { kind: "flow", flow: "logout" },
    ];
    const out = validateRecipeSteps(steps);
    assert.equal(out.length, steps.length);
    assert.equal(out[0]!.kind, "tap");
    assert.equal(out[0]?.kind === "tap" ? out[0].expectedApp : undefined, "bitpit.launcher");
    assert.equal(out[3]!.kind, "swipe");
    assert.equal(out[16]!.kind, "flow");
    assert.equal((out[14] as { reason?: string }).reason, "consent");
    assert.deepEqual((out[14] as { verifyAfter?: unknown }).verifyAfter, {
      target: { label: "Welcome" },
      timeoutMs: 15_000,
    });
  });

  it("preserves ordered semantic tap fallbacks", () => {
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "tap",
          target: { identifier: "new-conversation" },
          fallbackTargets: [{ label: "New conversation" }, { label: "Compose" }],
        },
      ]),
      [
        {
          kind: "tap",
          target: { identifier: "new-conversation" },
          fallbackTargets: [{ label: "New conversation" }, { label: "Compose" }],
        },
      ],
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "tap", target: { label: "Continue" }, fallbackTargets: [{}] },
        ]),
      /fallbackTargets\[0\].*semantic or coordinate target/,
    );
  });

  it("preserves graph navigation proof and accessibility roles", () => {
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "tap",
          target: { identifier: "settings_button" },
          fallbackTargets: [{ label: "Settings", role: "button" }],
          navigationContract: {
            connectionId: "open-settings",
            expectedScreenId: "settings",
            expectedFingerprint: "a".repeat(64),
            evidenceIds: ["settings-tree"],
          },
        },
      ]),
      [
        {
          kind: "tap",
          target: { identifier: "settings_button" },
          fallbackTargets: [{ label: "Settings", role: "button" }],
          navigationContract: {
            connectionId: "open-settings",
            expectedScreenId: "settings",
            expectedFingerprint: "a".repeat(64),
            evidenceIds: ["settings-tree"],
          },
        },
      ],
    );
  });

  it("preserves an exact missing-return diagnostic without adding recovery", () => {
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "expect-screen",
          screenId: "settings",
          screenTitle: "Settings",
          fingerprint: "a".repeat(64),
          timeoutMs: 0,
          returnRequirement: {
            connectionId: "open-widget",
            fromScreenId: "settings",
            destinationScreenId: "widget",
          },
        },
      ]),
      [
        {
          kind: "expect-screen",
          screenId: "settings",
          screenTitle: "Settings",
          fingerprint: "a".repeat(64),
          timeoutMs: 0,
          returnRequirement: {
            connectionId: "open-widget",
            fromScreenId: "settings",
            destinationScreenId: "widget",
          },
        },
      ],
    );
  });

  it("rejects tap with empty target, naming the step index", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "tap", target: {} }]),
      /step 1: tap requires target/,
    );
  });

  it("accepts explicit field replacement and requires its target", () => {
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "type",
          mode: "replace",
          text: "",
          target: { identifier: "message-field" },
        },
      ])[0],
      {
        kind: "type",
        mode: "replace",
        text: "",
        target: { identifier: "message-field" },
      },
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "type", mode: "replace", text: "" }]),
      /target is required/i,
    );
  });

  it("rejects a point-only post-handoff verification target", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "pause",
            message: "approve sign-in",
            verifyAfter: { target: { point: { x: 1, y: 2 } } },
          },
        ]),
      /pause\.verifyAfter\.target must have identifier, ref, label, or text/,
    );
  });

  it("rejects wait-for with point-only target", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "wait-for", target: { point: { x: 1, y: 2 } } }]),
      /step 1: wait-for target must have identifier\/ref\/label\/text/,
    );
  });

  it("accepts expect with visible/gone conditions", () => {
    const out = validateRecipeSteps([
      { kind: "expect", target: { label: "Sign in" }, condition: "visible" },
      { kind: "expect", target: { text: "Welcome" }, condition: "gone" },
    ]);
    assert.equal(out.length, 2);
    assert.equal(out[0]!.kind, "expect");
    assert.deepEqual(out[0], {
      kind: "expect",
      target: { label: "Sign in" },
      condition: "visible",
    });
  });

  it("accepts an exact, order-independent option set", () => {
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "expect-set",
          identifierPrefix: "ask.toolbar.add.menu.",
          labels: ["Camera", "Photo or Video", "Files"],
          timeoutMs: 2_000,
        },
      ]),
      [
        {
          kind: "expect-set",
          identifierPrefix: "ask.toolbar.add.menu.",
          labels: ["Camera", "Photo or Video", "Files"],
          timeoutMs: 2_000,
        },
      ],
    );
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "expect-set",
          scope: { label: "Attachments" },
          labels: ["Camera", "Gallery", "Files"],
        },
      ]),
      [
        {
          kind: "expect-set",
          scope: { label: "Attachments" },
          labels: ["Camera", "Gallery", "Files"],
        },
      ],
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "expect-set", labels: ["Files"] }]),
      /requires identifierPrefix or scope/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "expect-set",
            identifierPrefix: "menu.",
            labels: ["Files", "files"],
          },
        ]),
      /labels must be unique/,
    );
  });

  it("rejects expect with point-only target", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "expect", target: { point: { x: 1, y: 2 } }, condition: "visible" },
        ]),
      /step 1: expect target must have identifier\/ref\/label\/text/,
    );
  });

  it("rejects expect with a bad condition", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "expect", target: { label: "x" }, condition: "nope" }]),
      /step 1: expect requires condition: "visible" \| "gone"/,
    );
  });

  it("rejects flow with an unknown action id", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "flow", flow: "nope" }]),
      /step 1: flow references unknown action id: nope/,
    );
  });

  it("rejects negative sleep", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "sleep", ms: -1 }]),
      /step 1: sleep ms must be >= 0/,
    );
  });

  it("keeps an explicit best-effort step policy", () => {
    assert.deepEqual(validateRecipeSteps([{ kind: "sleep", ms: 10, optional: true }]), [
      { kind: "sleep", ms: 10, optional: true },
    ]);
    assert.throws(
      () => validateRecipeSteps([{ kind: "sleep", ms: 10, optional: "yes" }]),
      /optional must be a boolean/,
    );
  });

  it("keeps a strict campaign check boundary separate from optional work", () => {
    assert.deepEqual(
      validateRecipeSteps([
        { kind: "module", recipeId: "settings", check: { id: "settings", title: "Settings" } },
      ]),
      [{ kind: "module", recipeId: "settings", check: { id: "settings", title: "Settings" } }],
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "module",
            recipeId: "settings",
            check: { id: "settings", title: "Settings" },
            optional: true,
          },
        ]),
      /check and optional cannot be combined/u,
    );
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "module",
          recipeId: "kids-flow",
          check: {
            id: "kids",
            title: "Kids Mode",
            cleanup: {
              recipeId: "restore-kids-off",
              bindings: { locale: "en" },
              terminalScreenId: "kids-off",
              onCancel: "skip",
            },
          },
        },
      ])[0]?.check?.cleanup,
      {
        recipeId: "restore-kids-off",
        bindings: { locale: "en" },
        terminalScreenId: "kids-off",
        onCancel: "skip",
      },
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "module",
            recipeId: "kids-flow",
            check: {
              id: "kids",
              title: "Kids Mode",
              cleanup: {
                recipeId: "restore-kids-off",
                terminalScreenId: "kids-off",
                onCancel: "run",
              },
            },
          },
        ]),
      /check\.cleanup\.onCancel must be "skip"/u,
    );
  });

  it("rejects swipe missing from/to", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "swipe", to: { x: 1, y: 2 } }]),
      /step 1: swipe.from must be \{ x: number, y: number \}/,
    );
  });

  it("rejects swipe with non-numeric coordinates", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "swipe", from: { x: "a", y: 2 }, to: { x: 1, y: 2 } }]),
      /step 1: swipe.from must be \{ x: number, y: number \}/,
    );
  });

  it("rejects swipe with out-of-range durationMs", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 10 },
        ]),
      /step 1: swipe.durationMs must be between 50 and 5000/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, durationMs: 9000 },
        ]),
      /step 1: swipe.durationMs must be between 50 and 5000/,
    );
  });

  it("accepts swipe without optional durationMs (defaults at runtime)", () => {
    const out = validateRecipeSteps([
      { kind: "swipe", from: { x: 540, y: 1600 }, to: { x: 540, y: 600 } },
    ]);
    assert.equal(out[0]!.kind, "swipe");
  });

  it("keeps evidence and timing on every tap gesture", () => {
    const evidence = {
      id: "tap-evidence",
      recordedAt: 123,
      pointer: { x: 10, y: 20 },
    };
    const out = validateRecipeSteps([
      {
        kind: "tap",
        gesture: "multi",
        tapCount: 4,
        intervalMs: 140,
        target: { ref: "@e2" },
        evidence,
      },
      {
        kind: "tap",
        gesture: "hold",
        target: { point: { x: 10, y: 20 } },
        durationMs: 900,
        evidence,
      },
    ]);
    assert.deepEqual(out[0], {
      kind: "tap",
      gesture: "multi",
      tapCount: 4,
      intervalMs: 140,
      target: { ref: "@e2" },
      evidence,
    });
    assert.deepEqual(out[1], {
      kind: "tap",
      gesture: "hold",
      target: { point: { x: 10, y: 20 } },
      durationMs: 900,
      evidence,
    });
  });

  it("accepts device, clipboard, observability, and reusable test steps", () => {
    const out = validateRecipeSteps([
      { kind: "clipboard", action: "write", text: "hello" },
      { kind: "clipboard", action: "read", expect: "hello", match: "exact" },
      {
        kind: "clipboard",
        action: "paste",
        text: "hello",
        target: { identifier: "message" },
      },
      {
        kind: "clipboard",
        action: "paste",
        target: { identifier: "message" },
      },
      {
        kind: "clipboard",
        action: "copy",
        target: { identifier: "message" },
        expect: "hello",
      },
      { kind: "app", action: "switcher" },
      { kind: "app", action: "open", url: "myapp://settings", relaunch: false },
      { kind: "device", action: "lock" },
      { kind: "rotate", orientation: "landscape-left" },
      { kind: "settings", setting: "appearance", state: "dark" },
      { kind: "location", latitude: 48.8566, longitude: 2.3522 },
      { kind: "permission", action: "grant", permission: "camera" },
      { kind: "alert", action: "accept" },
      { kind: "network", action: "dump", include: "headers", limit: 100 },
      { kind: "logs", action: "mark", message: "after sign in" },
      { kind: "module", recipeId: "custom-login" },
    ]);
    assert.equal(out.length, 16);
    assert.equal(out.at(-1)?.kind, "module");
  });

  it("rejects invalid cross-field device settings", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "settings", setting: "wifi", state: "dark" }]),
      /settings state is not valid/,
    );
  });

  it("rejects non-array steps", () => {
    assert.throws(() => validateRecipeSteps({ not: "array" }), /steps must be an array/);
  });

  it("reports the index of the FIRST invalid step (1-based)", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "sleep", ms: 10 },
          { kind: "sleep", ms: 20 },
          { kind: "tap", target: {} },
        ]),
      /step 3: tap requires target/,
    );
  });
});

describe("describeRecipeStep", () => {
  it("describes each kind", () => {
    assert.equal(describeRecipeStep({ kind: "tap", target: { ref: "@e5" } }), "Tap ref @e5");
    assert.equal(describeRecipeStep({ kind: "tap", target: { label: "Go" } }), 'Tap label "Go"');
    assert.equal(describeRecipeStep({ kind: "type", text: "x" }), "Type text");
    assert.equal(
      describeRecipeStep({ kind: "type", text: "x", target: { text: "Email" } }),
      'Type into text "Email"',
    );
    assert.equal(describeRecipeStep({ kind: "scroll", direction: "up" }), "Scroll up");
    assert.equal(
      describeRecipeStep({ kind: "reveal", target: { label: "Advanced" } }),
      'Reveal label "Advanced"',
    );
    assert.equal(
      describeRecipeStep({ kind: "swipe", from: { x: 540, y: 1600 }, to: { x: 540, y: 600 } }),
      "swipe ↑ 540,1600 → 540,600",
    );
    assert.equal(
      describeRecipeStep({ kind: "swipe", from: { x: 200, y: 600 }, to: { x: 800, y: 600 } }),
      "swipe → 200,600 → 800,600",
    );
    assert.equal(describeRecipeStep({ kind: "key", key: "home" }), "Key: home");
    assert.equal(describeRecipeStep({ kind: "sleep", ms: 250 }), "Sleep 250ms");
    assert.equal(describeRecipeStep({ kind: "screenshot" }), "Screenshot");
    assert.equal(
      describeRecipeStep({ kind: "screenshot", caption: "proof" }),
      "Screenshot · proof",
    );
    assert.equal(describeRecipeStep({ kind: "tour" }), "Tour visible rows");
    assert.equal(describeRecipeStep({ kind: "tour", depth: 0 }), "Tour visible rows");
    assert.equal(describeRecipeStep({ kind: "tour", depth: 1 }), "Tour visible rows depth 1");
    assert.equal(
      describeRecipeStep({ kind: "tour", originTitle: "Settings" }),
      "Tour Settings rows",
    );
    assert.equal(describeRecipeStep({ kind: "flow", flow: "logout" }), "Flow: logout");
    assert.equal(describeRecipeStep({ kind: "pause", message: "2FA" }), "Pause: 2FA");
    assert.equal(
      describeRecipeStep({ kind: "wait-for", target: { text: "Done" } }),
      'Wait for text "Done"',
    );
    assert.equal(
      describeRecipeStep({ kind: "wait-response", target: { text: "Assistant response" } }),
      'Wait for text "Assistant response" to finish responding',
    );
    assert.equal(
      describeRecipeStep({ kind: "expect", target: { label: "Sign in" }, condition: "visible" }),
      'check "Sign in" visible',
    );
    assert.equal(
      describeRecipeStep({ kind: "expect", target: { text: "Welcome" }, condition: "gone" }),
      'check text "Welcome" gone',
    );
    assert.equal(
      describeRecipeStep({
        kind: "expect-set",
        identifierPrefix: "menu.",
        labels: ["Camera", "Files"],
      }),
      "Check options are exactly Camera, Files",
    );
  });

  it("glyphsForStep maps each kind", () => {
    assert.deepEqual(glyphsForStep({ kind: "tap", target: { ref: "x" } }), ["tap"]);
    assert.deepEqual(glyphsForStep({ kind: "type", text: "x" }), ["type"]);
    assert.deepEqual(glyphsForStep({ kind: "scroll", direction: "down" }), ["swipe"]);
    assert.deepEqual(glyphsForStep({ kind: "reveal", target: { label: "Advanced" } }), ["swipe"]);
    assert.deepEqual(glyphsForStep({ kind: "swipe", from: { x: 0, y: 0 }, to: { x: 1, y: 1 } }), [
      "swipe",
    ]);
    assert.deepEqual(glyphsForStep({ kind: "key", key: "back" }), ["tap"]);
    assert.deepEqual(glyphsForStep({ kind: "sleep", ms: 1 }), ["wait"]);
    assert.deepEqual(glyphsForStep({ kind: "wait-for", target: { text: "x" } }), ["wait"]);
    assert.deepEqual(glyphsForStep({ kind: "wait-response", target: { text: "x" } }), [
      "ai",
      "wait",
    ]);
    assert.deepEqual(
      glyphsForStep({ kind: "expect", target: { text: "x" }, condition: "visible" }),
      ["ok"],
    );
    assert.deepEqual(
      glyphsForStep({ kind: "expect-set", identifierPrefix: "menu.", labels: ["Files"] }),
      ["ok"],
    );
    assert.deepEqual(glyphsForStep({ kind: "pause", message: "x" }), ["wait"]);
    assert.deepEqual(glyphsForStep({ kind: "screenshot" }), ["shot"]);
    assert.deepEqual(glyphsForStep({ kind: "tour" }), ["tap", "shot"]);
    assert.deepEqual(glyphsForStep({ kind: "flow", flow: "logout" }), ["store"]);
  });
});
