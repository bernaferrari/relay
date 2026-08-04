import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  refMatchesRecordedTarget,
  resolveRecipeStep,
  runRecipeStep as runRecipeStepWithoutContext,
} from "./recipe-runner.js";
import type { Device } from "./device.js";
import type { TestJob } from "./session.js";
import { registerEvaluationProvider } from "./evaluation.js";
import { saveRecipe } from "./recipes.js";
import { clearControl, requestResume } from "./control.js";
import { runWithTargetContext } from "./target-context.js";
import { observeScreenIdentity } from "./screen-identity.js";

const runRecipeStep: typeof runRecipeStepWithoutContext = (...args) =>
  runWithTargetContext({ kind: "device", platform: "android", serial: "recipe-runner-test" }, () =>
    runRecipeStepWithoutContext(...args),
  );
const runIosRecipeStep: typeof runRecipeStepWithoutContext = (...args) =>
  runWithTargetContext({ kind: "device", platform: "ios", serial: "recipe-runner-ios-test" }, () =>
    runRecipeStepWithoutContext(...args),
  );

// Keep controlled() single-attempt so error paths are fast and deterministic.
before(() => {
  process.env.RELAY_RETRY_ATTEMPTS = "1";
});
after(() => {
  delete process.env.RELAY_RETRY_ATTEMPTS;
});

/**
 * Minimal stub covering the SDK surface the expect step touches:
 * interactions.find (presence probe) and command.wait (waitFor + sleep).
 */
function stubDevice(impl: {
  find?: () => Promise<unknown>;
  press?: (options: unknown) => Promise<unknown>;
  longPress?: (options: unknown) => Promise<unknown>;
  fill?: (options: unknown) => Promise<unknown>;
  type?: (options: unknown) => Promise<unknown>;
  swipe?: (options: unknown) => Promise<unknown>;
  clipboard?: (options: unknown) => Promise<unknown>;
  wait?: () => Promise<unknown>;
  snapshot?: () => Promise<unknown>;
}): Device {
  return {
    interactions: {
      find: impl.find ?? (() => Promise.resolve({})),
      press: impl.press ?? (() => Promise.resolve({})),
      longPress: impl.longPress ?? (() => Promise.resolve({})),
      fill: impl.fill ?? (() => Promise.resolve({})),
      type: impl.type ?? (() => Promise.resolve({})),
      swipe: impl.swipe ?? (() => Promise.resolve({})),
    },
    command: {
      wait: impl.wait ?? (() => Promise.resolve({})),
      ...(impl.clipboard ? { clipboard: impl.clipboard } : {}),
    },
    capture: { snapshot: impl.snapshot ?? (() => Promise.resolve({ nodes: [] })) },
  } as unknown as Device;
}

const noLog = { log: () => {} };

describe("runRecipeStep tap gestures", () => {
  it("does not tap a reused physical-iOS element reference", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({ nodes: [{ ref: "@e12", label: "Different control", enabled: true }] }),
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });

    await runIosRecipeStep(
      device,
      { kind: "tap", target: { ref: "@e12", label: "New conversation" } },
      noLog,
    );

    assert.deepEqual(presses, [
      {
        platform: "ios",
        udid: "recipe-runner-ios-test",
        selector: 'label="New conversation"',
      },
    ]);
  });

  it("validates recorded refs against stable semantics", () => {
    assert.equal(
      refMatchesRecordedTarget(
        [{ ref: "@e3", identifier: "new-chat", label: "New conversation" }],
        { ref: "e3", identifier: "new-chat", label: "New conversation" },
      ),
      true,
    );
    assert.equal(
      refMatchesRecordedTarget([{ ref: "@e3", label: "Share" }], {
        ref: "@e3",
        label: "New conversation",
      }),
      false,
    );
  });

  it("uses a stable accessibility identifier before weaker fallbacks", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: {
          identifier: "chat_text_input",
          label: "Ask anything",
          point: { x: 120, y: 220 },
        },
      },
      noLog,
    );

    assert.deepEqual(presses, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        selector: 'id="chat_text_input"',
      },
    ]);
  });

  it("falls back from a stale native label selector to the visible snapshot node", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      find: async () => {
        throw new Error("label selector unavailable");
      },
      press: async (options) => {
        presses.push(options);
        if ((options as { selector?: string }).selector === 'label="New conversation"') {
          throw new Error("native label unavailable");
        }
        return {};
      },
      snapshot: async () => ({
        nodes: [
          {
            label: "New conversation",
            role: "button",
            hittable: true,
            rect: { x: 100, y: 200, width: 120, height: 48 },
          },
        ],
      }),
    });

    await runRecipeStep(device, { kind: "tap", target: { label: "New conversation" } }, noLog);

    assert.deepEqual(presses, [
      { platform: "android", serial: "recipe-runner-test", selector: 'label="New conversation"' },
      { platform: "android", serial: "recipe-runner-test", x: 160, y: 224 },
    ]);
  });

  it("uses the driver's native repeated gesture for multi-taps", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });
    await runRecipeStep(
      device,
      {
        kind: "tap",
        gesture: "multi",
        tapCount: 4,
        intervalMs: 140,
        target: { point: { x: 120, y: 240 } },
      },
      noLog,
    );
    assert.deepEqual(presses, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        x: 120,
        y: 240,
        count: 4,
        intervalMs: 140,
      },
    ]);
  });

  it("uses a native double-tap so text selection is not two unrelated taps", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });
    await runRecipeStep(
      device,
      {
        kind: "tap",
        gesture: "multi",
        tapCount: 2,
        intervalMs: 120,
        target: { identifier: "message-field" },
      },
      noLog,
    );
    assert.deepEqual(presses, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        selector: 'id="message-field"',
        count: 2,
        intervalMs: 120,
        doubleTap: true,
      },
    ]);
  });

  it("preserves right and bottom offsets when the runtime device is larger", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
      snapshot: () =>
        Promise.resolve({ nodes: [{ rect: { x: 0, y: 0, width: 200, height: 400 } }] }),
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: {
          point: {
            x: 90,
            y: 180,
            anchor: { horizontal: "right", vertical: "bottom" },
            referenceBounds: { width: 100, height: 200 },
          },
        },
      },
      noLog,
    );

    assert.deepEqual(presses, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        x: 190,
        y: 380,
      },
    ]);
  });

  it("holds the same target for the configured duration", async () => {
    const holds: unknown[] = [];
    const device = stubDevice({
      longPress: (options) => {
        holds.push(options);
        return Promise.resolve({});
      },
    });
    await runRecipeStep(
      device,
      { kind: "tap", gesture: "hold", durationMs: 900, target: { ref: "@e53" } },
      noLog,
    );
    assert.equal(holds.length, 1);
    assert.deepEqual(holds[0], {
      platform: "android",
      serial: "recipe-runner-test",
      ref: "@e53",
      durationMs: 900,
    });
  });
});

describe("runRecipeStep text entry", () => {
  it("uses the native replacement adapter for non-Android fields", async () => {
    const fills: unknown[] = [];
    const types: unknown[] = [];
    const device = stubDevice({
      fill: (options) => {
        fills.push(options);
        return Promise.resolve({});
      },
      type: (options) => {
        types.push(options);
        return Promise.resolve({});
      },
    });
    await runIosRecipeStep(
      device,
      {
        kind: "type",
        mode: "replace",
        text: "",
        target: { identifier: "message-field" },
      },
      noLog,
    );
    assert.deepEqual(fills, [
      {
        platform: "ios",
        udid: "recipe-runner-ios-test",
        selector: 'id="message-field"',
        text: "x",
      },
    ]);
    assert.deepEqual(types, [
      {
        platform: "ios",
        udid: "recipe-runner-ios-test",
        text: "\b",
      },
    ]);
  });
});

describe("runRecipeStep swipe", () => {
  it("resolves the pinned start and end independently on a larger device", async () => {
    const swipes: unknown[] = [];
    const device = stubDevice({
      swipe: (options) => {
        swipes.push(options);
        return Promise.resolve({});
      },
      snapshot: () =>
        Promise.resolve({ nodes: [{ rect: { x: 0, y: 0, width: 200, height: 400 } }] }),
    });

    await runRecipeStep(
      device,
      {
        kind: "swipe",
        from: {
          x: 10,
          y: 20,
          anchor: { horizontal: "left", vertical: "top" },
          referenceBounds: { width: 100, height: 200 },
        },
        to: {
          x: 90,
          y: 180,
          anchor: { horizontal: "right", vertical: "bottom" },
          referenceBounds: { width: 100, height: 200 },
        },
        durationMs: 330,
      },
      noLog,
    );

    assert.deepEqual(swipes, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        from: { x: 10, y: 20 },
        to: { x: 190, y: 380 },
        durationMs: 330,
      },
    ]);
  });
});

describe("resolveRecipeStep", () => {
  it("substitutes variables in nested targets and action text", () => {
    assert.deepEqual(
      resolveRecipeStep(
        {
          kind: "clipboard",
          action: "read",
          expect: "Hello {{user_name}}",
          note: "run {{run_id}}",
        },
        { user_name: "Ada", run_id: "42" },
      ),
      {
        kind: "clipboard",
        action: "read",
        expect: "Hello Ada",
        note: "run 42",
      },
    );
  });

  it("keeps missing placeholders visible", () => {
    assert.equal(
      (resolveRecipeStep({ kind: "type", text: "{{missing}}" }, {}) as { text: string }).text,
      "{{missing}}",
    );
  });
});

describe("runRecipeStep clipboard", () => {
  it("uses one atomic command for system paste and copy", async () => {
    const calls: unknown[] = [];
    const device = stubDevice({
      clipboard: (options) => {
        calls.push(options);
        const action = (options as { action: string }).action;
        return Promise.resolve({
          action,
          text: "hello\nworld",
          textLength: 11,
          message: action === "paste" ? "Clipboard pasted" : "Clipboard copied",
        });
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "clipboard",
        action: "paste",
        text: "hello\nworld",
        target: { identifier: "message" },
      },
      noLog,
    );
    await runRecipeStep(
      device,
      {
        kind: "clipboard",
        action: "copy",
        target: { identifier: "message" },
        expect: "hello\nworld",
      },
      noLog,
    );

    assert.deepEqual(calls, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        action: "paste",
        text: "hello\nworld",
        selectorKey: "id",
        selectorValue: "message",
      },
      {
        platform: "android",
        serial: "recipe-runner-test",
        action: "copy",
        selectorKey: "id",
        selectorValue: "message",
        expectedText: "hello\nworld",
      },
    ]);
  });

  it("reports safe mismatch diagnostics without disclosing clipboard contents", async () => {
    const observed = "private-observed-value";
    const expected = "private-expected-value";
    const device = stubDevice({
      clipboard: () => Promise.resolve({ action: "read", text: observed }),
    });

    await assert.rejects(
      runRecipeStep(device, { kind: "clipboard", action: "read", expect: expected }, noLog),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.match(
          error.message,
          /observed 22 chars, sha256:[0-9a-f]{12}; expected 22 chars, sha256:[0-9a-f]{12}/,
        );
        assert.equal(error.message.includes(observed), false);
        assert.equal(error.message.includes(expected), false);
        return true;
      },
    );
  });
});

describe("runRecipeStep optional policy", () => {
  it("records a skipped best-effort action without hiding cancellation", async () => {
    const logs: string[] = [];
    const job = { artifacts: [] } as unknown as TestJob;
    const device = stubDevice({ press: () => Promise.reject(new Error("not on this screen")) });

    await runRecipeStep(
      device,
      { kind: "tap", target: { identifier: "sidebar.close" }, optional: true },
      { log: (line) => logs.push(line), job },
    );

    assert.match(logs[0] ?? "", /optional tap: skipped/);
    assert.equal(job.artifacts[0]?.kind, "optional-step-skipped");
  });
});

describe("runRecipeStep conditional policy", () => {
  it("skips a step when its present condition is false", async () => {
    const logs: string[] = [];
    const job = { artifacts: [] } as unknown as TestJob;
    let pressed = false;
    const device = stubDevice({
      find: () => Promise.reject(new Error("No match")),
      press: () => {
        pressed = true;
        return Promise.resolve();
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "sidebar.open" },
        when: { target: { label: "Compose" }, condition: "present" },
      },
      { log: (line) => logs.push(line), job },
    );

    assert.equal(pressed, false);
    assert.match(logs[0] ?? "", /conditional tap: skipped/);
    assert.equal(job.artifacts[0]?.kind, "conditional-step-skipped");
  });

  it("runs a step when its absent condition is true", async () => {
    let pressed = false;
    const device = stubDevice({
      find: () => Promise.reject(new Error("No match")),
      press: () => {
        pressed = true;
        return Promise.resolve();
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "sidebar.open" },
        when: { target: { label: "Compose" }, condition: "absent" },
      },
      noLog,
    );

    assert.equal(pressed, true);
  });
});

describe("runRecipeStep expect — error classification", () => {
  it('gone passes when find reports "No match" (element absent)', async () => {
    const device = stubDevice({
      find: () => Promise.reject(new Error('No match for query "Welcome"')),
    });
    await runRecipeStep(
      device,
      { kind: "expect", target: { text: "Welcome" }, condition: "gone" },
      noLog,
    );
  });

  it('gone treats the SDK phrase "did not match" as an absent element', async () => {
    const device = stubDevice({
      find: () => Promise.reject(new Error("find did not match any element")),
    });
    await runRecipeStep(
      device,
      { kind: "expect", target: { identifier: "later" }, condition: "gone" },
      noLog,
    );
  });

  it("gone propagates infrastructure errors instead of passing or asserting", async () => {
    const device = stubDevice({
      find: () => Promise.reject(new Error("no active session — run doctor")),
    });
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          { kind: "expect", target: { text: "Welcome" }, condition: "gone" },
          noLog,
        ),
      (err: Error) => {
        assert.match(err.message, /no active session/);
        assert.doesNotMatch(err.message, /still visible/);
        return true;
      },
    );
  });

  it("visible converts a genuine wait timeout into the assertion message", async () => {
    const device = stubDevice({
      wait: () => Promise.reject(new Error('Timed out waiting for text "Sign in"')),
    });
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          { kind: "expect", target: { label: "Sign in" }, condition: "visible" },
          noLog,
        ),
      /expect: "label "Sign in"" not visible after 5s/,
    );
  });

  it("visible propagates infrastructure errors with their original message", async () => {
    const device = stubDevice({
      wait: () => Promise.reject(new Error("no active session — run doctor")),
    });
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          { kind: "expect", target: { label: "Sign in" }, condition: "visible" },
          noLog,
        ),
      (err: Error) => {
        assert.match(err.message, /no active session/);
        assert.doesNotMatch(err.message, /not visible after/);
        return true;
      },
    );
  });
});

describe("runRecipeStep expect-set", () => {
  const grokMenu = [
    {
      index: 1,
      type: "Button",
      identifier: "ask.toolbar.add.menu.camera",
      label: 'LocalizedStringKey(key: "Camera", hasFormatting: false, arguments: [])',
    },
    { index: 2, parentIndex: 1, type: "Image", label: "grok-camera" },
    { index: 3, parentIndex: 1, type: "StaticText", label: "Camera" },
    {
      index: 4,
      type: "Button",
      identifier: "ask.toolbar.add.menu.photos",
      label: 'LocalizedStringKey(key: "Photo or Video", hasFormatting: false, arguments: [])',
    },
    { index: 5, parentIndex: 4, type: "StaticText", label: "Photo or Video" },
    {
      index: 6,
      type: "Button",
      identifier: "ask.toolbar.add.menu.files",
      label: "Files",
    },
  ];

  it("matches the complete visible option set regardless of order", async () => {
    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: grokMenu }) }),
      {
        kind: "expect-set",
        identifierPrefix: "ask.toolbar.add.menu.",
        labels: ["Photo or Video", "Files", "Camera"],
        timeoutMs: 0,
      },
      noLog,
    );
  });

  it("reports missing and unexpected options together", async () => {
    await assert.rejects(
      () =>
        runRecipeStep(
          stubDevice({ snapshot: () => Promise.resolve({ nodes: grokMenu }) }),
          {
            kind: "expect-set",
            identifierPrefix: "ask.toolbar.add.menu.",
            labels: ["Camera", "Gallery"],
            timeoutMs: 0,
          },
          noLog,
        ),
      /missing: Gallery; unexpected: Files, Photo or Video/,
    );
  });
});

describe("runRecipeStep expect-screen", () => {
  const nodes = [{ role: "button", label: "Continue", visibleToUser: true }];
  const fingerprint = observeScreenIdentity(nodes).fingerprint;

  it("passes when normalized visible semantics reach the expected destination", async () => {
    const lines: string[] = [];
    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
      { kind: "expect-screen", screenId: "home", screenTitle: "Home", fingerprint },
      { log: (line) => lines.push(line) },
    );
    assert.deepEqual(lines, ["screen: reached Home"]);
  });

  it("fails with both fingerprints when a route reaches a different screen", async () => {
    await assert.rejects(
      () =>
        runRecipeStep(
          stubDevice({
            snapshot: () => Promise.resolve({ nodes: [{ role: "button", label: "Try again" }] }),
          }),
          { kind: "expect-screen", screenId: "home", screenTitle: "Home", fingerprint },
          { ...noLog, observeVisualFingerprint: () => Promise.resolve("c".repeat(64)) },
        ),
      /reached a different screen instead of "Home"/,
    );
  });

  it("accepts a visual alias when native semantics cannot identify the screen", async () => {
    const visualFingerprint = "b".repeat(64);
    const lines: string[] = [];
    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: [] }) }),
      {
        kind: "expect-screen",
        screenId: "canvas",
        screenTitle: "Canvas",
        fingerprint: "a".repeat(64),
        aliases: [visualFingerprint],
      },
      {
        log: (line) => lines.push(line),
        observeVisualFingerprint: () => Promise.resolve(visualFingerprint),
      },
    );
    assert.deepEqual(lines, ["screen: reached Canvas"]);
  });

  it("accepts an approved semantic variant when dynamic body content changes", async () => {
    const approved = observeScreenIdentity([
      { role: "heading", label: "Conversation", identifier: "chat.top" },
      { role: "button", label: "Copy message", identifier: "chat.copy" },
      { role: "text", label: "First generated answer" },
    ]);
    const current = [
      { role: "heading", label: "Conversation", identifier: "chat.top" },
      { role: "button", label: "Copy message", identifier: "chat.copy" },
      { role: "text", label: "A different generated answer" },
    ];
    const lines: string[] = [];

    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: current }) }),
      {
        kind: "expect-screen",
        screenId: "conversation",
        screenTitle: "Conversation",
        fingerprint: "a".repeat(64),
        observations: [approved],
      },
      { log: (line) => lines.push(line) },
    );

    assert.deepEqual(lines, ["screen: reached Conversation"]);
  });
});

describe("runRecipeStep conversational evidence", () => {
  function job(): TestJob {
    return { resolvedInputs: {}, artifacts: [] } as unknown as TestJob;
  }

  it("refuses network bodies without the frozen workspace consent", async () => {
    const owner = job();
    await assert.rejects(
      () =>
        runRecipeStep(
          stubDevice({}),
          { kind: "network", action: "dump", include: "all" },
          { log: () => {}, job: owner },
        ),
      /network body capture requires consent/,
    );
  });

  it("extracts accessible response content into a frozen run variable", async () => {
    const owner = job();
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [{ ref: "@answer", label: "Assistant response", value: "Paris is in France." }],
        }),
    });
    await runRecipeStep(
      device,
      { kind: "extract", as: "response", target: { ref: "@answer" }, role: "assistant" },
      { log: () => {}, job: owner },
    );
    assert.equal(owner.resolvedInputs.response, "Assistant response\nParis is in France.");
    assert.equal(owner.artifacts[0]?.kind, "conversation-turn");
  });

  it("extracts an editable field's value without mixing in its placeholder label", async () => {
    const owner = job();
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              type: "TextView",
              identifier: "message-field",
              label: "New Message",
              value: "NEW",
            },
          ],
        }),
    });
    await runRecipeStep(
      device,
      { kind: "extract", as: "draft", target: { identifier: "message-field" } },
      { log: () => {}, job: owner },
    );
    assert.equal(owner.resolvedInputs.draft, "NEW");
  });

  it("extracts an empty editable field as empty text rather than its placeholder", async () => {
    const owner = job();
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              type: "TextView",
              identifier: "message-field",
              label: "New Message",
            },
          ],
        }),
    });
    await runRecipeStep(
      device,
      { kind: "extract", as: "draft", target: { identifier: "message-field" } },
      { log: () => {}, job: owner },
    );
    assert.equal(owner.resolvedInputs.draft, "");
  });

  it("replays extraction and assertions with an ephemeral authoring context", async () => {
    const variables: Record<string, string> = {};
    const artifacts: TestJob["artifacts"] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [{ ref: "@answer", label: "hello" }] }),
    });

    await runRecipeStep(
      device,
      { kind: "extract", as: "response", target: { ref: "@answer" }, role: "assistant" },
      { log: () => {}, variables, artifacts },
    );
    await runRecipeStep(
      device,
      { kind: "assert-content", input: "response", expected: "hello", match: "exact" },
      { log: () => {}, variables, artifacts },
    );

    assert.equal(variables.response, "hello");
    assert.deepEqual(
      artifacts.map((artifact) => artifact.kind),
      ["conversation-turn", "content-assertion"],
    );
  });

  it("waits for a human checkpoint and records the handoff", async () => {
    const owner = {
      id: "human-checkpoint-test",
      status: "running",
      resolvedInputs: {},
      artifacts: [],
    } as unknown as TestJob;
    try {
      const pending = runRecipeStep(
        stubDevice({}),
        {
          kind: "pause",
          message: "Approve the Okta sign-in on the device",
          reason: "consent",
          resumeLabel: "Approved",
          timeoutMs: 5_000,
          verifyAfter: { target: { label: "Welcome" }, timeoutMs: 2_000 },
        },
        { log: () => {}, job: owner },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.deepEqual(owner.waitingFor, {
        kind: "human",
        message: "Approve the Okta sign-in on the device",
        reason: "consent",
        resumeLabel: "Approved",
        since: owner.waitingFor?.since,
        timeoutMs: 5_000,
        verifyAfter: { target: { label: "Welcome" }, condition: "visible", timeoutMs: 2_000 },
      });
      requestResume(owner.id);
      await pending;
      assert.equal(owner.waitingFor, undefined);
      assert.equal(owner.artifacts[0]?.kind, "human-intervention-requested");
      assert.equal(owner.artifacts[1]?.kind, "human-intervention-completed");
      assert.equal(owner.artifacts[2]?.kind, "human-intervention-verified");
    } finally {
      clearControl(owner.id);
    }
  });

  it("times out an abandoned human checkpoint without leaving a waiter behind", async () => {
    const owner = {
      id: "human-checkpoint-timeout-test",
      status: "running",
      resolvedInputs: {},
      artifacts: [],
    } as unknown as TestJob;
    try {
      await assert.rejects(
        () =>
          runRecipeStep(
            stubDevice({}),
            { kind: "pause", message: "Approve the sign-in", reason: "consent", timeoutMs: 25 },
            { log: () => {}, job: owner },
          ),
        /human checkpoint timed out/,
      );
      assert.equal(owner.waitingFor, undefined);
    } finally {
      clearControl(owner.id);
    }
  });

  it("records deterministic content assertions", async () => {
    const owner = job();
    owner.resolvedInputs.response = "Paris is in France.";
    await runRecipeStep(
      stubDevice({}),
      { kind: "assert-content", input: "response", expected: "France", match: "contains" },
      { log: () => {}, job: owner },
    );
    assert.deepEqual(owner.artifacts[0]?.data, {
      input: "response",
      expected: "France",
      match: "contains",
      passed: true,
    });
  });

  it("classifies independent judge disagreement as uncertain", async () => {
    const unregisterFirst = registerEvaluationProvider({
      id: "judge-pass",
      evaluate: async () => ({
        status: "pass",
        confidence: 0.95,
        score: 1,
        summary: "meets intent",
        criteria: [],
        provider: "judge-pass",
        model: "pass-v1",
        evaluatedAt: Date.now(),
      }),
    });
    const unregisterSecond = registerEvaluationProvider({
      id: "judge-fail",
      evaluate: async () => ({
        status: "fail",
        confidence: 0.9,
        score: 0,
        summary: "misses intent",
        criteria: [],
        provider: "judge-fail",
        model: "fail-v1",
        evaluatedAt: Date.now(),
      }),
    });
    const owner = job();
    owner.resolvedInputs.response = "Paris is in France.";
    try {
      await assert.rejects(
        () =>
          runRecipeStep(
            stubDevice({}),
            {
              kind: "evaluate-semantic",
              input: "response",
              criteria: ["Correctly locate Paris"],
              provider: "judge-pass",
              requireAgreement: true,
              secondProvider: "judge-fail",
            },
            { log: () => {}, job: owner },
          ),
        /judge uncertain: judges disagree/,
      );
      assert.equal(owner.artifacts.at(-1)?.kind, "judge-consensus");
    } finally {
      unregisterFirst();
      unregisterSecond();
    }
  });

  it("runs safe variable scripts and records the transform", async () => {
    const owner = job();
    owner.resolvedInputs.source = "Ada";
    await runRecipeStep(
      stubDevice({}),
      {
        kind: "script",
        source: "copy user = source\nset greeting = Hello Ada\nassert greeting contains Hello",
      },
      { log: () => {}, job: owner },
    );
    assert.equal(owner.resolvedInputs.user, "Ada");
    assert.equal(owner.resolvedInputs.greeting, "Hello Ada");
    assert.equal(owner.artifacts.at(-1)?.kind, "variable-script");
  });

  it("records branch decisions that continue without an alternate path", async () => {
    const owner = job();
    owner.resolvedInputs.response = "Try again";
    await runRecipeStep(
      stubDevice({}),
      {
        kind: "branch",
        input: "response",
        operator: "contains",
        expected: "success",
        thenRecipeId: "success-path",
      },
      { log: () => {}, job: owner },
    );
    assert.deepEqual(owner.artifacts.at(-1)?.data, {
      input: "response",
      operator: "contains",
      expected: "success",
      matched: false,
      recipeId: undefined,
    });
  });

  it("uses recorded locator fallbacks without rewriting the saved test", async () => {
    const owner = job();
    const used: unknown[] = [];
    await runRecipeStep(
      stubDevice({
        press: async (options) => {
          used.push(options);
          if ((options as { ref?: string }).ref) throw new Error("stale ref");
          return {};
        },
      }),
      {
        kind: "tap",
        target: { ref: "@old" },
        evidence: {
          id: "evidence",
          recordedAt: Date.now(),
          candidates: [
            {
              strategy: "label",
              label: "Sign in",
              source: "element",
              confidence: "high",
              target: { label: "Sign in" },
            },
          ],
        },
      },
      { log: () => {}, job: owner },
    );
    assert.equal(used.length, 2);
    const heal = owner.artifacts.at(-1);
    assert.equal(heal?.kind, "locator-heal");
    assert.equal((heal?.data as { persisted: boolean } | undefined)?.persisted, false);
  });

  it("uses explicit locator fallbacks without reporting a healed test", async () => {
    const owner = job();
    const used: unknown[] = [];
    await runRecipeStep(
      stubDevice({
        press: async (options) => {
          used.push(options);
          if ((options as { ref?: string }).ref) throw new Error("not present");
          return {};
        },
      }),
      {
        kind: "tap",
        target: { ref: "@missing" },
        fallbackTargets: [{ label: "New conversation" }],
      },
      { log: () => {}, job: owner },
    );
    assert.equal(used.length, 2);
    assert.equal(owner.artifacts.at(-1)?.kind, "locator-fallback");
  });

  it("binds declared reusable-flow inputs without leaking them into the parent", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-flow-inputs-"));
    const oldRecipes = process.env.RELAY_RECIPES_DIR;
    const oldTests = process.env.RELAY_TESTS_DIR;
    process.env.RELAY_RECIPES_DIR = root;
    process.env.RELAY_TESTS_DIR = join(root, "tests");
    try {
      const flow = await saveRecipe({
        expectedRevision: 0,
        title: "Recorded email sign-in",
        parameters: [
          {
            name: "login_email",
            label: "Test account",
            description: "Approved QA email address",
            required: true,
          },
        ],
        steps: [{ kind: "type", text: "{{login_email}}" }],
      });
      const owner = job();
      const typed: unknown[] = [];
      await runRecipeStep(
        stubDevice({
          type: async (input) => {
            typed.push(input);
            return {};
          },
        }),
        {
          kind: "module",
          recipeId: flow.id,
          bindings: { login_email: "qa.secondary@example.test" },
        },
        { log: () => {}, job: owner },
      );
      assert.equal((typed[0] as { text?: string }).text, "qa.secondary@example.test");
      assert.equal(owner.resolvedInputs.login_email, undefined);
      const evidence = owner.artifacts.find((artifact) => artifact.kind === "reusable-flow-inputs");
      assert.ok(evidence);
      assert.deepEqual((evidence.data as { resolved?: Record<string, string> }).resolved, {
        login_email: "qa.secondary@example.test",
      });
    } finally {
      if (oldRecipes === undefined) delete process.env.RELAY_RECIPES_DIR;
      else process.env.RELAY_RECIPES_DIR = oldRecipes;
      if (oldTests === undefined) delete process.env.RELAY_TESTS_DIR;
      else process.env.RELAY_TESTS_DIR = oldTests;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a reusable flow whose required input is not bound", async () => {
    const root = await mkdtemp(join(tmpdir(), "relay-flow-required-"));
    const oldRecipes = process.env.RELAY_RECIPES_DIR;
    const oldTests = process.env.RELAY_TESTS_DIR;
    process.env.RELAY_RECIPES_DIR = root;
    process.env.RELAY_TESTS_DIR = join(root, "tests");
    try {
      const flow = await saveRecipe({
        expectedRevision: 0,
        title: "Required input flow",
        parameters: [{ name: "account", required: true }],
        steps: [],
      });
      await assert.rejects(
        () =>
          runRecipeStep(
            stubDevice({}),
            { kind: "module", recipeId: flow.id },
            { log: () => {}, job: job() },
          ),
        /requires input account/,
      );
    } finally {
      if (oldRecipes === undefined) delete process.env.RELAY_RECIPES_DIR;
      else process.env.RELAY_RECIPES_DIR = oldRecipes;
      if (oldTests === undefined) delete process.env.RELAY_TESTS_DIR;
      else process.env.RELAY_TESTS_DIR = oldTests;
      await rm(root, { recursive: true, force: true });
    }
  });

  it("waits for response content to change and stabilize", async () => {
    const owner = job();
    let sample = 0;
    const device = stubDevice({
      wait: () => new Promise((resolve) => setTimeout(resolve, 25)),
      snapshot: () => {
        sample += 1;
        const value = sample < 2 ? "" : sample < 4 ? "Paris" : "Paris is in France.";
        return Promise.resolve({
          nodes: value
            ? [
                { ref: "@answer", label: "Assistant response", value },
                { label: "Send", value: "Ready" },
              ]
            : [],
        });
      },
    });
    await runRecipeStep(
      device,
      {
        kind: "wait-response",
        target: { ref: "@answer" },
        idleTarget: { label: "Send" },
        timeoutMs: 2_000,
        stableForMs: 500,
      },
      { log: () => {}, job: owner },
    );
    const evidence = owner.artifacts.find((item) => item.kind === "response-completion");
    assert.equal((evidence?.data as { status?: string } | undefined)?.status, "complete");
    assert.deepEqual((evidence?.data as { signals?: string[] } | undefined)?.signals, [
      "response-started",
      "text-stable",
      "idle-visible",
    ]);
  });

  it("accepts a response that completed before the first physical-device sample", async () => {
    const owner = job();
    const logs: string[] = [];
    const device = stubDevice({
      wait: () => new Promise((resolve) => setTimeout(resolve, 25)),
      snapshot: () =>
        Promise.resolve({
          nodes: [
            { ref: "@answer", label: "Assistant response", value: "hello" },
            { identifier: "response.done", label: "Regenerate" },
          ],
        }),
    });

    await runRecipeStep(
      device,
      {
        kind: "wait-response",
        target: { ref: "@answer" },
        idleTarget: { identifier: "response.done" },
        timeoutMs: 2_000,
        stableForMs: 500,
      },
      { log: (message) => logs.push(message), job: owner },
    );

    assert.ok(logs.some((message) => message.includes("content already complete")));
    const evidence = owner.artifacts.find((item) => item.kind === "response-completion");
    assert.equal((evidence?.data as { status?: string } | undefined)?.status, "complete");
    assert.deepEqual((evidence?.data as { signals?: string[] } | undefined)?.signals, [
      "response-started",
      "text-stable",
      "idle-visible",
    ]);
  });
});
