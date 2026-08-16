import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  isRightToLeftRun,
  refMatchesRecordedTarget,
  resolveRecipeStep,
  runRecipeStep as runRecipeStepWithoutContext,
} from "./recipe-runner.js";
import {
  finalizeDeferredCampaignChecks,
  retryDeferredCampaignChecks,
} from "./recipe-runner-extended-steps.js";

it("recognizes right-to-left app locales for mirrored point fallbacks", () => {
  assert.equal(isRightToLeftRun({ language: "ar" }), true);
  assert.equal(isRightToLeftRun({ locale: "he-IL" }), true);
  assert.equal(isRightToLeftRun({ language: "pt-BR" }), false);
});
import type { Device } from "./device.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { TestJob } from "./session.js";
import { registerEvaluationProvider } from "./evaluation.js";
import { saveRecipe } from "./recipes.js";
import { clearControl, JobCancelledError, requestResume } from "./control.js";
import { runWithTargetContext } from "./target-context.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import type { ScreenshotPayload } from "./workspace-capture.js";

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
  scroll?: (options: unknown) => Promise<unknown>;
  pan?: (options: unknown) => Promise<unknown>;
  clipboard?: (options: unknown) => Promise<unknown>;
  wait?: () => Promise<unknown>;
  back?: () => Promise<unknown>;
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
      scroll: impl.scroll ?? (() => Promise.reject(new Error("scroll unavailable in test"))),
      pan: impl.pan ?? (() => Promise.resolve({})),
    },
    command: {
      wait: impl.wait ?? (() => Promise.resolve({})),
      back: impl.back ?? (() => Promise.resolve({})),
      home: () => Promise.resolve({}),
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

    assert.equal((presses[0] as { selector?: string }).selector, 'label="New conversation"');
    assert.equal((presses[0] as { platform?: string }).platform, "ios");
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

  it("taps Home by label with the same named-control order as mouse targeting", async () => {
    const home = {
      type: "Button",
      label: "Home",
      enabled: true,
      hittable: true,
      rect: { x: 10, y: 700, width: 80, height: 40 },
    };
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [home] }),
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });
    const job = {
      artifacts: [] as { kind: string; data: { method?: string; bounds?: unknown } }[],
    };
    await runRecipeStep(
      device,
      { kind: "tap", target: { label: "Home" } },
      {
        log: () => {},
        job: job as never,
      },
    );
    assert.equal((presses[0] as { selector?: string }).selector, 'label="Home"');
    const recorded = job.artifacts.find((artifact) => artifact.kind === "target-resolution");
    assert.equal(recorded?.data.method, "label");
    assert.deepEqual(recorded?.data.bounds, home.rect);
  });

  it("accepts an exact declared Android handoff from a semantic tap", async () => {
    const language = {
      type: "android.widget.TextView",
      label: "Lingua App",
      enabled: true,
      hittable: true,
      rect: { x: 80, y: 1500, width: 320, height: 80 },
    };
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [language] }),
      press: () =>
        Promise.reject(
          new Error(
            "press coordinate tap left ai.x.grok and foregrounded com.android.settings. The tap likely escaped the app.",
          ),
        ),
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { label: "Lingua App" },
        expectedApp: "com.android.settings",
      },
      noLog,
    );
  });

  it("uses a stable accessibility identifier before weaker fallbacks", async () => {
    const field = {
      type: "TextField",
      identifier: "chat_text_input",
      label: "Ask anything",
      enabled: true,
      hittable: true,
      rect: { x: 80, y: 200, width: 80, height: 40 },
    };
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [field] }),
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

  it("falls back to the explicit point when Home labels collide", async () => {
    const leftHome = {
      type: "Button",
      label: "Home",
      enabled: true,
      hittable: true,
      rect: { x: 10, y: 700, width: 80, height: 40 },
    };
    const rightHome = {
      type: "Button",
      label: "Home",
      enabled: true,
      hittable: true,
      rect: { x: 200, y: 700, width: 80, height: 40 },
    };
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [leftHome, rightHome] }),
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });
    const job = {
      artifacts: [] as {
        kind: string;
        data: { method?: string; bounds?: unknown; point?: unknown };
      }[],
    };
    await runRecipeStep(
      device,
      { kind: "tap", target: { label: "Home", point: { x: 240, y: 720 } } },
      { log: () => {}, job: job as never },
    );
    assert.deepEqual(presses, [
      { platform: "android", serial: "recipe-runner-test", x: 240, y: 720 },
    ]);
    const recorded = job.artifacts.find((artifact) => artifact.kind === "target-resolution");
    assert.equal(recorded?.data.method, "point");
    assert.deepEqual(recorded?.data.point, { x: 240, y: 720 });
    assert.deepEqual(recorded?.data.bounds, { x: 240, y: 720, width: 1, height: 1 });
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

  it("preserves an exact point inside a semantic element after localized reflow", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              identifier: "language-row",
              rect: { x: 24, y: 610, width: 312, height: 96 },
              enabled: true,
            },
          ],
        }),
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
          point: {
            x: 280,
            y: 220,
            referenceBounds: { width: 360, height: 800 },
            relativeTo: {
              target: { identifier: "language-row" },
              xRatio: 0.75,
              yRatio: 0.25,
            },
          },
        },
      },
      noLog,
    );

    assert.deepEqual(presses, [
      { platform: "android", serial: "recipe-runner-test", x: 258, y: 634 },
    ]);
  });

  it("fails closed when an element-relative anchor is ambiguous", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            { label: "More", rect: { x: 10, y: 100, width: 80, height: 44 } },
            { label: "More", rect: { x: 220, y: 500, width: 80, height: 44 } },
          ],
        }),
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });

    await assert.rejects(
      runRecipeStep(
        device,
        {
          kind: "tap",
          target: {
            point: {
              x: 40,
              y: 120,
              relativeTo: { target: { label: "More" }, xRatio: 0.5, yRatio: 0.5 },
            },
          },
        },
        noLog,
      ),
      /element-relative anchor was ambiguous/,
    );
    assert.deepEqual(presses, []);
  });

  it("uses a primary semantic target without resolving its point fallback eagerly", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              identifier: "continue-button",
              hittable: true,
              enabled: true,
              rect: { x: 120, y: 700, width: 120, height: 48 },
            },
          ],
        }),
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
          identifier: "continue-button",
          point: {
            x: 180,
            y: 724,
            relativeTo: {
              target: { identifier: "missing-fallback-anchor" },
              xRatio: 0.5,
              yRatio: 0.5,
            },
          },
        },
      },
      noLog,
    );

    assert.deepEqual(presses, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        selector: 'id="continue-button"',
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
      pan: (options) => {
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
        x: 10,
        y: 20,
        dx: 180,
        dy: 360,
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

  it("can paste the current clipboard after a copy without duplicating the value in YAML", async () => {
    const calls: unknown[] = [];
    let clipboard = "hello";
    const device = stubDevice({
      clipboard: (options) => {
        const input = options as { action: string; text?: string };
        calls.push(input);
        if (input.action === "read") return Promise.resolve({ action: "read", text: clipboard });
        if (input.action === "paste") {
          clipboard = input.text ?? clipboard;
          return Promise.resolve({
            action: "paste",
            text: clipboard,
            textLength: clipboard.length,
            message: "Clipboard pasted",
          });
        }
        return Promise.resolve({
          action: "copy",
          text: clipboard,
          textLength: clipboard.length,
          message: "Clipboard copied",
        });
      },
    });

    await runRecipeStep(
      device,
      { kind: "clipboard", action: "paste", target: { identifier: "message" } },
      noLog,
    );

    assert.deepEqual(calls, [
      { platform: "android", serial: "recipe-runner-test", action: "read" },
      {
        platform: "android",
        serial: "recipe-runner-test",
        action: "paste",
        text: "hello",
        selectorKey: "id",
        selectorValue: "message",
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
    assert.equal(
      job.artifacts.some((artifact) => artifact.kind === "optional-step-skipped"),
      true,
    );
  });
});

describe("runRecipeStep campaign check policy", () => {
  it("retains a failed check and returns so the next check can run", async () => {
    const logs: string[] = [];
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const device = stubDevice({
      press: () => Promise.reject(new Error("path changed")),
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              role: "button",
              label: "Settings",
              rect: { x: 20, y: 80, width: 200, height: 48 },
            },
          ],
        }),
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "settings.customize" },
        check: { id: "customize", title: "Customize Grok" },
      },
      { log: (line) => logs.push(line), job },
    );

    assert.match(logs.at(-1) ?? "", /check failed: Customize Grok/u);
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-result" &&
          (artifact.data as { status?: string }).status === "failed",
      ),
      true,
    );
    const evidence = job.artifacts.find((artifact) => artifact.kind === "campaign-check-evidence");
    assert.ok(evidence);
    const evidenceData = evidence.data as {
      attempts?: Array<{ kind: string }>;
      accessibility?: { available: boolean; nodeCount: number };
      nodes?: Array<{ label?: string }>;
    };
    assert.deepEqual(
      evidenceData.attempts?.map((attempt) => attempt.kind),
      ["target-resolution-attempt"],
    );
    assert.deepEqual(evidenceData.accessibility, { available: true, nodeCount: 1 });
    assert.equal(evidenceData.nodes?.[0]?.label, "Settings");
  });

  it("records accessibility as unavailable when failure evidence cannot capture a tree", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const device = stubDevice({
      press: () => Promise.reject(new Error("control missing")),
      snapshot: () => Promise.reject(new Error("accessibility unavailable")),
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "settings.missing" },
        check: { id: "missing", title: "Missing control" },
      },
      { ...noLog, job },
    );

    const evidence = job.artifacts.find((artifact) => artifact.kind === "campaign-check-evidence");
    assert.deepEqual(
      (evidence?.data as { accessibility?: unknown; nodes?: unknown[] } | undefined)?.accessibility,
      { available: false, nodeCount: 0 },
    );
    assert.deepEqual((evidence?.data as { nodes?: unknown[] } | undefined)?.nodes, []);
  });

  it("records a passing check", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    await runRecipeStep(
      stubDevice({}),
      {
        kind: "sleep",
        ms: 0,
        check: { id: "settings", title: "Settings" },
      },
      { ...noLog, job },
    );

    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-result" &&
          (artifact.data as { status?: string }).status === "passed",
      ),
      true,
    );
  });

  it("always runs cleanup after a primary action failure and retains the product failure", async () => {
    const presses: string[] = [];
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const recipeGraph = {
      primary: {
        id: "primary",
        title: "Primary",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "primary" } }],
        createdAt: 1,
        updatedAt: 1,
      },
      cleanup: {
        id: "cleanup",
        title: "Cleanup",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "cleanup" } }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const device = stubDevice({
      press: (options) => {
        const selector = String((options as { selector?: string }).selector);
        presses.push(selector);
        return selector.includes("primary")
          ? Promise.reject(new Error("primary changed"))
          : Promise.resolve({});
      },
      snapshot: () => Promise.resolve({ nodes: [] }),
    });

    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "primary",
        check: {
          id: "kids",
          title: "Kids Mode",
          cleanup: { recipeId: "cleanup", terminalScreenId: "kids-off", onCancel: "skip" },
        },
      },
      { ...noLog, job, recipeGraph },
    );

    assert.deepEqual(presses, ['id="primary"', 'id="cleanup"']);
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-cleanup" &&
          (artifact.data as { status?: string }).status === "passed",
      ),
      true,
    );
    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
    assert.ok(result);
    const resultData = result.data as { status?: string; primaryError?: string };
    assert.equal(resultData.status, "failed");
    assert.match(resultData.primaryError ?? "", /identifier primary/u);
  });

  it("runs cleanup after a passing primary path before marking the check passed", async () => {
    const order: string[] = [];
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const recipeGraph = {
      primary: {
        id: "primary",
        title: "Primary",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "primary" } }],
        createdAt: 1,
        updatedAt: 1,
      },
      cleanup: {
        id: "cleanup",
        title: "Cleanup",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "cleanup" } }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    await runRecipeStep(
      stubDevice({
        press: (options) => {
          order.push(String((options as { selector?: string }).selector));
          return Promise.resolve({});
        },
      }),
      {
        kind: "module",
        recipeId: "primary",
        check: {
          id: "kids",
          title: "Kids Mode",
          cleanup: { recipeId: "cleanup", terminalScreenId: "kids-off", onCancel: "skip" },
        },
      },
      { ...noLog, job, recipeGraph },
    );

    assert.deepEqual(order, ['id="primary"', 'id="cleanup"']);
    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
    assert.ok(result);
    assert.equal((result.data as { status?: string }).status, "passed");
  });

  it("reports primary and cleanup failures separately without hiding either", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const recipeGraph = {
      primary: {
        id: "primary",
        title: "Primary",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "primary" } }],
        createdAt: 1,
        updatedAt: 1,
      },
      cleanup: {
        id: "cleanup",
        title: "Cleanup",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "cleanup" } }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const device = stubDevice({
      press: (options) =>
        Promise.reject(
          new Error(
            String((options as { selector?: string }).selector).includes("primary")
              ? "primary changed"
              : "cleanup could not restore off",
          ),
        ),
      snapshot: () => Promise.resolve({ nodes: [] }),
    });

    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "primary",
        check: {
          id: "kids",
          title: "Kids Mode",
          cleanup: { recipeId: "cleanup", terminalScreenId: "kids-off", onCancel: "skip" },
        },
      },
      { ...noLog, job, recipeGraph },
    );

    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
    assert.ok(result);
    const resultData = result.data as {
      status?: string;
      primaryError?: string;
      cleanupError?: string;
      error?: string;
    };
    assert.equal(resultData.status, "failed");
    assert.match(resultData.primaryError ?? "", /identifier primary/u);
    assert.match(resultData.cleanupError ?? "", /identifier cleanup/u);
    assert.match(
      resultData.error ?? "",
      /Primary failed: .*identifier primary.*; cleanup failed: .*identifier cleanup/u,
    );
  });

  it("skips cleanup on cancellation because cancellation revokes device authority", async () => {
    const presses: string[] = [];
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const recipeGraph = {
      primary: {
        id: "primary",
        title: "Primary",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "primary" } }],
        createdAt: 1,
        updatedAt: 1,
      },
      cleanup: {
        id: "cleanup",
        title: "Cleanup",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "cleanup" } }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const device = stubDevice({
      press: (options) => {
        presses.push(String((options as { selector?: string }).selector));
        return Promise.reject(new JobCancelledError());
      },
    });

    await assert.rejects(
      runRecipeStep(
        device,
        {
          kind: "module",
          recipeId: "primary",
          check: {
            id: "kids",
            title: "Kids Mode",
            cleanup: { recipeId: "cleanup", terminalScreenId: "kids-off", onCancel: "skip" },
          },
        },
        { ...noLog, job, recipeGraph },
      ),
      JobCancelledError,
    );

    assert.deepEqual(presses, ['id="primary"']);
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-cleanup" &&
          (artifact.data as { status?: string }).status === "skipped",
      ),
      true,
    );
  });

  it("defers one failed leaf while independent siblings continue", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const logs: string[] = [];
    const waits: number[] = [];
    const recipeGraph = {
      warm: {
        id: "warm",
        title: "Visit next leaf from the current parent",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      recover: {
        id: "recover",
        title: "Cold recovery",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 99 }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const recovery = { groupId: "settings", recipeId: "recover" };
    const device = stubDevice({
      press: () => Promise.reject(new Error("row disappeared")),
      wait: async () => {
        waits.push(1);
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "missing" },
        check: { id: "missing", title: "Missing row", recovery },
      },
      { log: (line) => logs.push(line), job, runtime, recipeGraph },
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "warm",
        check: { id: "next", title: "Next leaf", recovery },
      },
      { log: (line) => logs.push(line), job, runtime, recipeGraph },
    );
    const context = { log: (line: string) => logs.push(line), job, runtime, recipeGraph };
    finalizeDeferredCampaignChecks(context);

    assert.deepEqual(
      job.artifacts
        .filter((artifact) => artifact.kind === "campaign-check-result")
        .map((artifact) => (artifact.data as { status: string }).status),
      ["passed", "failed"],
    );
    assert.deepEqual(waits, [1]);
    assert.equal(
      logs.some((line) => line.includes("Cold recovery")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("Visit next leaf from the current parent")),
      false,
    );
    assert.equal(runtime.deferredCampaignChecks?.length, 0);
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-evidence" &&
          (artifact.data as { checkId?: string }).checkId === "missing",
      ),
      true,
    );
  });

  it("keeps an authored warm recipe when no canonical recovery was declared", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const logs: string[] = [];
    const waits: number[] = [];
    const recipeGraph = {
      warm: {
        id: "warm",
        title: "Visit next leaf from the current parent",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      recover: {
        id: "recover",
        title: "Cold recovery",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 99 }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const recovery = { groupId: "settings", recipeId: "recover" };
    const device = stubDevice({
      press: () => Promise.reject(new Error("row disappeared")),
      wait: async () => {
        waits.push(1);
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "missing" },
        check: { id: "missing", title: "Missing row", recovery },
      },
      { log: (line) => logs.push(line), job, runtime, recipeGraph },
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "warm",
        check: { id: "next", title: "Next leaf" },
      },
      { log: (line) => logs.push(line), job, runtime, recipeGraph },
    );
    const context = { log: (line: string) => logs.push(line), job, runtime, recipeGraph };
    finalizeDeferredCampaignChecks(context);

    assert.deepEqual(
      job.artifacts
        .filter((artifact) => artifact.kind === "campaign-check-result")
        .map((artifact) => (artifact.data as { status: string }).status),
      ["passed", "failed"],
    );
    assert.deepEqual(waits, [1]);
    assert.equal(
      logs.some((line) => line.includes("Visit next leaf from the current parent")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("Cold recovery")),
      false,
    );
    assert.equal(runtime.deferredCampaignChecks?.length, 0);
  });

  it("uses one canonical path after a failed check instead of probing an unknown warm state", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const logs: string[] = [];
    const recipeGraph = {
      warm: {
        id: "warm",
        title: "Warm path",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      recover: {
        id: "recover",
        title: "Canonical path",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 2 }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const recovery = { groupId: "settings", recipeId: "recover" };
    const device = stubDevice({
      press: () => Promise.reject(new Error("row disappeared")),
      wait: async () => {},
    });
    const context = { log: (line: string) => logs.push(line), job, runtime, recipeGraph };

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "missing" },
        check: { id: "missing", title: "Missing row", recovery },
      },
      context,
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "warm",
        check: { id: "next", title: "Next leaf", recovery },
      },
      context,
    );

    assert.equal(
      logs.some((line) => line.includes("Canonical path")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("Warm path")),
      false,
    );
    assert.equal(runtime.campaignItineraryTrusted, true);
  });

  it("finalizes deferred checks without executing automatic recovery", async () => {
    const logs: string[] = [];
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const recovery = { groupId: "settings", recipeId: "cold-recovery" };
    const context = {
      log: (line: string) => logs.push(line),
      job,
      runtime,
      recipeGraph: {},
    };

    await runRecipeStep(
      stubDevice({ press: () => Promise.reject(new Error("row disappeared")) }),
      {
        kind: "tap",
        target: { identifier: "missing" },
        check: { id: "missing", title: "Missing row", recovery },
      },
      context,
    );
    finalizeDeferredCampaignChecks(context);

    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result")
      ?.data as {
      status?: string;
      error?: string;
      recovery?: { recipeId?: string };
      selectiveRepair?: { status?: string; recipeId?: string };
    };
    const deferred = job.artifacts.find((artifact) => artifact.kind === "campaign-check-deferred")
      ?.data as { error?: string };
    assert.equal(result.status, "failed");
    assert.equal(result.error, deferred.error);
    assert.match(result.error ?? "", /missing/u);
    assert.equal(result.recovery?.recipeId, "cold-recovery");
    assert.deepEqual(result.selectiveRepair, {
      status: "pending",
      recipeId: "cold-recovery",
      groupId: "settings",
    });
    assert.match(logs.at(-1) ?? "", /check needs repair: Missing row/u);
    assert.equal(runtime.deferredCampaignChecks?.length, 0);
  });

  it("blocks only a dependency group after its canonical recovery fails", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const recovery = { groupId: "settings", recipeId: "recover" };
    const failingTap = { kind: "tap" as const, target: { identifier: "missing" } };
    const recipeGraph = {
      recover: {
        id: "recover",
        title: "Broken recovery",
        source: "custom" as const,
        steps: [failingTap],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const device = stubDevice({ press: () => Promise.reject(new Error("origin unavailable")) });
    const context = { ...noLog, job, runtime, recipeGraph };

    await runRecipeStep(
      device,
      { ...failingTap, check: { id: "first", title: "First leaf", recovery } },
      context,
    );
    await runRecipeStep(
      device,
      { ...failingTap, check: { id: "second", title: "Second leaf", recovery } },
      context,
    );
    await retryDeferredCampaignChecks(device, context, (recipeId) =>
      runRecipeStep(device, { kind: "module", recipeId }, context),
    );

    assert.deepEqual(
      job.artifacts
        .filter((artifact) => artifact.kind === "campaign-check-result")
        .map((artifact) => (artifact.data as { status: string }).status),
      ["failed", "blocked"],
    );
    assert.equal(runtime.campaignRecoveryGroups?.settings?.status, "blocked");
  });
});

describe("runRecipeStep semantic reveal", () => {
  const revealContext = (): RecipeStepContext => ({ log: () => {}, runtime: {} });

  it("scrolls only until the mapped destination identity is visible", async () => {
    const before = [{ role: "button", identifier: "top", label: "Top" }];
    const middle = [{ role: "button", identifier: "middle", label: "Middle" }];
    const destination = [{ role: "button", identifier: "advanced", label: "Advanced" }];
    const destinationIdentity = observeScreenIdentity(destination);
    let viewport = 0;
    let scrolls = 0;

    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes: viewport === 0 ? before : viewport === 1 ? middle : destination,
          }),
        scroll: () => {
          viewport += 1;
          scrolls += 1;
          return Promise.resolve({});
        },
      }),
      {
        kind: "scroll",
        direction: "down",
        until: {
          screenId: "advanced",
          screenTitle: "Advanced",
          fingerprint: destinationIdentity.fingerprint,
          observations: [destinationIdentity],
        },
        maxAttempts: 8,
      },
      revealContext(),
    );

    assert.equal(scrolls, 2);
  });

  it("reveals a semantic control instead of relying on a fixed viewport offset", async () => {
    let viewport = 0;
    let scrolls = 0;
    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes:
              viewport === 0
                ? [
                    {
                      role: "cell",
                      label: "Appearance",
                      hittable: true,
                      rect: { x: 0, y: 100, width: 300, height: 60 },
                    },
                  ]
                : [
                    {
                      role: "cell",
                      identifier: "kids-mode",
                      label: "Kids Mode",
                      hittable: true,
                      rect: { x: 0, y: 300, width: 300, height: 60 },
                    },
                  ],
          }),
        scroll: () => {
          viewport += 1;
          scrolls += 1;
          return Promise.resolve({});
        },
      }),
      {
        kind: "reveal",
        target: { identifier: "kids-mode", label: "Kids Mode" },
        direction: "auto",
      },
      revealContext(),
    );
    assert.equal(scrolls, 1);
  });

  it("uses full-surface semantic geometry to choose direction and distance", async () => {
    let viewport: "appearance" | "kids" = "appearance";
    const movements: Array<{ direction?: string; amount?: number }> = [];
    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes:
              viewport === "appearance"
                ? [
                    {
                      role: "cell",
                      identifier: "appearance",
                      label: "Apparence",
                      hittable: true,
                      rect: { x: 0, y: 260, width: 300, height: 60 },
                    },
                  ]
                : [
                    {
                      role: "cell",
                      identifier: "kids-mode",
                      label: "Mode Enfant",
                      hittable: true,
                      rect: { x: 0, y: 340, width: 300, height: 60 },
                    },
                  ],
          }),
        scroll: (options) => {
          movements.push(options as { direction?: string; amount?: number });
          viewport = "kids";
          return Promise.resolve({});
        },
      }),
      {
        kind: "reveal",
        target: { identifier: "kids-mode", label: "Mode Enfant" },
        direction: "auto",
        navigation: [
          {
            schemaVersion: 1,
            surfaceId: "settings-fr",
            captureId: "settings-fr-r1",
            documentHeight: 2_400,
            viewportHeight: 800,
            targetOrder: 1,
            targetDocumentY: 2_040,
            anchors: [
              { order: 0, documentY: 290, target: { identifier: "appearance" } },
              { order: 1, documentY: 2_040, target: { identifier: "kids-mode" } },
            ],
          },
        ],
      },
      revealContext(),
    );

    assert.equal(movements.length, 1);
    assert.equal(movements[0]?.direction, "down");
    assert.equal(movements[0]?.amount, 0.85);
  });

  it("reuses the verified source observation before indexed navigation", async () => {
    let snapshots = 0;
    const nodes = [
      {
        role: "cell",
        identifier: "appearance",
        label: "Appearance",
        hittable: true,
        rect: { x: 0, y: 260, width: 300, height: 60 },
      },
    ];
    await runRecipeStep(
      stubDevice({
        snapshot: () => {
          snapshots += 1;
          return Promise.resolve({ nodes });
        },
      }),
      {
        kind: "reveal",
        target: { identifier: "appearance" },
        navigation: [
          {
            schemaVersion: 1,
            surfaceId: "settings",
            captureId: "settings-r1",
            documentHeight: 2_400,
            viewportHeight: 800,
            targetOrder: 0,
            targetDocumentY: 290,
            anchors: [{ order: 0, documentY: 290, target: { identifier: "appearance" } }],
          },
        ],
      },
      { log: () => {}, runtime: { observation: { nodes, observedAt: 123 } } },
    );

    assert.equal(snapshots, 0);
  });

  it("fails closed when a compiled surface does not overlap the live viewport", async () => {
    let scrolls = 0;
    await assert.rejects(
      runRecipeStep(
        stubDevice({
          snapshot: () =>
            Promise.resolve({
              nodes: [
                {
                  identifier: "unrelated",
                  label: "Other page",
                  rect: { x: 0, y: 100, width: 300, height: 60 },
                },
              ],
            }),
          scroll: () => {
            scrolls += 1;
            return Promise.resolve({});
          },
        }),
        {
          kind: "reveal",
          target: { identifier: "kids-mode" },
          navigation: [
            {
              schemaVersion: 1,
              surfaceId: "settings",
              captureId: "settings-r1",
              documentHeight: 2_400,
              viewportHeight: 800,
              targetOrder: 0,
              targetDocumentY: 2_000,
              anchors: [{ order: 0, documentY: 2_000, target: { identifier: "kids-mode" } }],
            },
          ],
        },
        revealContext(),
      ),
      /does not overlap the compiled full-surface semantic index/,
    );
    assert.equal(scrolls, 0);
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

  it("matches options inside a semantic container when child ids are unavailable", async () => {
    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes: [
              { index: 0, identifier: "attachments-menu", role: "menu", label: "Attachments" },
              { index: 1, parentIndex: 0, role: "button", label: "Camera" },
              { index: 2, parentIndex: 0, role: "button", label: "Gallery" },
              { index: 3, parentIndex: 0, role: "button", label: "Files" },
              { index: 4, label: "outside" },
            ],
          }),
      }),
      {
        kind: "expect-set",
        scope: { identifier: "attachments-menu" },
        labels: ["Files", "Camera", "Gallery"],
        timeoutMs: 0,
      },
      noLog,
    );
  });
});

describe("runRecipeStep expect-screen", () => {
  const nodes = [{ role: "button", label: "Continue", visibleToUser: true }];
  const fingerprint = observeScreenIdentity(nodes).fingerprint;

  const screenshot = (name: string, visualFingerprint?: string): ScreenshotPayload => ({
    capturedAt: 1,
    mime: "image/png",
    base64: Buffer.from(name).toString("base64"),
    path: `/tmp/${name}.png`,
    bytes: name.length,
    ...(visualFingerprint
      ? {
          screenMatch: {
            fingerprint: visualFingerprint,
            visualFingerprint,
            matchedScreenId: null,
            status: "observed" as const,
          },
        }
      : {}),
  });

  it("starts Android destination semantics and raster together and retains the matched pair", async () => {
    let resolveNodes!: (value: { nodes: typeof nodes }) => void;
    let resolveRaster!: (value: ScreenshotPayload) => void;
    let markSemanticStarted!: () => void;
    let markRasterStarted!: () => void;
    const semanticStarted = new Promise<void>((resolve) => {
      markSemanticStarted = resolve;
    });
    const rasterStarted = new Promise<void>((resolve) => {
      markRasterStarted = resolve;
    });
    const semantic = new Promise<{ nodes: typeof nodes }>((resolve) => {
      resolveNodes = resolve;
    });
    const raster = new Promise<ScreenshotPayload>((resolve) => {
      resolveRaster = resolve;
    });
    const device = stubDevice({
      snapshot: () => {
        markSemanticStarted();
        return semantic;
      },
    });
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const pending = runWithTargetContext(
      { kind: "device", platform: "android", serial: "coalesced-observation" },
      () =>
        runExpectScreenStep(
          device,
          { kind: "expect-screen", screenId: "home", screenTitle: "Home", fingerprint },
          {
            log: () => {},
            job: { id: "coalesced", platform: "android" } as TestJob,
            runtime,
          },
          {
            captureScreenshot: () => {
              markRasterStarted();
              return raster;
            },
          },
        ),
    );

    await Promise.all([semanticStarted, rasterStarted]);
    const captured = screenshot("destination");
    resolveRaster(captured);
    await Promise.resolve();
    assert.equal(Boolean(runtime.verifiedScreen), false, "the pair waits for both observations");
    resolveNodes({ nodes });
    await pending;

    assert.equal(runtime.verifiedScreen?.screenshot, captured);
    assert.equal(runtime.verifiedScreen?.nodes, nodes);
    assert.equal(captured.framePath, undefined, "ephemeral evidence is not attached early");
    assert.equal(captured.screenMatch?.matchedScreenId, "home");
  });

  it("discards a mismatched raster and captures a new pair after recovery", async () => {
    const wrongNodes = [{ role: "heading", label: "Wrong" }];
    const rasters = [screenshot("wrong"), screenshot("recovered")];
    let snapshots = 0;
    let screenshots = 0;
    let backs = 0;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    await runWithTargetContext(
      { kind: "device", platform: "android", serial: "coalesced-recovery" },
      () =>
        runExpectScreenStep(
          stubDevice({
            snapshot: () => {
              snapshots += 1;
              return Promise.resolve({ nodes: snapshots === 1 ? wrongNodes : nodes });
            },
            press: () => {
              backs += 1;
              return Promise.resolve({});
            },
          }),
          {
            kind: "expect-screen",
            screenId: "home",
            screenTitle: "Home",
            fingerprint,
            recovery: { strategy: "back", maxAttempts: 1 },
          },
          {
            log: () => {},
            job: { id: "recovery", platform: "android" } as TestJob,
            runtime,
            observeVisualFingerprint: () => Promise.resolve("f".repeat(64)),
          },
          {
            captureScreenshot: async () => rasters[screenshots++]!,
          },
        ),
    );

    assert.equal(snapshots, 3, "Back resolution takes its own fresh semantic snapshot");
    assert.equal(screenshots, 2);
    assert.equal(backs, 1);
    assert.equal(runtime.verifiedScreen?.screenshot, rasters[1]);
    assert.equal(rasters[0]?.framePath, undefined);
  });

  it("does not retain or attach a terminally mismatched raster", async () => {
    const discarded = screenshot("discarded");
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    await assert.rejects(
      runWithTargetContext(
        { kind: "device", platform: "android", serial: "coalesced-mismatch" },
        () =>
          runExpectScreenStep(
            stubDevice({
              snapshot: () => Promise.resolve({ nodes: [{ role: "heading", label: "Wrong" }] }),
            }),
            {
              kind: "expect-screen",
              screenId: "home",
              screenTitle: "Home",
              fingerprint,
              timeoutMs: 0,
            },
            {
              log: () => {},
              job: { id: "mismatch", platform: "android" } as TestJob,
              runtime,
            },
            { captureScreenshot: async () => discarded },
          ),
      ),
      /not “Home”/u,
    );
    assert.equal(runtime.observation, undefined);
    assert.equal(runtime.verifiedScreen, undefined);
    assert.equal(discarded.framePath, undefined);
    assert.equal(discarded.jobId, undefined);
  });

  it("does not pre-capture raster evidence for source, warm, iOS, or browser expectations", async () => {
    let screenshots = 0;
    const cases = [
      {
        context: { kind: "device", platform: "android", serial: "source" } as const,
        job: { id: "source", platform: "android" } as TestJob,
        id: "relay-source-home",
      },
      {
        context: { kind: "device", platform: "android", serial: "warm" } as const,
        job: { id: "warm", platform: "android" } as TestJob,
        id: "home:warm",
      },
      {
        context: { kind: "device", platform: "ios", serial: "ios" } as const,
        job: { id: "ios", platform: "ios" } as TestJob,
        id: "home",
      },
      {
        context: { kind: "browser", platform: "browser", targetId: "browser" } as const,
        job: { id: "browser", platform: "android", targetKind: "browser" } as TestJob,
        id: "home",
      },
    ];
    for (const item of cases) {
      await runWithTargetContext(item.context, () =>
        runExpectScreenStep(
          stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
          {
            kind: "expect-screen",
            id: item.id,
            screenId: "home",
            screenTitle: "Home",
            fingerprint,
          },
          { log: () => {}, job: item.job, runtime: {} },
          {
            captureScreenshot: async () => {
              screenshots += 1;
              return screenshot("unexpected");
            },
          },
        ),
      );
    }
    assert.equal(screenshots, 0);
  });

  it("uses the concurrent raster for visual fallback", async () => {
    const visualFingerprint = "b".repeat(64);
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    await runWithTargetContext(
      { kind: "device", platform: "android", serial: "visual-fallback" },
      () =>
        runExpectScreenStep(
          stubDevice({ snapshot: () => Promise.resolve({ nodes: [] }) }),
          {
            kind: "expect-screen",
            screenId: "canvas",
            screenTitle: "Canvas",
            fingerprint: "a".repeat(64),
            aliases: [visualFingerprint],
          },
          {
            log: () => {},
            job: { id: "visual", platform: "android" } as TestJob,
            runtime,
          },
          {
            captureScreenshot: async () => screenshot("visual", visualFingerprint),
          },
        ),
    );
    assert.equal(
      runtime.verifiedScreen?.screenshot?.screenMatch?.visualFingerprint,
      visualFingerprint,
    );
  });

  it("propagates concurrent cancellation after settling both promises", async () => {
    let resolveNodes!: (value: { nodes: typeof nodes }) => void;
    const semantic = new Promise<{ nodes: typeof nodes }>((resolve) => {
      resolveNodes = resolve;
    });
    const pending = runWithTargetContext(
      { kind: "device", platform: "android", serial: "cancelled-observation" },
      () =>
        runExpectScreenStep(
          stubDevice({ snapshot: () => semantic }),
          { kind: "expect-screen", screenId: "home", screenTitle: "Home", fingerprint },
          {
            log: () => {},
            job: { id: "cancelled", platform: "android" } as TestJob,
            runtime: {},
          },
          { captureScreenshot: () => Promise.reject(new JobCancelledError()) },
        ),
    );
    await Promise.resolve();
    resolveNodes({ nodes });
    await assert.rejects(pending, JobCancelledError);
  });

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
      /on “.*”, not “Home”/,
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

  it("accepts a dynamic list when its reviewed application shell is unchanged", async () => {
    const shell = [
      { role: "view", identifier: "profile_section", depth: 10 },
      { role: "view", identifier: "settings_button", depth: 12 },
      { role: "view", identifier: "new_conversation_button", depth: 12 },
    ];
    const approved = observeScreenIdentity([
      ...shell,
      ...Array.from({ length: 12 }, (_, index) => ({
        role: "text",
        label: `Saved conversation ${index}`,
        depth: 12,
      })),
    ]);
    const current = [
      ...shell,
      ...Array.from({ length: 12 }, (_, index) => ({
        role: "text",
        label: `Entirely different conversation ${index}`,
        depth: 12,
      })),
    ];
    const lines: string[] = [];

    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: current }) }),
      {
        kind: "expect-screen",
        screenId: "menu",
        screenTitle: "Menu",
        fingerprint: "a".repeat(64),
        observations: [approved],
      },
      { log: (line) => lines.push(line) },
    );

    assert.deepEqual(lines, ["screen: reached Menu"]);
  });

  it("accepts a reflowed handoff shell only under its explicit foreground package", async () => {
    const shell = [
      { role: "view", identifier: "settings.action_bar", depth: 9, bundleId: "settings.app" },
      { role: "list", identifier: "settings.recycler", depth: 15, bundleId: "settings.app" },
      { role: "image", identifier: "settings.app_icon", depth: 16, bundleId: "settings.app" },
      { role: "view", identifier: "settings.content", depth: 12, bundleId: "settings.app" },
      { role: "button", identifier: "settings.back", depth: 10, bundleId: "settings.app" },
      { role: "button", identifier: "settings.more", depth: 10, bundleId: "settings.app" },
    ];
    const approved = observeScreenIdentity([
      ...shell,
      ...Array.from({ length: 8 }, (_, index) => ({
        role: "radio",
        identifier: "settings.language_choice",
        label: `Language ${index}`,
        depth: 17,
      })),
    ]);
    const current = [
      ...shell,
      ...Array.from({ length: 9 }, (_, index) => ({
        role: "radio",
        identifier: "settings.language_choice",
        label: `Different visible language ${index}`,
        depth: 17,
      })),
    ];
    const lines: string[] = [];

    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: current }) }),
      {
        kind: "expect-screen",
        screenId: "languages",
        screenTitle: "App languages",
        fingerprint: "a".repeat(64),
        expectedApp: "settings.app",
        observations: [approved],
      },
      { log: (line) => lines.push(line) },
    );

    assert.deepEqual(lines, ["screen: reached App languages"]);

    await assert.rejects(
      () =>
        runRecipeStep(
          stubDevice({
            snapshot: () =>
              Promise.resolve({
                nodes: current.map((node) => ({ ...node, bundleId: "unrelated.app" })),
              }),
          }),
          {
            kind: "expect-screen",
            screenId: "languages",
            screenTitle: "App languages",
            fingerprint: "a".repeat(64),
            expectedApp: "settings.app",
            timeoutMs: 0,
            observations: [approved],
          },
          { ...noLog, observeVisualFingerprint: () => Promise.resolve("b".repeat(64)) },
        ),
      /not “App languages”/u,
    );
  });

  it("does not let one generic identifier equate unrelated dynamic screens", async () => {
    const approved = observeScreenIdentity([
      { role: "view", identifier: "shared_root", depth: 1 },
      ...Array.from({ length: 12 }, (_, index) => ({
        role: "text",
        label: `Conversation ${index}`,
        depth: 2,
      })),
    ]);

    await assert.rejects(
      () =>
        runRecipeStep(
          stubDevice({
            snapshot: () =>
              Promise.resolve({
                nodes: [
                  { role: "view", identifier: "shared_root", depth: 1 },
                  ...Array.from({ length: 12 }, (_, index) => ({
                    role: "button",
                    label: `Unrelated action ${index}`,
                    depth: 2,
                  })),
                ],
              }),
          }),
          {
            kind: "expect-screen",
            screenId: "menu",
            screenTitle: "Menu",
            fingerprint: "a".repeat(64),
            timeoutMs: 0,
            observations: [approved],
          },
          { ...noLog, observeVisualFingerprint: () => Promise.resolve("b".repeat(64)) },
        ),
      /not “Menu”/u,
    );
  });

  it("accepts a translated screen only when stable identifiers and structure agree", async () => {
    const english = [
      { role: "button", identifier: "menu", label: "Menu" },
      { role: "tab", identifier: "ask", label: "Ask", selected: true },
      { role: "tab", identifier: "imagine", label: "Imagine" },
    ];
    const italian = [
      { role: "button", identifier: "menu", label: "Menu" },
      { role: "tab", identifier: "ask", label: "Chiedi", selected: true },
      { role: "tab", identifier: "imagine", label: "Immagine" },
    ];
    const lines: string[] = [];
    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: italian }) }),
      {
        kind: "expect-screen",
        screenId: "home",
        screenTitle: "Home",
        fingerprint: "a".repeat(64),
        observations: [observeScreenIdentity(english)],
      },
      {
        log: (line) => lines.push(line),
        job: { resolvedInputs: { language: "it" }, artifacts: [] } as unknown as TestJob,
      },
    );
    assert.deepEqual(lines, ["screen: reached Home"]);
  });

  it("accepts an exact translated Compose viewport without per-row identifiers", async () => {
    const english = Array.from({ length: 12 }, (_, index) => ({
      role: index < 8 ? "android.view.View" : "android.widget.TextView",
      label: `English row ${index}`,
      enabled: true,
      hittable: index < 8,
      depth: index < 8 ? 12 : 13,
    }));
    const italian = english.map((node, index) => ({
      ...node,
      label: `Riga italiana ${index}`,
    }));
    const lines: string[] = [];

    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: italian }) }),
      {
        kind: "expect-screen",
        screenId: "settings-middle",
        screenTitle: "Settings middle",
        fingerprint: "a".repeat(64),
        observations: [observeScreenIdentity(english)],
      },
      {
        log: (line) => lines.push(line),
        job: { resolvedInputs: { language: "it" }, artifacts: [] } as unknown as TestJob,
      },
    );

    assert.deepEqual(lines, ["screen: reached Settings middle"]);
  });

  it("uses the full bounded Back ladder for a warm source before replay", async () => {
    let backs = 0;
    const lines: string[] = [];
    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes: backs >= 4 ? nodes : [{ role: "heading", label: "Nested settings" }],
          }),
        press: () => {
          backs += 1;
          return Promise.resolve({});
        },
      }),
      {
        kind: "expect-screen",
        screenId: "home",
        screenTitle: "Home",
        fingerprint,
        recovery: { strategy: "back", maxAttempts: 6 },
      },
      {
        log: (line) => lines.push(line),
        observeVisualFingerprint: () => Promise.resolve("b".repeat(64)),
      },
    );
    assert.equal(backs, 4);
    assert.deepEqual(lines.at(-1), "screen: reached Home");
  });

  it("reuses fresh verified nodes for the immediate tap and invalidates after mutation", async () => {
    const sourceNodes = [
      {
        role: "button",
        label: "Continue",
        enabled: true,
        hittable: true,
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
    ];
    const fingerprint = observeScreenIdentity(sourceNodes).fingerprint;
    let snapshots = 0;
    let presses = 0;
    const device = stubDevice({
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ nodes: sourceNodes });
      },
      press: () => {
        presses += 1;
        return Promise.resolve({});
      },
    });
    const job = { artifacts: [], resolvedInputs: {} } as unknown as TestJob;
    const runtime = {};
    const verifyContext: RecipeStepContext = { log: () => {}, job, runtime };
    const tapContext: RecipeStepContext = { log: () => {}, job, runtime };

    await runRecipeStep(
      device,
      { kind: "expect-screen", screenId: "source", screenTitle: "Source", fingerprint },
      verifyContext,
    );
    await runRecipeStep(device, { kind: "tap", target: { label: "Continue" } }, tapContext);

    assert.equal(snapshots, 1);
    assert.equal(presses, 1);
    assert.equal(tapContext.runtime?.verifiedScreen, undefined);
    assert.equal(tapContext.runtime?.observation, undefined);
  });

  it("refreshes a stale off-screen label instead of dispatching its cached point", async () => {
    const staleNodes = [
      {
        role: "application",
        enabled: true,
        rect: { x: -1080, y: 0, width: 1080, height: 2340 },
      },
      {
        role: "button",
        label: "Privacy Policy",
        enabled: true,
        hittable: true,
        rect: { x: -760, y: 1256, width: 890, height: 143 },
      },
    ];
    const freshNodes = [
      {
        role: "application",
        enabled: true,
        rect: { x: 0, y: 0, width: 1080, height: 2340 },
      },
      {
        role: "button",
        label: "Privacy Policy",
        enabled: true,
        hittable: true,
        rect: { x: 45, y: 1266, width: 990, height: 158 },
      },
    ];
    let snapshots = 0;
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ nodes: freshNodes });
      },
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
    });
    const job = { artifacts: [], resolvedInputs: {} } as unknown as TestJob;
    const ctx: RecipeStepContext = {
      log: () => {},
      job,
      runtime: {
        verifiedScreen: {
          screenId: "settings",
          screenTitle: "Settings",
          nodes: staleNodes,
          observedAt: 100,
          verifiedAt: 100,
        },
      },
    };

    await runRecipeStep(device, { kind: "tap", target: { label: "Privacy Policy" } }, ctx);

    assert.equal(snapshots, 1);
    assert.deepEqual(presses, [
      {
        platform: "android",
        serial: "recipe-runner-test",
        x: 540,
        y: 1345,
      },
    ]);
  });

  it("fails closed when Android accessibility says a named target is absent", async () => {
    let snapshots = 0;
    let presses = 0;
    const visibleNodes = [
      {
        role: "button",
        label: "App Language",
        enabled: true,
        hittable: true,
        rect: { x: 45, y: 1700, width: 990, height: 158 },
      },
    ];
    const device = stubDevice({
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ nodes: visibleNodes });
      },
      press: () => {
        presses += 1;
        return Promise.resolve({});
      },
    });
    const ctx: RecipeStepContext = {
      log: () => {},
      runtime: {
        verifiedScreen: {
          screenId: "usage",
          screenTitle: "Usage",
          nodes: visibleNodes,
          observedAt: 100,
          verifiedAt: 100,
        },
      },
    };

    await assert.rejects(
      runRecipeStep(device, { kind: "tap", target: { label: "Set Up Auto Top-Up" } }, ctx),
      /named target absent from current Android accessibility tree/u,
    );
    assert.equal(snapshots, 1);
    assert.equal(presses, 0);
  });

  it("reuses one unchanged automatic observation for destination assertion and semantic tap", async () => {
    const destinationNodes = [
      {
        role: "button",
        label: "Continue",
        enabled: true,
        hittable: true,
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
    ];
    const fingerprint = observeScreenIdentity(destinationNodes).fingerprint;
    let snapshots = 0;
    let presses = 0;
    const device = stubDevice({
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ nodes: destinationNodes });
      },
      press: () => {
        presses += 1;
        return Promise.resolve({});
      },
    });
    const ctx: RecipeStepContext = {
      log: () => {},
      runtime: {
        observation: { nodes: destinationNodes, observedAt: 123 },
      },
    };

    await runRecipeStep(
      device,
      {
        kind: "expect-screen",
        screenId: "destination",
        screenTitle: "Destination",
        fingerprint,
      },
      ctx,
    );
    await runRecipeStep(device, { kind: "tap", target: { label: "Continue" } }, ctx);

    assert.equal(snapshots, 0);
    assert.equal(presses, 1);
    assert.equal(ctx.runtime?.observation, undefined);
  });

  it("does not reuse verified nodes after an intervening mutation", async () => {
    const sourceNodes = [
      {
        role: "button",
        label: "Continue",
        enabled: true,
        hittable: true,
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
    ];
    const fingerprint = observeScreenIdentity(sourceNodes).fingerprint;
    let snapshots = 0;
    const device = stubDevice({
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ nodes: sourceNodes });
      },
    });
    const ctx: RecipeStepContext = { log: () => {}, runtime: {} };

    await runRecipeStep(
      device,
      { kind: "expect-screen", screenId: "source", screenTitle: "Source", fingerprint },
      ctx,
    );
    await runRecipeStep(device, { kind: "key", key: "back" }, ctx);
    await runRecipeStep(device, { kind: "tap", target: { label: "Continue" } }, ctx);

    // One expect snapshot, then the normal uncached target resolution and
    // native-label fallback snapshots after Back invalidated the proof.
    assert.equal(snapshots, 3);
  });

  it("falls back to a fresh tree when verified nodes do not contain the target", async () => {
    const verifiedNodes = [{ role: "heading", label: "Source", enabled: true }];
    const targetNodes = [
      {
        type: "Button",
        label: "Continue",
        enabled: true,
        hittable: true,
        rect: { x: 10, y: 20, width: 100, height: 40 },
      },
    ];
    const fingerprint = observeScreenIdentity(verifiedNodes).fingerprint;
    let snapshots = 0;
    let presses = 0;
    const device = stubDevice({
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ nodes: snapshots === 1 ? verifiedNodes : targetNodes });
      },
      press: () => {
        presses += 1;
        return Promise.resolve({});
      },
    });
    const ctx: RecipeStepContext = { log: () => {}, runtime: {} };

    await runRecipeStep(
      device,
      { kind: "expect-screen", screenId: "source", screenTitle: "Source", fingerprint },
      ctx,
    );
    await runRecipeStep(device, { kind: "tap", target: { label: "Continue" } }, ctx);

    assert.equal(snapshots, 2);
    assert.equal(presses, 1);
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

  it("starts independent judges concurrently", async () => {
    let started = 0;
    let release!: () => void;
    const ready = new Promise<void>((resolve) => {
      release = resolve;
    });
    const result = {
      status: "pass" as const,
      confidence: 0.98,
      score: 1,
      summary: "Both judges agree.",
      criteria: [],
      provider: "fixture",
      model: "fixture-v1",
      evaluatedAt: Date.now(),
    };
    const makeProvider = (id: string) =>
      registerEvaluationProvider({
        id,
        evaluate: async () => {
          started += 1;
          if (started === 2) release();
          await ready;
          return { ...result, provider: id };
        },
      });
    const unregisterFirst = makeProvider("judge-concurrent-a");
    const unregisterSecond = makeProvider("judge-concurrent-b");
    const owner = job();
    owner.resolvedInputs.response = "A complete response.";
    try {
      const running = runRecipeStep(
        stubDevice({}),
        {
          kind: "evaluate-semantic",
          input: "response",
          criteria: ["The response is complete"],
          provider: "judge-concurrent-a",
          requireAgreement: true,
          secondProvider: "judge-concurrent-b",
        },
        { log: () => {}, job: owner },
      );
      await Promise.race([
        ready,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("independent judges did not start together")), 500),
        ),
      ]);
      assert.equal(started, 2);
      release();
      await running;
    } finally {
      unregisterFirst();
      unregisterSecond();
    }
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

  it("keeps a templated branch input as a variable reference", async () => {
    const owner = job();
    owner.resolvedInputs.language_identifier = "-";
    const resolved = resolveRecipeStep(
      {
        kind: "branch",
        input: "{{language_identifier}}",
        operator: "not-equals",
        expected: "-",
        thenRecipeId: "tap-identifier",
      },
      owner.resolvedInputs,
    );
    await runRecipeStep(stubDevice({}), resolved, { log: () => {}, job: owner });
    assert.deepEqual(owner.artifacts.at(-1)?.data, {
      input: "language_identifier",
      operator: "not-equals",
      expected: "-",
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

  it("does not reuse an already-visible completion control from the previous response", async () => {
    const owner = job();
    const logs: string[] = [];
    let sample = 0;
    const device = stubDevice({
      wait: () => new Promise((resolve) => setTimeout(resolve, 25)),
      snapshot: () => {
        sample += 1;
        const generating = sample === 2;
        return Promise.resolve({
          nodes: generating ? [] : [{ identifier: "response.done", label: "Regenerate" }],
        });
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "wait-response",
        target: { identifier: "response.done" },
        idleTarget: { identifier: "response.done" },
        timeoutMs: 2_000,
        stableForMs: 500,
      },
      { log: (message) => logs.push(message), job: owner },
    );

    assert.ok(!logs.some((message) => message.includes("content already complete")));
    const evidence = owner.artifacts.find((item) => item.kind === "response-completion");
    assert.equal((evidence?.data as { status?: string } | undefined)?.status, "complete");
    assert.ok(sample >= 3, "the waiter should observe the completion control leave and return");
  });
});

describe("runRecipeStep tour", () => {
  const settingsNodes = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "NavigationBar",
      identifier: "Settings",
      rect: { x: 0, y: 50, width: 834, height: 50 },
    },
    {
      type: "Cell",
      label: "Appearance",
      hittable: false,
      rect: { x: 40, y: 400, width: 700, height: 44 },
    },
    {
      type: "Cell",
      label: "Haptics",
      hittable: false,
      rect: { x: 40, y: 444, width: 700, height: 44 },
    },
  ];
  const appearanceNodes = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "NavigationBar",
      identifier: "Settings",
      rect: { x: 0, y: 50, width: 834, height: 50 },
    },
    {
      type: "Cell",
      label: "Dark",
      hittable: false,
      rect: { x: 40, y: 400, width: 700, height: 44 },
    },
    {
      type: "Button",
      label: "Back",
      hittable: true,
      rect: { x: 20, y: 70, width: 60, height: 36 },
    },
  ];

  it("fails closed when pixels-only and no mapped fallback stops", async () => {
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [] }),
    });
    await assert.rejects(
      () => runIosRecipeStep(device, { kind: "tour", screenshot: false }, noLog),
      /tour:no-rows/,
    );
  });

  it("walks mapped fallback stops when the live tree is empty", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [] }),
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });
    await runRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        fallbackStops: [{ label: "Appearance", point: { x: 240, y: 422 } }],
        // With no live tree or recorded origin identity there is no truthful
        // way to verify a return. Finish on the explicitly mapped final child.
        returnAfterLast: false,
      },
      noLog,
    );
    assert.deepEqual(presses, [
      { platform: "android", serial: "recipe-runner-test", x: 240, y: 422 },
    ]);
  });

  it("keeps popping until origin rows return, not just the shared header", async () => {
    let screen: "settings" | "appearance" | "haptics" = "settings";
    const presses: unknown[] = [];
    const visits: string[] = [];
    const backs: number[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({ nodes: screen === "settings" ? settingsNodes : appearanceNodes }),
      press: (options) => {
        const selector =
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "";
        const point = options as { x?: number; y?: number };
        presses.push(options);
        if (selector.includes("Appearance") || point.y === 422) {
          screen = "appearance";
          visits.push("Appearance");
        }
        if (selector.includes("Haptics") || point.y === 466) {
          screen = "haptics";
          visits.push("Haptics");
        }
        if (selector.includes("Back") || point.y === 88) screen = "settings";
        return Promise.resolve({});
      },
      back: () => {
        backs.push(1);
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });

    await runIosRecipeStep(
      device,
      { kind: "tour", screenshot: false, excludeLanguageRows: true },
      noLog,
    );

    assert.deepEqual(visits, ["Appearance", "Haptics"]);
    assert.ok(
      presses.some(
        (action) =>
          typeof action === "object" && action !== null && (action as { y?: number }).y === 88,
      ),
      "the observed Back bounds should return each child even though the header is unchanged",
    );
    assert.equal(backs.length, 0, "a verified app Back should precede hardware Back");
    assert.equal(screen, "settings");
  });

  const automationsNodes = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "NavigationBar",
      identifier: "Settings",
      rect: { x: 0, y: 50, width: 834, height: 50 },
    },
    {
      type: "Cell",
      label: "Shortcuts",
      hittable: false,
      rect: { x: 40, y: 400, width: 700, height: 44 },
    },
    {
      type: "Cell",
      label: "Automations",
      hittable: false,
      rect: { x: 40, y: 444, width: 700, height: 44 },
    },
    {
      type: "Button",
      label: "Back",
      hittable: true,
      rect: { x: 20, y: 70, width: 60, height: 36 },
    },
  ];

  it("backs from the wrong list before walking mapped Settings rows", async () => {
    let screen: "automations" | "settings" | "appearance" = "automations";
    const presses: unknown[] = [];
    const visits: string[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes:
            screen === "settings"
              ? settingsNodes
              : screen === "appearance"
                ? appearanceNodes
                : automationsNodes,
        }),
      press: (options) => {
        const selector =
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "";
        const point = options as { x?: number; y?: number };
        presses.push(options);
        if (selector.includes("Back") || point.y === 88) screen = "settings";
        if (selector.includes("Appearance") || point.y === 422) {
          screen = "appearance";
          visits.push("Appearance");
        }
        return Promise.resolve({});
      },
      back: () => {
        screen = "settings";
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });

    await runIosRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        excludeLanguageRows: true,
        originTitle: "Settings",
        fallbackStops: [{ label: "Appearance" }, { label: "Haptics" }],
      },
      noLog,
    );

    assert.ok(
      presses.some(
        (action) =>
          typeof action === "object" && action !== null && (action as { y?: number }).y === 88,
      ),
      "the verified leading Back point should leave the wrong list",
    );
    assert.deepEqual(visits, ["Appearance"]);
    assert.ok(
      !presses.some(
        (action) =>
          typeof action === "object" &&
          action !== null &&
          "selector" in action &&
          String((action as { selector?: string }).selector).includes("Automations"),
      ),
    );
  });

  it("skips an unavailable optional mapped row without falling back to its old point", async () => {
    let screen: "settings" | "appearance" = "settings";
    const presses: unknown[] = [];
    const visits: string[] = [];
    const logs: string[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({ nodes: screen === "settings" ? settingsNodes : appearanceNodes }),
      press: (options) => {
        const selector =
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "";
        const point = options as { x?: number; y?: number };
        presses.push(options);
        if (selector.includes("Appearance") || point.y === 422) {
          screen = "appearance";
          visits.push("Appearance");
        }
        if (selector.includes("Back") || point.y === 88) screen = "settings";
        return Promise.resolve({});
      },
      back: () => {
        screen = "settings";
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });

    await runIosRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        originTitle: "Settings",
        originFingerprint: observeScreenIdentity(settingsNodes).fingerprint,
        fallbackStops: [
          { label: "Appearance" },
          { label: "Buy More", point: { x: 300, y: 700 }, optional: true },
        ],
        mappedStopsOnly: true,
      },
      { log: (line) => logs.push(line) },
    );

    assert.deepEqual(visits, ["Appearance"]);
    assert.ok(
      !presses.some(
        (action) =>
          typeof action === "object" &&
          action !== null &&
          (action as { x?: number }).x === 300 &&
          (action as { y?: number }).y === 700,
      ),
      "the unavailable row's recorded point must never be used",
    );
    assert.ok(
      logs.some(
        (line) => line.includes("optional row(s) unavailable") && line.includes("Buy More"),
      ),
    );
  });

  it("recognizes a translated tour origin from stable native identity and structure", async () => {
    const englishOrigin = [
      {
        type: "Application",
        identifier: "ai.x.grok",
        label: "Grok",
        rect: { x: 0, y: 0, width: 412, height: 915 },
      },
      {
        type: "Button",
        identifier: "settings.close",
        label: "Close",
        hittable: true,
        rect: { x: 24, y: 48, width: 48, height: 48 },
      },
      {
        type: "TextView",
        identifier: "settings.shared",
        label: "Shared Conversations",
        hittable: true,
        rect: { x: 24, y: 250, width: 360, height: 56 },
      },
    ];
    const italianOrigin = [
      {
        type: "Application",
        identifier: "ai.x.grok",
        label: "Grok",
        rect: { x: 0, y: 0, width: 412, height: 915 },
      },
      {
        type: "Button",
        identifier: "settings.close",
        label: "Chiudi",
        hittable: true,
        rect: { x: 24, y: 48, width: 48, height: 48 },
      },
      {
        type: "TextView",
        identifier: "settings.shared",
        label: "Conversazioni condivise",
        hittable: true,
        rect: { x: 24, y: 250, width: 360, height: 56 },
      },
    ];
    const presses: string[] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: italianOrigin }),
      press: (options) => {
        presses.push(
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "",
        );
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });

    await runRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        originTitle: "Settings",
        originObservations: [observeScreenIdentity(englishOrigin)],
        fallbackStops: [{ label: "Shared Conversations", identifier: "settings.shared" }],
      },
      { log: () => {}, job: { resolvedInputs: { language: "it" } } as never },
    );

    assert.ok(presses.length > 0);
    assert.ok(!presses.some((selector) => selector.includes("Back")));
  });

  it("walks a reflowed translated list by semantic row checkpoints", async () => {
    const english = [
      "Profile",
      "NSFW Preferences",
      "Voice",
      "Shared Conversations",
      "Data Controls",
    ];
    const italian = [
      "Profilo",
      "Preferenze molto lunghe",
      "Voce",
      "Conversazioni condivise",
      "Controllo dati",
    ];
    const viewports = [italian.slice(0, 2), italian.slice(1, 4), italian.slice(3)];
    let viewport = 1;
    let screen: "parent" | "child" = "parent";
    const visited: string[] = [];
    const parentNodes = () => [
      {
        type: "Application",
        identifier: "ai.x.grok",
        label: "Grok",
        rect: { x: 0, y: 0, width: 412, height: 915 },
      },
      ...viewports[viewport]!.map((label, index) => ({
        type: "Cell",
        label,
        hittable: true,
        rect: { x: 24, y: 180 + index * (viewport === 0 ? 250 : 190), width: 360, height: 96 },
      })),
    ];
    const childNodes = () => [
      {
        type: "Application",
        identifier: "ai.x.grok",
        label: "Grok",
        rect: { x: 0, y: 0, width: 412, height: 915 },
      },
      {
        type: "Button",
        label: "Indietro",
        hittable: true,
        rect: { x: 20, y: 54, width: 64, height: 48 },
      },
    ];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({ nodes: screen === "parent" ? parentNodes() : childNodes() }),
      scroll: (options) => {
        if (screen !== "parent") throw new Error("refused to scroll child");
        const direction = (options as { direction?: string }).direction;
        viewport = Math.max(
          0,
          Math.min(viewports.length - 1, viewport + (direction === "down" ? 1 : -1)),
        );
        return Promise.resolve({});
      },
      press: (options) => {
        const selector =
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "";
        const selected = italian.find((label) => selector.includes(label));
        if (selected) {
          visited.push(selected);
          screen = "child";
        } else if (typeof options === "object" && options && "x" in options && "y" in options) {
          screen = "parent";
        }
        return Promise.resolve({});
      },
      back: () => {
        screen = "parent";
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });

    await runRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        originVerifiedBySetup: true,
        mappedStopsOnly: true,
        fallbackStops: english.slice(1).map((label) => ({ label })),
        landmarkStops: english.map((label) => ({ label })),
        scrollSearch: { maxScrolls: 8, amount: 0.5 },
      },
      { log: () => {}, job: { resolvedInputs: { language: "it" } } as never },
    );

    assert.deepEqual(visited, italian.slice(1));
    assert.equal(screen, "parent");
  });

  it("does not seek backwards after a setup flow has verified a localized origin", async () => {
    const presses: string[] = [];
    const device = stubDevice({
      // Deliberately does not overlap the saved English origin identity. The
      // preceding setup flow—not these localized labels—establishes origin.
      snapshot: () =>
        Promise.resolve({
          nodes: [
            { type: "Application", identifier: "ai.x.grok", label: "Grok" },
            { type: "TextView", label: "Personalizza Grok", hittable: true },
          ],
        }),
      press: (options) => {
        presses.push(
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "",
        );
        return Promise.resolve({});
      },
      back: () => {
        presses.push("hardware-back");
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });

    await runRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        originTitle: "Settings · Middle upper",
        originVerifiedBySetup: true,
        mappedStopsOnly: true,
      },
      { log: () => {}, job: { resolvedInputs: { language: "it" } } as never },
    );

    assert.deepEqual(presses, []);
  });

  it("runs a mapped prelude only when the device is not already on origin", async () => {
    let screen: "home" | "settings" = "home";
    const presses: unknown[] = [];
    const visits: string[] = [];
    const homeNodes = [
      { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
      {
        type: "Button",
        identifier: "sidebar.settings.button",
        label: "Gear",
        hittable: true,
        rect: { x: 40, y: 80, width: 44, height: 44 },
      },
    ];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: screen === "settings" ? settingsNodes : homeNodes }),
      press: (options) => {
        const selector =
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "";
        const point = options as { x?: number; y?: number };
        presses.push(options);
        if (selector.includes("sidebar.settings.button") || selector.includes("Settings")) {
          screen = "settings";
        }
        if (selector.includes("Appearance") || point.y === 422) visits.push("Appearance");
        if (selector.includes("Back") || point.y === 88) screen = "settings";
        return Promise.resolve({});
      },
      back: () => Promise.resolve({}),
      wait: () => Promise.resolve({}),
    });

    await runIosRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        excludeLanguageRows: true,
        originTitle: "Settings",
        preludeSteps: [{ kind: "tap", target: { identifier: "sidebar.settings.button" } }],
        fallbackStops: [{ label: "Appearance" }, { label: "Haptics" }],
      },
      noLog,
    );

    assert.match(
      String((presses[0] as { selector?: string } | undefined)?.selector ?? ""),
      /sidebar\.settings\.button/,
    );
    assert.deepEqual(visits, ["Appearance"]);
  });

  it("fails closed when seek never reaches the mapped origin", async () => {
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: automationsNodes }),
      press: () => Promise.resolve({}),
      back: () => Promise.resolve({}),
      wait: () => Promise.resolve({}),
    });
    await assert.rejects(
      () =>
        runIosRecipeStep(
          device,
          {
            kind: "tour",
            screenshot: false,
            originTitle: "Settings",
            fallbackStops: [{ label: "Appearance" }, { label: "Haptics" }],
          },
          noLog,
        ),
      /tour:not-on-origin/,
    );
  });
});
