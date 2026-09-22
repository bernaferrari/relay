import { describe, it, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import {
  formatRecipeYaml,
  legacyRecipeYamlPath,
  parseRecipeYaml,
  recipeYamlPath,
  validateRecipeVariables,
} from "./recipe-yaml.js";
import { validateRecipeParameters } from "./recipe-validation.js";

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
    assert.match(source, /^kind: execution-plan/m);
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
    assert.match(output, /^kind: execution-plan/m);
    assert.match(output, /^recordingFormatVersion: 2/m);
    assert.equal(output, formatRecipeYaml(parseRecipeYaml(output)));
    assert.equal(recipe.title, "YAML roundtrip");
  });

  it("keeps a checkpoint id through a save and reload", () => {
    const source = [
      "schemaVersion: 1",
      "id: checkpoint-roundtrip",
      "name: Checkpoint roundtrip",
      "steps:",
      "  - kind: screenshot",
      "    id: interrupt-after",
      "    caption: After reconnect",
      "    review:",
      "      mode: later",
      "      policy: sequence",
      "      checkpointId: interrupt",
      "      phase: after",
    ].join("\n");
    const recipe = parseRecipeYaml(source);
    const step = recipe.steps[0];
    assert.equal(step?.kind === "screenshot" && step.id, "interrupt-after");
    assert.equal(step?.kind === "screenshot" && step.review?.checkpointId, "interrupt");
    const reloaded = parseRecipeYaml(formatRecipeYaml(recipe));
    assert.deepEqual(reloaded.steps, recipe.steps);
    assert.throws(
      () =>
        parseRecipeYaml(
          [
            "schemaVersion: 1",
            "id: checkpoint-typo",
            "name: Checkpoint typo",
            "steps:",
            "  - kind: screenshot",
            "    caption: After reconnect",
            "    review:",
            "      mode: later",
            "      checkpointID: interrupt",
          ].join("\n"),
        ),
      /screenshot\.review unknown field: checkpointID/u,
    );
  });

  it("reads legacy .relay.yaml recipes and migrates them on the next successful save", async () => {
    const id = "legacy-plan-migration";
    const legacyPath = legacyRecipeYamlPath(testsRoot(), id);
    await writeFile(
      legacyPath,
      `schemaVersion: 1\nid: ${id}\nname: Legacy plan\nsteps:\n  - kind: sleep\n    ms: 10\n`,
      "utf8",
    );

    const legacy = await readRecipe(id);
    assert.equal(legacy?.title, "Legacy plan");
    assert.ok((await listRecipes()).some((recipe) => recipe.id === id));
    await saveRecipe({
      ...legacy!,
      title: "Migrated plan",
      expectedRevision: legacy!.updatedAt,
    });

    const canonical = await readFile(recipeYamlPath(testsRoot(), id), "utf8");
    assert.match(canonical, /^kind: execution-plan/m);
    await assert.rejects(readFile(legacyPath, "utf8"), { code: "ENOENT" });
    await deleteRecipe(id);
  });

  it("fails closed when legacy and canonical executable sources both exist", async () => {
    const id = "ambiguous-plan-source";
    const source = `schemaVersion: 1\nid: ${id}\nname: Ambiguous plan\nsteps: []\n`;
    await writeFile(legacyRecipeYamlPath(testsRoot(), id), source, "utf8");
    await writeFile(recipeYamlPath(testsRoot(), id), source, "utf8");

    await assert.rejects(readRecipe(id), /ambiguous executable source/u);
    await assert.rejects(listRecipes(), /ambiguous executable source/u);
    await deleteRecipe(id);
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
          `schemaVersion: 1\nkind: bound-test\nid: wrong-layer\nname: Wrong layer\nsteps: []\n`,
        ),
      /kind must be execution-plan/i,
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
  test("keeps a capture-for-review screenshot without requiring a judge", () => {
    const step = {
      kind: "screenshot" as const,
      caption: "Arabic account settings",
      review: { mode: "later" as const, lookFor: "Save is visible" },
    };
    assert.deepEqual(validateRecipeSteps([step]), [step]);
  });
  test("keeps inspect vs transition coverage on a required action", () => {
    const step = {
      kind: "tap" as const,
      target: { identifier: "sidebar.settings" },
      coverage: "transition" as const,
    };
    assert.deepEqual(validateRecipeSteps([step]), [step]);
  });
  test("keeps a fast capture-for-review policy", () => {
    const step = {
      kind: "screenshot" as const,
      caption: "Settings",
      review: { mode: "later" as const, policy: "fast" as const },
    };
    assert.deepEqual(validateRecipeSteps([step]), [step]);
  });
  test("keeps named sequence phases and does not rewrite wait durations", () => {
    const steps = validateRecipeSteps([
      {
        kind: "screenshot",
        id: "interrupt",
        caption: "Survival",
        review: {
          mode: "later",
          policy: "sequence",
          phases: [
            { id: "before", caption: "Before airplane" },
            { id: "during", caption: "During airplane", intervalMs: 60_000 },
          ],
        },
      },
      { kind: "sleep", ms: 60_000 },
      {
        kind: "screenshot",
        id: "interrupt-after",
        caption: "After reconnect",
        review: {
          mode: "later",
          policy: "sequence",
          checkpointId: "interrupt",
          phase: "after",
        },
      },
    ]);
    assert.equal(steps[0] && steps[0].kind === "screenshot" && steps[0].review?.policy, "sequence");
    assert.equal(
      steps[0] && steps[0].kind === "screenshot" && steps[0].review?.phases?.[1]?.intervalMs,
      60_000,
    );
    assert.equal(steps[1] && steps[1].kind === "sleep" && steps[1].ms, 60_000);
    assert.equal(steps[2] && steps[2].kind === "screenshot" && steps[2].review?.phase, "after");
    assert.equal(
      steps[2] && steps[2].kind === "screenshot" && steps[2].review?.checkpointId,
      "interrupt",
    );
  });
  test("rejects a loading placeholder as the Sequence after phase", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "screenshot",
            caption: "Final response",
            review: {
              mode: "later",
              policy: "sequence",
              phase: "after",
              lookFor: "Working for 1s",
              phases: [{ id: "after", caption: "Working", lookFor: "Working for 1s" }],
            },
          },
        ]),
      /loading placeholder/u,
    );
  });
  test("rejects sequence without named phases instead of treating it as Stable", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "screenshot",
            caption: "Final screen",
            review: { mode: "later", policy: "sequence" },
          },
        ]),
      /named phases/u,
    );
  });
  test("retains complete reviewed external-effect provenance and rejects partial declarations", () => {
    const step = {
      kind: "tap" as const,
      target: { label: "Submit" },
      reviewedExternalEffects: {
        schemaVersion: 1 as const,
        effects: ["communication" as const],
        reviewedBy: "human:reviewer",
        reviewedAt: 10,
        reason: "This fixture sends a message.",
      },
    };
    assert.deepEqual(validateRecipeSteps([step]), [step]);
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            ...step,
            reviewedExternalEffects: { ...step.reviewedExternalEffects, reviewedBy: "" },
          },
        ]),
      /reviewedExternalEffects requires/u,
    );
  });
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
    const digest = "a".repeat(64);
    const documentOrigin = {
      index: 0,
      offsetY: 0,
      appendedHeight: 0,
      capturedAt: 123,
      width: 1080,
      height: 2340,
      screenshot: {
        id: "settings-origin-png",
        uri: `relay-evidence://${digest}`,
        sha256: digest,
        mime: "image/png" as const,
        bytes: 42,
      },
      accessibilityTree: {
        id: "settings-origin-tree",
        uri: `relay-evidence://${digest}`,
        sha256: digest,
        mime: "application/json" as const,
        bytes: 42,
      },
    };
    const documentOriginProof = {
      schemaVersion: 1 as const,
      method: "frozen-origin-match" as const,
      firstViewport: {
        screenshotSha256: digest,
        accessibilityTreeSha256: digest,
      },
      attestation: {
        id: "settings-origin-attestation",
        uri: `relay-evidence://${digest}`,
        sha256: digest,
        mime: "application/json" as const,
        bytes: 42,
      },
      authorization: {
        schemaVersion: 1 as const,
        issuer: "relay-local-capture" as const,
        signature: "s".repeat(43),
      },
    };
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
      () => validateRecipeSteps([{ ...step, maxScrolls: 13 }]),
      /maxScrolls must be an integer from 1 to 12/,
    );
    assert.throws(
      () => validateRecipeSteps([{ ...step, forceRecapture: "yes" }]),
      /forceRecapture must be a boolean/,
    );
    assert.deepEqual(
      validateRecipeSteps([
        { ...step, baselineTrust: "trusted", documentOrigin, documentOriginProof },
      ]),
      [{ ...step, baselineTrust: "trusted", documentOrigin, documentOriginProof }],
    );
    assert.throws(
      () => validateRecipeSteps([{ ...step, baselineTrust: "trusted", documentOrigin }]),
      /documentOriginProof must bind the frozen first viewport evidence/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            ...step,
            baselineTrust: "trusted",
            documentOrigin,
            documentOriginProof: {
              schemaVersion: 1,
              method: "frozen-origin-match",
              firstViewport: documentOriginProof.firstViewport,
            },
          },
        ]),
      /documentOriginProof must bind the frozen first viewport evidence/,
      "a raw/manual recipe cannot omit the immutable origin-attestation receipt",
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          { ...step, baselineTrust: "recapture-required", documentOrigin, documentOriginProof },
        ]),
      /documentOrigin requires a trusted baseline/,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            ...step,
            baselineTrust: "trusted",
            documentOrigin: {
              ...documentOrigin,
              screenshot: { ...documentOrigin.screenshot, uri: "relay-evidence://not-the-hash" },
            },
            documentOriginProof,
          },
        ]),
      /documentOrigin must be a complete first viewport/,
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
        ignoreRegions: [{ name: "reply body", x: 0.07, y: 0.125, width: 0.93, height: 0.68 }],
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
    const expectedScreen = out.find((step) => step.kind === "expect-screen");
    assert.deepEqual(
      expectedScreen?.kind === "expect-screen" ? expectedScreen.ignoreRegions : undefined,
      [{ name: "reply body", x: 0.07, y: 0.125, width: 0.93, height: 0.68 }],
    );
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
    assert.deepEqual(
      validateRecipeSteps([
        {
          kind: "expect-set",
          scope: { text: "Heavy" },
          labels: ["Fast", "Auto", "Expert", "Heavy"],
          extras: "allow",
        },
      ]),
      [
        {
          kind: "expect-set",
          scope: { text: "Heavy" },
          labels: ["Fast", "Auto", "Expert", "Heavy"],
          extras: "allow",
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

  it("keeps dest leftover skip and rejects an unknown step field", () => {
    assert.deepEqual(
      validateRecipeSteps([{ kind: "tap", target: { label: "Save" }, leftoverSkip: "dest" }]),
      [{ kind: "tap", target: { label: "Save" }, leftoverSkip: "dest" }],
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "tap", target: { label: "Save" }, mystery: true }]),
      /unknown field: mystery/u,
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "sleep", ms: 1, leftoverSkip: "origin" }]),
      /leftoverSkip must be "dest"/u,
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "screenshot", caption: "Home", mystery: true }]),
      /unknown field: mystery/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "expect", target: { label: "Save" }, condition: "visible", mystery: true },
        ]),
      /unknown field: mystery/u,
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "capture-surface", mystery: true }]),
      /unknown field: mystery/u,
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "tour", mystery: true }]),
      /unknown field: mystery/u,
    );
    assert.throws(
      () => validateRecipeSteps([{ kind: "tap", target: { label: "Save", mystery: true } }]),
      /target unknown field: mystery/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "tap",
            target: {
              label: "Save",
              point: { x: 1, y: 2, anchor: { horizontal: "left", vertical: "top", mystery: true } },
            },
          },
        ]),
      /target\.point\.anchor unknown field: mystery/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "sleep",
            ms: 10,
            when: { condition: "present", target: { label: "Save" }, mystery: true },
          },
        ]),
      /when unknown field: mystery/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "sleep",
            ms: 10,
            check: { id: "settings", title: "Settings", mystery: true },
          },
        ]),
      /check unknown field: mystery/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "sleep",
            ms: 10,
            check: { id: "settings", title: "Settings", cleanup: { mystery: true } },
          },
        ]),
      /check\.cleanup unknown field: mystery/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "sleep",
            ms: 10,
            check: {
              id: "settings",
              title: "Settings",
              cleanup: {
                recipeId: "sign-out",
                terminalScreenId: "home",
                onCancel: "skip",
                bindings: { password: "hunter2" },
              },
            },
          },
        ]),
      /secret reference/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          {
            kind: "sleep",
            ms: 10,
            check: {
              id: "settings",
              title: "Settings",
              transitionDependencies: [
                {
                  connectionId: "open",
                  originScreenId: "home",
                  destination: { kind: "screen", screenId: "settings", mystery: true },
                },
              ],
            },
          },
        ]),
      /destination unknown field: mystery/u,
    );
  });

  it("keeps a secret as a reference instead of a stored value", () => {
    assert.deepEqual(validateRecipeVariables({ password: "secret:member" }), {
      password: "secret:member",
    });
    assert.deepEqual(validateRecipeVariables({ account_tier: "Pro" }), { account_tier: "Pro" });
    assert.throws(() => validateRecipeVariables({ password: "hunter2" }), /secret reference/u);
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "module", recipeId: "login", bindings: { password: "hunter2" } },
        ]),
      /secret reference/u,
    );
    assert.throws(
      () =>
        validateRecipeSteps([{ kind: "type", text: "hunter2", target: { label: "Password" } }]),
      /secret reference/u,
    );
    assert.deepEqual(
      validateRecipeSteps([{ kind: "type", text: "{{password}}", target: { label: "Password" } }]),
      [{ kind: "type", text: "{{password}}", target: { label: "Password" } }],
    );
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "clipboard", action: "write", text: "hunter2" },
          { kind: "clipboard", action: "paste", target: { label: "Password" } },
        ]),
      /secret reference/u,
    );
    assert.equal(
      validateRecipeSteps([
        { kind: "clipboard", action: "write", text: "{{password}}" },
        { kind: "clipboard", action: "paste", target: { label: "Password" } },
      ]).length,
      2,
    );
    assert.throws(
      () => validateRecipeParameters([{ name: "password", default: "hunter2" }]),
      /secret reference/u,
    );
    assert.deepEqual(validateRecipeParameters([{ name: "password", default: "secret:member" }]), [
      { name: "password", default: "secret:member" },
    ]);
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
              onCancel: "run-if-controllable",
            },
          },
        },
      ])[0]?.check?.cleanup,
      {
        recipeId: "restore-kids-off",
        bindings: { locale: "en" },
        terminalScreenId: "kids-off",
        onCancel: "run-if-controllable",
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
      /check\.cleanup\.onCancel must be "run-if-controllable" or "skip"/u,
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

  it("accepts visual judges, offline, upload, background, and mobile-data", () => {
    const out = validateRecipeSteps([
      {
        kind: "wait-response",
        target: { text: "Assistant response" },
        maxMs: 8_000,
      },
      {
        kind: "evaluate-visual",
        criteria: ["Composer is empty after send"],
        threshold: 0.9,
        region: { x: 0, y: 0, width: 100, height: 80 },
      },
      { kind: "offline", state: "on" },
      { kind: "upload", file: "tests/fixtures/sample.pdf", target: { label: "Attach file" } },
      { kind: "app", action: "background", app: "ai.x.grok", backgroundMs: 1_000 },
      { kind: "settings", setting: "mobile-data", state: "off" },
      {
        kind: "identity-ignore",
        name: "reply body",
        region: { x: 80, y: 200, width: 900, height: 1400 },
      },
    ]);
    assert.equal(out.length, 7);
    assert.equal(out[0]?.kind === "wait-response" ? out[0].maxMs : undefined, 8_000);
    assert.equal(out[1]?.kind, "evaluate-visual");
    assert.equal(out[4]?.kind === "app" ? out[4].backgroundMs : undefined, 1_000);
    assert.equal(out[6]?.kind, "identity-ignore");
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
    assert.equal(
      describeRecipeStep({
        kind: "screenshot",
        caption: "Arabic account settings",
        review: { mode: "later", lookFor: "Save is visible" },
      }),
      "Capture for review · Arabic account settings",
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
      describeRecipeStep({
        kind: "evaluate-visual",
        criteria: ["Empty composer"],
      }),
      "Evaluate screenshot against 1 visual criterion",
    );
    assert.equal(
      describeRecipeStep({
        kind: "identity-ignore",
        name: "reply body",
        region: { x: 80, y: 200, width: 900, height: 1400 },
      }),
      "Ignore reply body for identity",
    );
    assert.equal(describeRecipeStep({ kind: "offline", state: "on" }), "Go offline");
    assert.equal(
      describeRecipeStep({ kind: "upload", file: "tests/fixtures/sample.pdf" }),
      "Upload tests/fixtures/sample.pdf",
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
    assert.equal(
      describeRecipeStep({
        kind: "expect-set",
        identifierPrefix: "menu.",
        labels: ["Camera", "Files"],
        extras: "allow",
      }),
      "Check options include Camera, Files",
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
    assert.deepEqual(glyphsForStep({ kind: "evaluate-visual", criteria: ["x"] }), ["ai", "ok"]);
    assert.deepEqual(
      glyphsForStep({
        kind: "identity-ignore",
        region: { x: 0, y: 0, width: 10, height: 10 },
      }),
      ["ok"],
    );
    assert.deepEqual(glyphsForStep({ kind: "offline", state: "off" }), ["tap"]);
    assert.deepEqual(glyphsForStep({ kind: "upload", file: "a.png" }), ["store"]);
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

describe("grok web daily seed YAML", () => {
  it("opens grok.com by URL instead of the native package", async () => {
    const source = await readFile(
      new URL("../../../tests/grok-web-open-composer.relay.yaml", import.meta.url),
      "utf8",
    );
    const recipe = parseRecipeYaml(source);
    const open = recipe.steps[0];
    assert.equal(open?.kind, "app");
    if (open?.kind !== "app") throw new Error("expected app open");
    assert.equal(open.url, "{{grok_url}}");
    assert.equal(open.app, undefined);
  });

  it("modules the seed pack without Settings navigation", async () => {
    const source = await readFile(
      new URL("../../../tests/grok-web-daily.relay.yaml", import.meta.url),
      "utf8",
    );
    const recipe = parseRecipeYaml(source);
    assert.deepEqual(
      recipe.steps.filter((step) => step.kind === "module").map((step) => step.recipeId),
      ["grok-web-open-composer", "grok-web-send-hello", "grok-web-new-chat"],
    );
    assert.doesNotMatch(source, /Preferences|Preferred Language|App Language/u);
  });
});
