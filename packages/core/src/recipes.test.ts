import { describe, it, before, after } from "node:test";
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
} from "./recipes.js";
import { formatRecipeYaml, parseRecipeYaml, recipeYamlPath } from "./recipe-yaml.js";

// Isolate the on-disk store in a temp dir for the whole suite.
let tmp = "";
before(async () => {
  tmp = await mkdtemp(join(tmpdir(), "recipes-test-"));
  process.env.GROK_DEVICE_RECIPES_DIR = tmp;
  process.env.RELAY_TESTS_DIR = join(tmp, "tests");
});
after(async () => {
  delete process.env.GROK_DEVICE_RECIPES_DIR;
  delete process.env.RELAY_TESTS_DIR;
  await rm(tmp, { recursive: true, force: true });
});

describe("recipe store roundtrip", () => {
  it("save → list (custom after builtins) → read → delete → gone", async () => {
    const saved = await saveRecipe({
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

  it("persists recorder screenshots outside recipe JSON", async () => {
    const saved = await saveRecipe({ title: "Evidence", steps: [] });
    const image = Buffer.from("recorded-image");
    const result = await saveRecipeEvidenceImage({
      recipeId: saved.id,
      evidenceId: "ev-test",
      base64: image.toString("base64"),
    });
    assert.equal(result.bytes, image.byteLength);
    assert.deepEqual(await readRecipeEvidenceImage(saved.id, "ev-test"), image);
    await deleteRecipe(saved.id);
    assert.equal(await readRecipeEvidenceImage(saved.id, "ev-test"), null);
  });

  it("writes new custom recipes as deterministic, editable YAML", async () => {
    const saved = await saveRecipe({
      title: "YAML smoke",
      variables: { account_tier: "Pro" },
      steps: [{ kind: "type", text: "{{account_tier}}" }],
    });
    const source = await readFile(recipeYamlPath(testsRoot(), saved.id), "utf8");
    assert.match(source, /^schemaVersion: 1/m);
    assert.match(source, /^name: YAML smoke/m);
    assert.match(source, /account_tier: Pro/);
    const read = await readRecipe(saved.id);
    assert.deepEqual(read?.variables, { account_tier: "Pro" });
    assert.equal(read?.steps[0]?.kind, "type");
  });

  it("keeps legacy JSON readable but lets YAML with the same id win", async () => {
    const saved = await saveRecipe({ id: "custom-precedence", title: "YAML version", steps: [] });
    await writeFile(
      join(tmp, "custom-precedence.json"),
      JSON.stringify({ ...saved, title: "Legacy JSON version" }),
      "utf8",
    );
    assert.equal((await readRecipe(saved.id))?.title, "YAML version");
  });

  it("lists YAML history when a git-native test is edited", async () => {
    const first = await saveRecipe({
      id: "history-yaml",
      title: "First draft",
      steps: [{ kind: "sleep", ms: 10 }],
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    await saveRecipe({
      id: first.id,
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

describe("recipe YAML", () => {
  it("round-trips through a stable, schema-versioned source format", () => {
    const recipe = parseRecipeYaml(
      `schemaVersion: 1\nid: yaml-roundtrip\nname: YAML roundtrip\nsteps:\n  - kind: sleep\n    ms: 10\n`,
    );
    const output = formatRecipeYaml(recipe);
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
      () => parseRecipeYaml(`schemaVersion: 1\nid: extra\nname: Extra\nsteps: []\nunknown: true\n`),
      /unknown Relay test field/i,
    );
  });
});

describe("packaged recipe CRUD", () => {
  it("allows a packaged recipe to be edited in place", async () => {
    const saved = await saveRecipe({ id: "logout", title: "Custom logout", steps: [] });
    assert.equal(saved.id, "logout");
    assert.equal(saved.source, "custom");
    assert.equal((await readRecipe("logout"))?.title, "Custom logout");
  });

  it("allows a packaged recipe to be deleted", async () => {
    await deleteRecipe("logout");
    assert.equal(await readRecipe("logout"), null);
    assert.equal(
      (await listRecipes()).some((recipe) => recipe.id === "logout"),
      false,
    );
  });
});

describe("validateRecipeSteps", () => {
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
        target: { ref: "@e1", point: { x: 10, y: 20 } },
        evidence: {
          id: "ev-1",
          recordedAt: 123,
          serial: "pixel",
          deviceBounds: { width: 1080, height: 2400 },
          pointer: { x: 10, y: 20 },
          node: { label: "Sign in", role: "button", ref: "@e1" },
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
          },
        },
      },
    ]);
    assert.equal(step?.kind, "tap");
    assert.equal(step?.kind === "tap" ? step.evidence?.node?.label : undefined, "Sign in");
    assert.equal(
      step?.kind === "tap" ? step.evidence?.candidates?.[0]?.strategy : undefined,
      "label",
    );
  });

  it("accepts every step kind with valid fields", () => {
    const steps = [
      { kind: "tap", target: { ref: "@e1" } },
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
    assert.equal(out[3]!.kind, "swipe");
    assert.equal(out[15]!.kind, "flow");
    assert.equal((out[13] as { reason?: string }).reason, "consent");
    assert.deepEqual((out[13] as { verifyAfter?: unknown }).verifyAfter, {
      target: { label: "Welcome" },
      timeoutMs: 15_000,
    });
  });

  it("rejects tap with empty target, naming the step index", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "tap", target: {} }]),
      /step 1: tap requires target/,
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
      /pause\.verifyAfter\.target must have ref, label, or text/,
    );
  });

  it("rejects wait-for with point-only target", () => {
    assert.throws(
      () => validateRecipeSteps([{ kind: "wait-for", target: { point: { x: 1, y: 2 } } }]),
      /step 1: wait-for target must have ref\/label\/text/,
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

  it("rejects expect with point-only target", () => {
    assert.throws(
      () =>
        validateRecipeSteps([
          { kind: "expect", target: { point: { x: 1, y: 2 } }, condition: "visible" },
        ]),
      /step 1: expect target must have ref\/label\/text/,
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

  it("accepts device, clipboard, observability, and reusable test steps", () => {
    const out = validateRecipeSteps([
      { kind: "long-press", target: { label: "Copy" }, durationMs: 700 },
      { kind: "clipboard", action: "write", text: "hello" },
      { kind: "clipboard", action: "read", expect: "hello", match: "exact" },
      { kind: "app", action: "switcher" },
      { kind: "app", action: "open", url: "myapp://settings" },
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
    assert.equal(out.length, 14);
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
  });

  it("glyphsForStep maps each kind", () => {
    assert.deepEqual(glyphsForStep({ kind: "tap", target: { ref: "x" } }), ["tap"]);
    assert.deepEqual(glyphsForStep({ kind: "type", text: "x" }), ["type"]);
    assert.deepEqual(glyphsForStep({ kind: "scroll", direction: "down" }), ["swipe"]);
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
    assert.deepEqual(glyphsForStep({ kind: "pause", message: "x" }), ["wait"]);
    assert.deepEqual(glyphsForStep({ kind: "screenshot" }), ["shot"]);
    assert.deepEqual(glyphsForStep({ kind: "flow", flow: "logout" }), ["store"]);
  });
});
