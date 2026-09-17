import { InputNotDispatchedError, InputOutcomeUnknownError } from "./input-not-dispatched.js";
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
  runCampaignCheck,
} from "./recipe-runner-campaign-checks.js";
import { IosSnapshotStaleAfterInputError } from "./ios-snapshot-flight.js";

it("recognizes right-to-left app locales for mirrored point fallbacks", () => {
  assert.equal(isRightToLeftRun({ language: "ar" }), true);
  assert.equal(isRightToLeftRun({ locale: "he-IL" }), true);
  assert.equal(isRightToLeftRun({ language: "pt-BR" }), false);
});
import { IosMutationOutcomeUnknownError, pressPoint, snapshot, type Device } from "./device.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { currentVerifiedScreen, type VerifiedScreenCheckpoint } from "./recipe-runner-context.js";
import type { TestJob } from "./session.js";
import { registerEvaluationProvider } from "./evaluation.js";
import { saveRecipe, type RecipeStep } from "./recipes.js";
import {
  clearControl,
  cooperativeCheckpoint,
  JobCancelledError,
  requestCancel,
  requestResume,
  runWithJobControl,
} from "./control.js";
import { runWithTargetContext } from "./target-context.js";
import { observeScreenIdentity } from "./screen-identity.js";
import { runExpectScreenStep } from "./recipe-runner-screen.js";
import { runTourStep } from "./recipe-runner-tour.js";
import {
  collectSemanticTourRows,
  seekSemanticTourRow,
} from "./recipe-runner-tour-scroll-runtime.js";
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

function provenNavigation(checkpoint: VerifiedScreenCheckpoint) {
  return {
    status: "proven" as const,
    screenId: checkpoint.screenId,
    proofToken: `test:${checkpoint.screenId}:${checkpoint.verifiedAt}`,
    source: "screen-observation" as const,
    updatedAt: checkpoint.verifiedAt,
    checkpoint,
  };
}

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

  it("uses a reviewed point fallback when Home labels collide", async () => {
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
      {
        kind: "tap",
        target: { label: "Home", point: { x: 240, y: 720, fallbackPolicy: "reviewed" } },
      },
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
        // iOS fills carry the same non-hittable coordinate-fallback
        // coordination presses use, so the first attempt can steer the
        // native adapter instead of paying a second traversal.
        maestro: { allowNonHittableCoordinateFallback: true },
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

  it("replaces browser composer text without Android adb", async () => {
    const fills: unknown[] = [];
    const device = stubDevice({
      fill: (options) => {
        fills.push(options);
        return Promise.resolve({});
      },
    });
    await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
      runRecipeStepWithoutContext(
        device,
        {
          kind: "type",
          mode: "replace",
          text: "hello",
          target: { label: "Ask Grok anything" },
        },
        noLog,
      ),
    );
    assert.equal(fills.length, 1);
    assert.equal((fills[0] as { text?: string }).text, "hello");
    assert.equal((fills[0] as { selector?: string }).selector, 'label="Ask Grok anything"');
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
    const device = stubDevice({
      press: () => Promise.reject(new Error("Selector did not match an element")),
    });

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

  it("does not swallow an unknown iOS mutation from an optional step", async () => {
    let presses = 0;
    const job = { artifacts: [] } as unknown as TestJob;
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              role: "button",
              label: "Continue",
              enabled: true,
              hittable: true,
              rect: { x: 20, y: 80, width: 160, height: 44 },
            },
          ],
        }),
      press: () => {
        presses += 1;
        return Promise.reject(new Error("XCTest connection reset"));
      },
    });

    await assert.rejects(
      runIosRecipeStep(
        device,
        { kind: "tap", target: { label: "Continue" }, optional: true },
        { ...noLog, job },
      ),
      IosMutationOutcomeUnknownError,
    );

    assert.equal(presses, 1);
    assert.equal(
      job.artifacts.some((artifact) => artifact.kind === "optional-step-skipped"),
      false,
    );
  });
});

describe("iOS recipe outcome-unknown terminal policy", () => {
  it("does not try a second locator after the first iOS locator may have landed", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [] }),
      press: (input) => {
        presses.push(input);
        return Promise.reject(new Error("XCTest transport ended"));
      },
    });

    await assert.rejects(
      runIosRecipeStep(
        device,
        {
          kind: "tap",
          target: { ref: "@stale-control" },
          fallbackTargets: [{ label: "Continue" }],
        },
        noLog,
      ),
      IosMutationOutcomeUnknownError,
    );

    assert.equal(presses.length, 1);
    assert.equal((presses[0] as { ref?: string }).ref, "@stale-control");
  });

  it("does not turn an unknown semantic Back into a hardware Back", async () => {
    let semanticBacks = 0;
    let hardwareBacks = 0;
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [{ role: "heading", label: "Wrong screen" }] }),
      press: () => {
        semanticBacks += 1;
        return Promise.reject(new Error("XCTest transport ended"));
      },
      back: () => {
        hardwareBacks += 1;
        return Promise.resolve({});
      },
    });

    await assert.rejects(
      runWithTargetContext({ kind: "device", platform: "ios", serial: "expect-unknown-back" }, () =>
        runExpectScreenStep(
          device,
          {
            kind: "expect-screen",
            screenId: "settings",
            screenTitle: "Settings",
            fingerprint: "a".repeat(64),
            recovery: { strategy: "back", maxAttempts: 1 },
          },
          {
            log: () => {},
            observeVisualFingerprint: () => Promise.resolve("b".repeat(64)),
          },
        ),
      ),
      IosMutationOutcomeUnknownError,
    );

    assert.equal(semanticBacks, 1);
    assert.equal(hardwareBacks, 0);
  });

  it("does not continue semantic tour indexing after an unknown iOS scroll", async () => {
    const nodes = [
      {
        type: "Cell",
        label: "Row A",
        hittable: true,
        rect: { x: 20, y: 100, width: 300, height: 60 },
      },
    ];
    const directions: string[] = [];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes }),
      scroll: (input) => {
        directions.push(String((input as { direction?: string }).direction));
        return directions.length === 1
          ? Promise.resolve({})
          : Promise.reject(new Error("XCTest transport ended"));
      },
    });
    const surface = {
      nodes,
      stops: [{ label: "Row A", point: { x: 170, y: 130 } }],
    };

    await assert.rejects(
      runWithTargetContext(
        { kind: "device", platform: "ios", serial: "tour-index-unknown-scroll" },
        () =>
          collectSemanticTourRows(
            device,
            { kind: "tour", screenshot: false, scrollSearch: { maxScrolls: 4, amount: 0.5 } },
            surface,
            () => {},
          ),
      ),
      IosMutationOutcomeUnknownError,
    );

    assert.deepEqual(directions, ["up", "down"]);
  });

  it("does not normalize or retry after semantic tour row seek loses the iOS command outcome", async () => {
    const nodes = [
      {
        type: "Cell",
        label: "Row A",
        hittable: true,
        rect: { x: 20, y: 100, width: 300, height: 60 },
      },
    ];
    let scrolls = 0;
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes }),
      scroll: () => {
        scrolls += 1;
        return Promise.reject(new Error("XCTest transport ended"));
      },
    });
    const surface = {
      nodes,
      stops: [{ label: "Row A", point: { x: 170, y: 130 } }],
    };

    await assert.rejects(
      runWithTargetContext(
        { kind: "device", platform: "ios", serial: "tour-seek-unknown-scroll" },
        () =>
          seekSemanticTourRow(
            device,
            { kind: "tour", screenshot: false, scrollSearch: { maxScrolls: 4, amount: 0.5 } },
            { label: "Row B" },
            surface,
            () => {},
          ),
      ),
      IosMutationOutcomeUnknownError,
    );

    assert.equal(scrolls, 1);
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
      { ...noLog, job, runtime: {} },
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
      { ...noLog, job, runtime: {} },
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
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
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
          ? Promise.reject(new Error("Selector did not match an element"))
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
      { ...noLog, job, runtime, recipeGraph },
    );

    assert.deepEqual(presses, ['id="primary"', 'id="cleanup"']);
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-cleanup" &&
          (artifact.data as { status?: string }).status === "failed",
      ),
      true,
    );
    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
    assert.ok(result);
    const resultData = result.data as { status?: string; primaryError?: string };
    assert.equal(resultData.status, "failed");
    assert.match(resultData.primaryError ?? "", /identifier primary/u);
    assert.equal(runtime.navigationCursor?.status, "unknown");
  });

  it("never runs campaign cleanup after an unknown iOS primary mutation", async () => {
    const presses: string[] = [];
    const job = { id: "campaign-ios-unknown", artifacts: [] } as unknown as TestJob;
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
        return Promise.reject(new Error("XCTest transport ended"));
      },
      snapshot: () => Promise.resolve({ nodes: [] }),
    });

    await assert.rejects(
      runIosRecipeStep(
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
        { ...noLog, job, runtime: {}, recipeGraph },
      ),
      IosMutationOutcomeUnknownError,
    );

    assert.deepEqual(presses, ['id="primary"']);
    const cleanup = job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup");
    assert.equal((cleanup?.data as { status?: string } | undefined)?.status, "skipped");
  });

  it("never runs cancellation cleanup after an iOS command started before cancellation", async () => {
    const presses: string[] = [];
    const job = {
      id: "campaign-ios-cancelled-after-dispatch",
      artifacts: [],
    } as unknown as TestJob;
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
        if (selector.includes("primary")) {
          // The driver started the native command, then cancellation arrived
          // before it could return a trustworthy result.
          requestCancel(job.id);
          return Promise.reject(new JobCancelledError("cancelled after primary dispatch"));
        }
        return Promise.resolve({});
      },
      snapshot: () => Promise.resolve({ nodes: [] }),
    });

    try {
      await assert.rejects(
        runWithJobControl(job.id, () =>
          runIosRecipeStep(
            device,
            {
              kind: "module",
              recipeId: "primary",
              check: {
                id: "kids",
                title: "Kids Mode",
                cleanup: {
                  recipeId: "cleanup",
                  terminalScreenId: "kids-off",
                  onCancel: "run-if-controllable",
                },
              },
            },
            { ...noLog, job, runtime: {}, recipeGraph },
          ),
        ),
        (error: unknown) => {
          assert.ok(error instanceof IosMutationOutcomeUnknownError);
          assert.equal(error.iosMutation.operation, "press");
          assert.equal(error.iosMutation.cancellation?.observedAfterAttemptStarted, true);
          return true;
        },
      );
    } finally {
      clearControl(job.id);
    }

    assert.deepEqual(presses, ['id="primary"']);
    const cleanup = job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup");
    assert.equal((cleanup?.data as { status?: string } | undefined)?.status, "skipped");
  });

  it("does not defer or continue after an unknown iOS cleanup mutation", async () => {
    const presses: string[] = [];
    const job = { id: "campaign-ios-cleanup-unknown", artifacts: [] } as unknown as TestJob;
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
        return selector.includes("cleanup")
          ? Promise.reject(new Error("XCTest transport ended"))
          : Promise.resolve({});
      },
      snapshot: () => Promise.resolve({ nodes: [] }),
    });

    await assert.rejects(
      runIosRecipeStep(
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
        { ...noLog, job, runtime: {}, recipeGraph },
      ),
      IosMutationOutcomeUnknownError,
    );

    assert.deepEqual(presses, ['id="primary"', 'id="cleanup"']);
    const cleanup = job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup");
    assert.equal((cleanup?.data as { status?: string } | undefined)?.status, "interrupted");
    assert.equal(
      job.artifacts.some((artifact) => artifact.kind === "campaign-check-deferred"),
      false,
    );
  });

  it("runs cleanup after a passing primary path before marking the check passed", async () => {
    const order: string[] = [];
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
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
      { ...noLog, job, runtime, recipeGraph },
    );

    assert.deepEqual(order, ['id="primary"', 'id="cleanup"']);
    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
    assert.ok(result);
    assert.equal((result.data as { status?: string }).status, "failed");
    const cleanup = job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup");
    assert.equal((cleanup?.data as { status?: string } | undefined)?.status, "failed");
    assert.equal(runtime.navigationCursor?.status, "unknown");
  });

  it("passes cleanup only after a fresh terminal screen observation", async () => {
    const job = { id: "campaign-cleanup-proof", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const terminal = "kids-off";
    runtime.navigationCursor = provenNavigation({
      screenId: terminal,
      screenTitle: terminal,
      nodes: [],
      observedAt: 1,
      verifiedAt: 1,
    });

    await runCampaignCheck(
      stubDevice({}),
      {
        kind: "sleep",
        ms: 1,
        check: {
          id: "kids",
          title: "Kids Mode",
          cleanup: { recipeId: "cleanup", terminalScreenId: terminal, onCancel: "skip" },
        },
      },
      { ...noLog, job, runtime, recipeGraph: {} },
      async (recipeId) => {
        if (recipeId !== "cleanup") return;
        await new Promise((resolve) => setTimeout(resolve, 1));
        const at = Date.now();
        runtime.navigationCursor = provenNavigation({
          screenId: terminal,
          screenTitle: terminal,
          nodes: [],
          observedAt: at,
          verifiedAt: at,
        });
      },
    );

    assert.equal(
      (
        job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup")?.data as {
          status?: string;
        }
      )?.status,
      "passed",
    );
    assert.equal(
      (
        job.artifacts.find((artifact) => artifact.kind === "campaign-check-result")?.data as {
          status?: string;
        }
      )?.status,
      "passed",
    );
    assert.equal(currentVerifiedScreen(runtime)?.screenId, terminal);
  });

  it("fails cleanup when a fresh observation reaches the wrong screen", async () => {
    const job = { id: "campaign-cleanup-mismatch", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    await runCampaignCheck(
      stubDevice({}),
      {
        kind: "sleep",
        ms: 1,
        check: {
          id: "kids",
          title: "Kids Mode",
          cleanup: { recipeId: "cleanup", terminalScreenId: "kids-off", onCancel: "skip" },
        },
      },
      { ...noLog, job, runtime, recipeGraph: {} },
      async (recipeId) => {
        if (recipeId !== "cleanup") return;
        await new Promise((resolve) => setTimeout(resolve, 1));
        const at = Date.now();
        runtime.navigationCursor = provenNavigation({
          screenId: "kids-on",
          screenTitle: "kids-on",
          nodes: [],
          observedAt: at,
          verifiedAt: at,
        });
      },
    );

    const cleanup = job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup");
    assert.equal((cleanup?.data as { status?: string } | undefined)?.status, "failed");
    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result");
    assert.equal((result?.data as { status?: string } | undefined)?.status, "failed");
    assert.equal(runtime.navigationCursor?.status, "unknown");
    assert.equal(currentVerifiedScreen(runtime), undefined);
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
              ? "Selector did not match an element"
              : "Selector did not match an element",
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
      { ...noLog, job, runtime: {}, recipeGraph },
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

  it("skips cleanup on cancellation when the frozen policy says skip", async () => {
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
        { ...noLog, job, runtime: {}, recipeGraph },
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

  it("runs frozen cleanup after cancellation while the target remains controllable", async () => {
    const executions: string[] = [];
    const job = { id: "kids-cancel-cleanup", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const device = stubDevice({});

    try {
      await assert.rejects(
        runWithJobControl(job.id, () =>
          runCampaignCheck(
            device,
            {
              kind: "sleep",
              ms: 1,
              check: {
                id: "kids",
                title: "Kids Mode",
                cleanup: {
                  recipeId: "cleanup",
                  terminalScreenId: "kids-off",
                  onCancel: "run-if-controllable",
                },
              },
            },
            { ...noLog, job, runtime, recipeGraph: {} },
            async (recipeId) => {
              if (!recipeId) {
                executions.push("primary");
                requestCancel(job.id);
                throw new JobCancelledError("cancelled after Kids Mode was enabled");
              }
              executions.push(recipeId);
              const at = Date.now();
              runtime.navigationCursor = provenNavigation({
                screenId: "kids-off",
                screenTitle: "Kids Off",
                nodes: [],
                observedAt: at,
                verifiedAt: at,
              });
              await cooperativeCheckpoint(job.id);
            },
          ),
        ),
        /cancelled after Kids Mode was enabled/u,
      );
    } finally {
      clearControl(job.id);
    }

    assert.deepEqual(executions, ["primary", "cleanup"]);
    const cleanup = job.artifacts.find((artifact) => artifact.kind === "campaign-check-cleanup")
      ?.data as { status?: string };
    assert.equal(cleanup.status, "passed");
    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result")
      ?.data as { status?: string; cleanupStatus?: string; primaryError?: string };
    assert.equal(result.status, "cancelled");
    assert.equal(result.cleanupStatus, "passed");
    assert.match(result.primaryError ?? "", /cancelled after Kids Mode was enabled/u);
    assert.equal(runtime.navigationCursor?.status, "proven");
    assert.equal(
      runtime.navigationCursor?.status === "proven" ? runtime.navigationCursor.screenId : undefined,
      "kids-off",
    );
  });

  it("keeps cancellation primary when compensating cleanup also fails", async () => {
    const job = { id: "kids-cancel-cleanup-fails", artifacts: [] } as unknown as TestJob;
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: [] }),
    });

    try {
      await assert.rejects(
        runWithJobControl(job.id, () =>
          runCampaignCheck(
            device,
            {
              kind: "sleep",
              ms: 1,
              check: {
                id: "kids",
                title: "Kids Mode",
                cleanup: {
                  recipeId: "cleanup",
                  terminalScreenId: "kids-off",
                  onCancel: "run-if-controllable",
                },
              },
            },
            { ...noLog, job, runtime: {}, recipeGraph: {} },
            async (recipeId) => {
              if (!recipeId) {
                requestCancel(job.id);
                throw new JobCancelledError("primary cancellation");
              }
              await cooperativeCheckpoint(job.id);
              throw new Error("Kids Mode could not be restored to Off");
            },
          ),
        ),
        /primary cancellation/u,
      );
    } finally {
      clearControl(job.id);
    }

    const result = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result")
      ?.data as { status?: string; primaryError?: string; cleanupError?: string };
    assert.equal(result.status, "cancelled");
    assert.match(result.primaryError ?? "", /primary cancellation/u);
    assert.match(result.cleanupError ?? "", /could not be restored to Off/u);
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-evidence" &&
          (artifact.data as { phase?: string }).phase === "cleanup",
      ),
      true,
    );
  });

  it("blocks a sibling warm path when the failed leaf leaves its origin unknown", async () => {
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
    const recovery = {
      groupId: "settings",
      recipeId: "recover",
      mode: "warm-transition" as const,
    };
    const device = stubDevice({
      press: () => Promise.reject(new Error("Selector did not match an element")),
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
      ["blocked", "failed"],
    );
    assert.equal(waits.length >= 1, true);
    assert.equal(
      logs.some((line) => line.includes("Cold recovery")),
      false,
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

  it("keeps verified ancestors but blocks later warm paths after a leaf loses the cursor", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const logs: string[] = [];
    const sharedDependency = {
      connectionId: "open-navigation",
      originScreenId: "home",
      destination: { kind: "screen" as const, screenId: "navigation" },
    };
    const leafDependency = {
      connectionId: "open-supergrok",
      originScreenId: "settings",
      destination: { kind: "screen" as const, screenId: "supergrok" },
    };
    const appearanceDependency = {
      connectionId: "open-appearance",
      originScreenId: "settings",
      destination: { kind: "screen" as const, screenId: "appearance" },
    };
    const moreDependency = {
      connectionId: "open-supergrok-more",
      originScreenId: "supergrok",
      destination: { kind: "screen" as const, screenId: "supergrok-more" },
    };
    const settingsRecovery = {
      groupId: "transition:open-navigation",
      recipeId: "confirm-nav",
      transitionId: "open-navigation",
      mode: "warm-transition" as const,
    };
    const superGrokRecovery = {
      groupId: "transition:open-supergrok",
      recipeId: "confirm-supergrok",
      transitionId: "open-supergrok",
      mode: "warm-transition" as const,
    };
    const moreRecovery = {
      groupId: "transition:open-supergrok-more",
      recipeId: "confirm-more",
      transitionId: "open-supergrok-more",
      mode: "warm-transition" as const,
    };
    const appearanceRecovery = {
      groupId: "transition:open-appearance",
      recipeId: "confirm-appearance",
      transitionId: "open-appearance",
      mode: "warm-transition" as const,
    };
    const recipeGraph = {
      settings: {
        id: "settings",
        title: "Visit Settings",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      appearance: {
        id: "appearance",
        title: "Visit Appearance from Settings",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      "supergrok-more": {
        id: "supergrok-more",
        title: "Visit SuperGrok More",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      "confirm-nav": {
        id: "confirm-nav",
        title: "Navigation · warm transition confirmation",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 99 }],
        createdAt: 1,
        updatedAt: 1,
      },
      "confirm-supergrok": {
        id: "confirm-supergrok",
        title: "SuperGrok · warm transition confirmation",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 99 }],
        createdAt: 1,
        updatedAt: 1,
      },
      "confirm-appearance": {
        id: "confirm-appearance",
        title: "Appearance · source-proven transition confirmation",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 99 }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const device = stubDevice({
      press: () => Promise.reject(new Error("Selector did not match an element")),
      wait: async () => {},
    });
    const context = { log: (line: string) => logs.push(line), job, runtime, recipeGraph };

    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "settings",
        check: {
          id: "visit-settings",
          title: "Visit Settings",
          recovery: settingsRecovery,
          transitionDependencies: [sharedDependency],
        },
      },
      context,
    );
    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "supergrok" },
        check: {
          id: "visit-supergrok",
          title: "Visit SuperGrok",
          recovery: superGrokRecovery,
          transitionDependencies: [sharedDependency, leafDependency],
        },
      },
      context,
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "supergrok-more",
        check: {
          id: "visit-supergrok-more",
          title: "Visit SuperGrok More",
          recovery: moreRecovery,
          transitionDependencies: [sharedDependency, leafDependency, moreDependency],
        },
      },
      context,
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "appearance",
        check: {
          id: "visit-appearance",
          title: "Visit Appearance",
          recovery: appearanceRecovery,
          transitionDependencies: [sharedDependency, appearanceDependency],
        },
      },
      context,
    );

    assert.equal(runtime.campaignTransitionProofs?.["open-navigation"]?.status, "verified");
    assert.equal(
      runtime.campaignTransitionProofs?.["open-supergrok"]?.status,
      "needs-confirmation",
    );
    assert.deepEqual(
      job.artifacts
        .filter((artifact) => artifact.kind === "campaign-check-result")
        .map((artifact) => [
          (artifact.data as { id: string; status: string }).id,
          (artifact.data as { status: string }).status,
        ]),
      [
        ["visit-settings", "passed"],
        ["visit-supergrok-more", "blocked"],
        ["visit-appearance", "blocked"],
      ],
    );
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-result" &&
          (artifact.data as { id?: string; stoppedMutations?: boolean }).id ===
            "visit-supergrok-more" &&
          (artifact.data as { stoppedMutations?: boolean }).stoppedMutations === true,
      ),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("Navigation · warm transition confirmation")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("check blocked before mutation: Visit SuperGrok More")),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("Appearance · source-proven transition confirmation")),
      false,
    );
  });

  it("refuses an authored warm recipe when no canonical source proof was declared", async () => {
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
    const recovery = {
      groupId: "settings",
      recipeId: "recover",
      mode: "warm-transition" as const,
    };
    const device = stubDevice({
      press: () => Promise.reject(new Error("Selector did not match an element")),
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
      ["blocked", "failed"],
    );
    assert.equal(waits.length >= 1, true);
    assert.equal(
      logs.some((line) => line.includes("Visit next leaf from the current parent")),
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("Cold recovery")),
      false,
    );
    assert.equal(runtime.deferredCampaignChecks?.length, 0);
  });

  it("refuses a recovery merely labeled warm when it has no frozen source proof", async () => {
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
    const recovery = {
      groupId: "settings",
      recipeId: "recover",
      mode: "warm-transition" as const,
    };
    const device = stubDevice({
      press: () => Promise.reject(new Error("Selector did not match an element")),
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
      false,
    );
    assert.equal(
      logs.some((line) => line.includes("Warm path")),
      false,
    );
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-result" &&
          (artifact.data as { id?: string; status?: string }).id === "next" &&
          (artifact.data as { status?: string }).status === "blocked",
      ),
      true,
    );
    assert.equal(
      runtime.navigationCursor?.status,
      "unknown",
      "a recovery recipe without destination proof cannot make location trusted",
    );
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
      stubDevice({ press: () => Promise.reject(new Error("Selector did not match an element")) }),
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

  it("halts campaign mutations when the target disappears and preserves prior outcomes", async () => {
    const job = { id: "transport-boundary", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const logs: string[] = [];
    let snapshotReads = 0;
    let cleanupMutations = 0;
    const device = stubDevice({
      snapshot: async () => {
        snapshotReads += 1;
        return { nodes: [] };
      },
    });
    const context = { log: (line: string) => logs.push(line), job, runtime, recipeGraph: {} };

    await runCampaignCheck(
      device,
      { kind: "sleep", ms: 1, check: { id: "advanced", title: "Visit Advanced" } },
      context,
      async () => {
        throw new Error("expect-screen: on unknown, not Settings");
      },
      { allowDefer: false },
    );
    const snapshotReadsBeforeDisconnect = snapshotReads;
    runtime.navigationCursor = {
      status: "proven",
      screenId: "settings",
      proofToken: "transport-boundary:settings",
      source: "transition",
      updatedAt: Date.now(),
    };

    await assert.rejects(
      runCampaignCheck(
        device,
        {
          kind: "sleep",
          ms: 1,
          check: {
            id: "terms",
            title: "Visit Terms of Use",
            cleanup: {
              recipeId: "return-settings",
              terminalScreenId: "settings",
              onCancel: "skip",
            },
          },
        },
        context,
        async (recipeId) => {
          if (recipeId === "return-settings") cleanupMutations += 1;
          throw new Error(
            "Command failed: adb -s pixel-1 exec-out screencap -p\n" +
              "error: device 'pixel-1' not found\n",
          );
        },
      ),
      /device 'pixel-1' not found/u,
    );

    assert.equal(cleanupMutations, 0, "cleanup must not mutate a missing target");
    assert.equal(
      snapshotReads,
      snapshotReadsBeforeDisconnect,
      "disconnect evidence must not issue another target read",
    );
    assert.deepEqual(
      job.artifacts
        .filter((artifact) => artifact.kind === "campaign-check-result")
        .map((artifact) => [
          (artifact.data as { id: string }).id,
          (artifact.data as { status: string }).status,
        ]),
      [
        ["advanced", "failed"],
        ["terms", "interrupted"],
      ],
    );
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "target-transport-failure" &&
          (artifact.data as { stoppedMutations?: boolean }).stoppedMutations === true,
      ),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("stopping the run")),
      true,
    );
  });

  it("halts when cleanup loses the target instead of starting another check", async () => {
    const job = { id: "cleanup-transport-boundary", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    let primaryRan = false;
    await assert.rejects(
      runCampaignCheck(
        stubDevice({}),
        {
          kind: "sleep",
          ms: 1,
          check: {
            id: "kids-mode",
            title: "Kids Mode",
            cleanup: {
              recipeId: "restore-off",
              terminalScreenId: "settings",
              onCancel: "skip",
            },
          },
        },
        { ...noLog, job, runtime, recipeGraph: {} },
        async (recipeId) => {
          if (!recipeId) {
            primaryRan = true;
            return;
          }
          throw new Error("device 'pixel-1' is offline");
        },
      ),
      /offline/u,
    );

    assert.equal(primaryRan, true);
    const interrupted = job.artifacts.find((artifact) => artifact.kind === "campaign-check-result")
      ?.data as { status?: string; phase?: string; interruption?: string };
    assert.equal(interrupted.status, "interrupted");
    assert.equal(interrupted.phase, "cleanup");
    assert.equal(interrupted.interruption, "target-unavailable");
  });

  it("does not execute a recovery that lacks an independently provable source", async () => {
    const job = { id: "campaign-job", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const recovery = {
      groupId: "settings",
      recipeId: "recover",
      mode: "warm-transition" as const,
    };
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
    const device = stubDevice({
      press: () => Promise.reject(new Error("Selector did not match an element")),
    });
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
      ["blocked", "blocked"],
    );
    assert.equal(runtime.campaignRecoveryGroups?.settings, undefined);
  });

  it("does not confirm a shared transition with a mutation-first recovery", async () => {
    const job = { id: "fb3a7728", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const logs: string[] = [];
    let settingsAttempts = 0;
    const sharedDependency = {
      connectionId: "open-settings-top",
      originScreenId: "start",
      destination: { kind: "screen" as const, screenId: "settings-top" },
    };
    const unrelatedDependency = {
      connectionId: "open-profile",
      originScreenId: "start",
      destination: { kind: "screen" as const, screenId: "profile" },
    };
    const recovery = {
      groupId: "transition:open-settings-top",
      recipeId: "confirm-open-settings-top",
      transitionId: "open-settings-top",
      mode: "warm-transition" as const,
      coldRecipeId: "proposed-cold-open-settings-top",
    };
    const recipeGraph = {
      "confirm-open-settings-top": {
        id: "confirm-open-settings-top",
        title: "Confirm open settings top",
        source: "custom" as const,
        steps: [{ kind: "tap" as const, target: { identifier: "settings_button" } }],
        createdAt: 1,
        updatedAt: 1,
      },
      "dependent-warm": {
        id: "dependent-warm",
        title: "Dependent warm path",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
      unrelated: {
        id: "unrelated",
        title: "Unrelated authored check",
        source: "custom" as const,
        steps: [{ kind: "sleep" as const, ms: 1 }],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    const device = stubDevice({
      press: () => {
        settingsAttempts += 1;
        return Promise.reject(new Error("Selector did not match an element"));
      },
      wait: async () => {},
    });
    const context = { log: (line: string) => logs.push(line), job, runtime, recipeGraph };

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { identifier: "settings_button" },
        check: {
          id: "visit-settings",
          title: "Visit Settings",
          recovery,
          transitionDependencies: [sharedDependency],
        },
      },
      context,
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "dependent-warm",
        check: {
          id: "usage",
          title: "Usage",
          recovery,
          transitionDependencies: [sharedDependency],
        },
      },
      context,
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "dependent-warm",
        check: {
          id: "privacy",
          title: "Privacy",
          recovery,
          transitionDependencies: [sharedDependency],
        },
      },
      context,
    );
    await runRecipeStep(
      device,
      {
        kind: "module",
        recipeId: "unrelated",
        check: {
          id: "profile",
          title: "Profile",
          transitionDependencies: [unrelatedDependency],
        },
      },
      context,
    );
    finalizeDeferredCampaignChecks(context);

    assert.equal(settingsAttempts, 1, "only the initially authorized warm attempt may mutate");
    assert.equal(
      runtime.campaignTransitionProofs?.["open-settings-top"]?.status,
      "needs-confirmation",
    );
    assert.equal(runtime.campaignTransitionProofs?.["open-profile"], undefined);
    assert.equal(
      job.artifacts.filter(
        (artifact) =>
          artifact.kind === "campaign-transition-circuit" &&
          (artifact.data as { status?: string }).status === "open",
      ).length,
      0,
    );
    assert.equal(
      job.artifacts.some(
        (artifact) =>
          artifact.kind === "campaign-check-result" &&
          (artifact.data as { id?: string; status?: string }).id === "privacy" &&
          (artifact.data as { status?: string }).status === "blocked",
      ),
      true,
    );
    assert.equal(
      logs.some((line) => line.includes("Unrelated authored check")),
      false,
    );
  });

  it("persists one cursor-firewall Problem and never executes unsafe recovery", async () => {
    const job = { id: "d7ef41b4-regression", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const logs: string[] = [];
    let coldExecutions = 0;
    let unrelatedExecutions = 0;
    const dependency = {
      connectionId: "open-settings-top",
      originScreenId: "start",
      destination: { kind: "screen" as const, screenId: "settings-top" },
    };
    const unsafeRecovery = {
      groupId: "transition:open-settings-top",
      recipeId: "legacy-cold-open-settings",
      transitionId: "open-settings-top",
      coldRecipeId: "legacy-cold-open-settings",
    };
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              text: "Settings",
              visibleToUser: true,
              rect: { x: 0, y: 0, width: 1080, height: 2200 },
            },
          ],
        }),
    });
    const context = {
      log: (line: string) => logs.push(line),
      job,
      runtime,
      recipeGraph: {},
    };
    const failedCheck = {
      kind: "sleep" as const,
      ms: 1,
      check: {
        id: "visit-data-controls",
        title: "Visit Data Controls",
        recovery: unsafeRecovery,
        transitionDependencies: [dependency],
      },
    };

    await runWithTargetContext(
      { kind: "device", platform: "android", serial: "recipe-runner-test" },
      async () => {
        await runCampaignCheck(device, failedCheck, context, async () => {
          throw new Error("Settings origin was not found");
        });
        await runCampaignCheck(
          device,
          {
            ...failedCheck,
            check: {
              ...failedCheck.check,
              id: "visit-cloud-storage",
              title: "Visit Cloud Storage",
            },
          },
          context,
          async (recipeId) => {
            if (recipeId === "legacy-cold-open-settings") coldExecutions += 1;
          },
        );
        await runCampaignCheck(
          device,
          {
            ...failedCheck,
            check: { ...failedCheck.check, id: "visit-privacy", title: "Visit Privacy" },
          },
          context,
          async (recipeId) => {
            if (recipeId === "legacy-cold-open-settings") coldExecutions += 1;
          },
        );
        await runCampaignCheck(
          device,
          { kind: "sleep", ms: 1, check: { id: "visit-profile", title: "Visit Profile" } },
          context,
          async () => {
            unrelatedExecutions += 1;
          },
        );
      },
    );

    assert.equal(coldExecutions, 0);
    assert.equal(unrelatedExecutions, 0);
    assert.equal(
      job.artifacts.filter((artifact) => artifact.kind === "campaign-cursor-firewall").length,
      1,
    );
    const intervention = job.artifacts.find(
      (artifact) => artifact.kind === "campaign-cursor-firewall",
    )?.data as {
      expected?: { leafTransition?: { connectionId?: string } };
      nodes?: unknown[];
      screenshot?: { caption?: string };
      stoppedMutations?: boolean;
      repair?: { implicitMutationAllowed?: boolean; choices?: string[] };
    };
    assert.equal(intervention.expected?.leafTransition?.connectionId, "open-settings-top");
    assert.equal(intervention.nodes?.length, 1);
    assert.match(intervention.screenshot?.caption ?? "", /visit-cloud-storage/u);
    assert.equal(intervention.stoppedMutations, true);
    assert.equal(intervention.repair?.implicitMutationAllowed, false);
    assert.deepEqual(intervention.repair?.choices, [
      "prove-current-origin",
      "teach-canonical-leaf",
      "defer",
    ]);
    assert.deepEqual(
      job.artifacts
        .filter((artifact) => artifact.kind === "campaign-check-result")
        .map((artifact) => (artifact.data as { status?: string }).status),
      ["blocked", "blocked", "blocked"],
    );
    assert.equal(logs.filter((line) => line.includes("blocked before mutation")).length, 3);
  });

  it("firewalls hidden cold effects in graph modules during coverage", async () => {
    const job = { id: "coverage-firewall", artifacts: [] } as unknown as TestJob;
    const runtime: NonNullable<RecipeStepContext["runtime"]> = {};
    const context = {
      ...noLog,
      job,
      runtime,
      recipeGraph: {
        "arbitrary-setup": {
          id: "arbitrary-setup",
          title: "Arbitrary graph setup",
          source: "custom" as const,
          steps: [{ kind: "app" as const, action: "close" as const, app: "ai.x.grok" }],
          createdAt: 1,
          updatedAt: 1,
        },
      },
    };

    await runRecipeStep(
      stubDevice({}),
      {
        kind: "module",
        recipeId: "arbitrary-setup",
        check: { id: "unsafe-setup", title: "Unsafe setup" },
      },
      context,
    );
    finalizeDeferredCampaignChecks(context);

    const blocked = job.artifacts.find((artifact) => artifact.kind === "campaign-effect-blocked")
      ?.data as { reason?: string; coverageStarted?: boolean };
    assert.match(blocked.reason ?? "", /setup\/reset effect/u);
    assert.equal(blocked.coverageStarted, true);
    assert.equal(runtime.campaignCoverageStarted, true);
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
    assert.equal(movements[0]?.amount, 0.45);
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

  it("finds a unique live label when indexed navigation cannot overlap the compiled surface", async () => {
    const logs: string[] = [];
    let scrolls = 0;
    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes: [
              {
                type: "Application",
                rect: { x: 0, y: 0, width: 400, height: 800 },
                enabled: true,
              },
              {
                role: "cell",
                label: "SuperGrok, X Premium",
                hittable: true,
                rect: { x: 20, y: 420, width: 300, height: 56 },
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
        target: { identifier: "stale-supergrok", label: "SuperGrok" },
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
      { log: (line) => logs.push(line), runtime: {} },
    );
    assert.equal(scrolls, 0);
    assert.equal(
      logs.some((line) => line.includes("found semantic target")),
      true,
    );
  });

  it("fails with a repair packet instead of blind scrolling when indexed navigation cannot overlap", async () => {
    let scrolls = 0;
    const job = { artifacts: [] } as unknown as TestJob;
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
        { log: () => {}, runtime: {}, job },
      ),
      /does not overlap.*repair packet captured/,
    );
    assert.equal(scrolls, 0);
    assert.equal(job.artifacts[0]?.kind, "semantic-reveal-repair");
  });

  it("stops the exact Memory-style alternating index loop after one proven correction", async () => {
    const movements: Array<{ direction?: string; amount?: number }> = [];
    const job = { artifacts: [] } as unknown as TestJob;
    let viewport = 0;
    const anchorNodes = (viewportTop: number, marker: string) => [
      {
        role: "cell",
        identifier: "appearance",
        label: "Appearance",
        hittable: true,
        rect: { x: 0, y: 300 - viewportTop, width: 300, height: 60 },
      },
      {
        role: "cell",
        identifier: "advanced",
        label: "Advanced",
        hittable: true,
        rect: { x: 0, y: 700 - viewportTop, width: 300, height: 60 },
      },
      { role: "text", label: marker },
    ];
    const viewports = [
      anchorNodes(0, "top"),
      anchorNodes(1_100, "below-memory"),
      anchorNodes(100, "above-memory"),
    ];

    await assert.rejects(
      runRecipeStep(
        stubDevice({
          snapshot: () => Promise.resolve({ nodes: viewports[Math.min(viewport, 2)] }),
          scroll: (options) => {
            movements.push(options as { direction?: string; amount?: number });
            viewport += 1;
            return Promise.resolve({});
          },
        }),
        {
          kind: "reveal",
          target: { identifier: "memory", label: "Memory" },
          direction: "auto",
          maxAttempts: 12,
          navigation: [
            {
              schemaVersion: 1,
              surfaceId: "scroll-surface-settings",
              captureId: "settings-r1",
              documentHeight: 2_400,
              viewportHeight: 800,
              targetOrder: 2,
              targetDocumentY: 1_000,
              anchors: [
                { order: 0, documentY: 330, target: { identifier: "appearance" } },
                { order: 1, documentY: 730, target: { identifier: "advanced" } },
              ],
            },
          ],
        },
        { log: () => {}, runtime: {}, job },
      ),
      /second direction reversal.*repair packet captured/,
    );

    assert.deepEqual(
      movements.map(({ direction, amount }) => ({ direction, amount })),
      [
        { direction: "down", amount: 0.45 },
        { direction: "up", amount: 0.18 },
      ],
    );
    const packet = job.artifacts.find((artifact) => artifact.kind === "semantic-reveal-repair");
    assert.ok(packet);
    assert.deepEqual((packet.data as { target: unknown }).target, {
      identifier: "memory",
      label: "Memory",
    });
    assert.equal(
      (packet.data as { lastObservation: { nodeCount: number } }).lastObservation.nodeCount,
      3,
    );
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

  it("skips a present-condition leftover tap when the accessibility tree is unreadable", async () => {
    const logs: string[] = [];
    const job = { artifacts: [] } as unknown as TestJob;
    let pressed = false;
    const device = stubDevice({
      find: () => Promise.reject(new Error("find could not read the current accessibility tree")),
      press: () => {
        pressed = true;
        return Promise.resolve();
      },
    });

    await runRecipeStep(
      device,
      {
        kind: "tap",
        target: { label: "grok-arrows-right" },
        when: { target: { label: "grok-arrows-right" }, condition: "present" },
      },
      { log: (line) => logs.push(line), job },
    );

    assert.equal(pressed, false);
    assert.match(logs[0] ?? "", /leftover opener unproven/);
    assert.equal(job.artifacts[0]?.kind, "conditional-step-skipped");
    assert.equal((job.artifacts[0]?.data as { observed?: string }).observed, "unreadable");
  });

  it("does not treat an unreadable tree as absent for a dest opener", async () => {
    let pressed = false;
    const device = stubDevice({
      find: () => Promise.reject(new Error("find could not read the current accessibility tree")),
      press: () => {
        pressed = true;
        return Promise.resolve();
      },
    });

    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          {
            kind: "tap",
            coverage: "inspect",
            target: { identifier: "ask.toolbar.add.button" },
            when: { target: { identifier: "ask.toolbar.add.menu.camera" }, condition: "absent" },
          },
          noLog,
        ),
      /could not read the current accessibility tree/,
    );
    assert.equal(pressed, false);
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
      find: () => Promise.reject(new Error('No match for query "Sign in"')),
      snapshot: () => Promise.resolve({ nodes: [] }),
    });
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          { kind: "expect", target: { label: "Sign in" }, condition: "visible", timeoutMs: 0 },
          noLog,
        ),
      /expect: "label "Sign in"" not visible after 0s/,
    );
  });

  it("visible propagates infrastructure errors with their original message", async () => {
    const device = stubDevice({
      find: () => Promise.reject(new Error("no active session — run doctor")),
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

  it("visible accepts semantic snapshot content that is intentionally non-hittable", async () => {
    const device = stubDevice({
      find: () => Promise.reject(new Error('No match for query id="heading"')),
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              index: 1,
              role: "h1",
              identifier: "heading",
              label: "Arabic — RTL fixed",
              hittable: false,
              rect: { x: 32, y: 32, width: 240, height: 48 },
            },
          ],
        }),
    });

    await runRecipeStep(
      device,
      { kind: "expect", target: { identifier: "heading" }, condition: "visible" },
      noLog,
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

  it("can ignore extra options when extras is allow", async () => {
    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: grokMenu }) }),
      {
        kind: "expect-set",
        identifierPrefix: "ask.toolbar.add.menu.",
        labels: ["Camera", "Files"],
        extras: "allow",
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

  it("still fails extras-allow when a required option is missing", async () => {
    await assert.rejects(
      () =>
        runRecipeStep(
          stubDevice({ snapshot: () => Promise.resolve({ nodes: grokMenu }) }),
          {
            kind: "expect-set",
            identifierPrefix: "ask.toolbar.add.menu.",
            labels: ["Camera", "Gallery"],
            extras: "allow",
            timeoutMs: 0,
          },
          noLog,
        ),
      /missing: Gallery; unexpected: none/,
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

  it("matches browser menu options when parentIndex is omitted", async () => {
    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes: [
              {
                index: 26,
                role: "menu",
                label: "Upload a file\nAdd to project\nRecent files",
                rect: { x: 400, y: 500, width: 280, height: 160 },
              },
              {
                index: 27,
                role: "menuitem",
                label: "Upload a file",
                rect: { x: 410, y: 510, width: 260, height: 40 },
              },
              {
                index: 28,
                role: "menuitem",
                label: "Add to project",
                rect: { x: 410, y: 550, width: 260, height: 40 },
              },
              {
                index: 29,
                role: "menuitem",
                label: "Recent files",
                rect: { x: 410, y: 590, width: 260, height: 40 },
              },
              {
                index: 8,
                role: "button",
                label: "Sign in",
                rect: { x: 1100, y: 12, width: 80, height: 32 },
              },
            ],
          }),
      }),
      {
        kind: "expect-set",
        scope: { role: "menu", text: "Upload a file" },
        labels: ["Add to project", "Recent files", "Upload a file"],
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

  it("reports the exact missing inverse without attempting Back", async () => {
    let backs = 0;
    await assert.rejects(
      () =>
        runWithTargetContext(
          { kind: "device", platform: "android", serial: "missing-return" },
          () =>
            runExpectScreenStep(
              stubDevice({
                snapshot: () => Promise.resolve({ nodes: [{ role: "heading", label: "Widget" }] }),
                back: () => {
                  backs += 1;
                  return Promise.resolve({});
                },
              }),
              {
                kind: "expect-screen",
                screenId: "settings",
                screenTitle: "Settings",
                fingerprint,
                timeoutMs: 0,
                returnRequirement: {
                  connectionId: "open-widget",
                  fromScreenId: "settings",
                  destinationScreenId: "widget",
                },
              },
              { log: () => {}, runtime: {}, observeVisualFingerprint: async () => "f".repeat(64) },
            ),
        ),
      /return-edge open-widget: reviewed inverse is required for widget → settings.*no Back was attempted/u,
    );
    assert.equal(backs, 0);
  });

  it("never lets a delayed pre-tap iOS tree satisfy a later expect-screen", async () => {
    const serial = "ios-delayed-expect-fence";
    let snapshotCalls = 0;
    let releasePreTapTree!: (value: { nodes: typeof nodes }) => void;
    const preTapTree = new Promise<{ nodes: typeof nodes }>((resolve) => {
      releasePreTapTree = resolve;
    });
    const device = stubDevice({
      snapshot: () => {
        snapshotCalls += 1;
        return snapshotCalls === 1 ? preTapTree : Promise.resolve({ nodes: [] });
      },
      press: () => Promise.resolve({}),
    });

    // Start an AX traversal while the previous screen is still visible.
    const delayedRead = runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      snapshot(device),
    );
    await new Promise<void>((resolve) => setImmediate(resolve));

    // The tap is acknowledged before the old traversal completes.
    await runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
      pressPoint(device, 48, 72),
    );

    // An expect-screen for the old fingerprint must not pass by sharing that
    // delayed tree. It receives an honest unavailable semantic attempt until
    // XCTest settles, rather than opening an overlapping tree request.
    await assert.rejects(
      runWithTargetContext({ kind: "device", platform: "ios", serial }, () =>
        runExpectScreenStep(
          device,
          {
            kind: "expect-screen",
            screenId: "old-screen",
            screenTitle: "Old screen",
            fingerprint,
            timeoutMs: 0,
          },
          {
            log: () => {},
            job: { id: "retry-ax", platform: "android" } as TestJob,
            runtime: {},
            observeVisualFingerprint: async () => "newer-pixels",
          },
        ),
      ),
      /screen-inspection-unavailable:|expect-screen/u,
    );
    assert.equal(snapshotCalls, 1, "post-tap expect must not overlap the old XCTest read");

    releasePreTapTree({ nodes });
    await assert.rejects(delayedRead, IosSnapshotStaleAfterInputError);
  });

  it("re-observes once after a transient Android AX timeout without retrying the transport three times", async () => {
    let snapshotCalls = 0;
    const device = stubDevice({
      snapshot: () => Promise.reject(new Error("unused device snapshot")),
    });

    await runWithTargetContext(
      { kind: "device", platform: "android", serial: "android-ax-retry" },
      () =>
        runExpectScreenStep(
          device,
          {
            kind: "expect-screen",
            screenId: "settings",
            screenTitle: "Settings",
            fingerprint,
            timeoutMs: 0,
          },
          {
            log: () => {},
            runtime: {},
          },
          {
            captureScreenshot: async () => screenshot("retry"),
            observeSnapshot: async () => {
              snapshotCalls += 1;
              if (snapshotCalls === 1) throw new Error("snapshot timed out");
              return nodes;
            },
          },
        ),
    );

    assert.equal(snapshotCalls, 2);
  });

  it("does not re-observe a permanent Android AX failure", async () => {
    let snapshotCalls = 0;
    const device = stubDevice({ snapshot: () => Promise.reject(new Error("permission denied")) });

    await assert.rejects(
      runWithTargetContext(
        { kind: "device", platform: "android", serial: "android-ax-permanent" },
        () =>
          runExpectScreenStep(
            device,
            {
              kind: "expect-screen",
              screenId: "settings",
              screenTitle: "Settings",
              fingerprint,
              timeoutMs: 0,
            },
            {
              log: () => {},
              job: { id: "permanent-ax", platform: "android" } as TestJob,
              runtime: {},
            },
            {
              captureScreenshot: async () => screenshot("permanent"),
              observeSnapshot: async () => {
                snapshotCalls += 1;
                throw new Error("permission denied");
              },
            },
          ),
      ),
      /screen-inspection-unavailable:.*screen identity unproven/u,
    );
    assert.equal(snapshotCalls, 1);
  });

  it("never accepts a visual match when the semantic tree is empty", async () => {
    const device = stubDevice({ snapshot: () => Promise.resolve({ nodes: [] }) });

    await assert.rejects(
      runWithTargetContext(
        { kind: "device", platform: "android", serial: "android-empty-ax" },
        () =>
          runExpectScreenStep(
            device,
            {
              kind: "expect-screen",
              screenId: "settings",
              screenTitle: "Settings",
              fingerprint,
              timeoutMs: 0,
            },
            {
              log: () => {},
              job: { id: "empty-ax", platform: "android" } as TestJob,
              runtime: {},
              observeVisualFingerprint: async () => fingerprint,
            },
            {
              observeSnapshot: async () => [],
            },
          ),
      ),
      /screen-inspection-unavailable:/u,
    );
  });

  it("persists immutable lineage after a fresh selective-repair checkpoint matches", async () => {
    const job = { id: "repair-job", artifacts: [] } as unknown as TestJob;
    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes }) }),
      {
        kind: "expect-screen",
        screenId: "settings",
        screenTitle: "Settings",
        fingerprint,
        timeoutMs: 0,
        repairCheckpoint: {
          sourceRunId: "0bc5b19f",
          sourceCheckId: "visit-14",
          sourceInputDigest: "immutable-source",
          transitionId: "open-advanced",
        },
      },
      { ...noLog, job, runtime: {} },
    );

    const proof = job.artifacts.find(
      (artifact) => artifact.kind === "campaign-repair-checkpoint-proof",
    )?.data as {
      source?: { sourceRunId?: string; sourceCheckId?: string };
      expected?: { screenId?: string };
      observed?: { accessibility?: { nodeCount?: number }; nodes?: unknown[] };
    };
    assert.equal(proof.source?.sourceRunId, "0bc5b19f");
    assert.equal(proof.source?.sourceCheckId, "visit-14");
    assert.equal(proof.expected?.screenId, "settings");
    assert.equal(proof.observed?.accessibility?.nodeCount, 1);
    assert.equal(proof.observed?.nodes?.length, 1);
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
    assert.equal(
      Boolean(currentVerifiedScreen(runtime)),
      false,
      "the pair waits for both observations",
    );
    resolveNodes({ nodes });
    await pending;

    assert.equal(currentVerifiedScreen(runtime)?.screenshot, captured);
    assert.equal(currentVerifiedScreen(runtime)?.nodes, nodes);
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
    assert.equal(currentVerifiedScreen(runtime)?.screenshot, rasters[1]);
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
    assert.equal(currentVerifiedScreen(runtime), undefined);
    assert.equal(runtime.navigationCursor?.status, "unknown");
    assert.equal(discarded.framePath, undefined);
    assert.equal(discarded.jobId, undefined);
  });

  it("keeps polling expect-screen until the authored timeout when pixels stay still", async () => {
    let screenshots = 0;
    const visualFingerprint = "c".repeat(64);
    const started = Date.now();
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "device", platform: "android", serial: "still-screen" }, () =>
          runExpectScreenStep(
            stubDevice({
              snapshot: () =>
                Promise.resolve({ nodes: [{ role: "text", label: "Niagara calendar" }] }),
              wait: () => Promise.resolve({}),
            }),
            {
              kind: "expect-screen",
              screenId: "search",
              screenTitle: "Search",
              fingerprint: "d".repeat(64),
              timeoutMs: 1_200,
            },
            {
              log: () => {},
              job: { id: "still-screen", platform: "android" } as TestJob,
              runtime: {},
            },
            {
              captureScreenshot: async () => {
                screenshots += 1;
                return screenshot("still", visualFingerprint);
              },
            },
          ),
        ),
      /expect-screen: on “.*”, not “Search” after 1200ms/u,
    );
    assert.ok(Date.now() - started >= 1_000);
    assert.ok(screenshots >= 2);
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
          stubDevice({
            snapshot: () => Promise.resolve({ nodes: [{ role: "text", label: "other" }] }),
          }),
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
      currentVerifiedScreen(runtime)?.screenshot?.screenMatch?.visualFingerprint,
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
      stubDevice({
        snapshot: () => Promise.resolve({ nodes: [{ role: "text", label: "other" }] }),
      }),
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

  it("proves grok signed-in home when leftover chats were taught without the pack", async () => {
    const frame = {
      role: "div",
      rect: { x: 0, y: 0, width: 1280, height: 800 },
      visibleToUser: true,
    };
    const seeAll = {
      role: "button",
      label: "See all",
      rect: { x: 12, y: 360, width: 80, height: 32 },
      hittable: true,
      visibleToUser: true,
    };
    const chrome = [
      { role: "h1", label: "What should we explore?", visibleToUser: true },
      {
        role: "button",
        label: "Attach",
        identifier: "attach-button",
        hittable: true,
        visibleToUser: true,
      },
      { role: "a", label: "Imagine", hittable: true, visibleToUser: true },
      seeAll,
      frame,
    ];
    const leftoverChat = {
      role: "a",
      label: "capital of cabo verde is praia",
      rect: { x: 12, y: 400, width: 240, height: 36 },
      hittable: true,
      visibleToUser: true,
    };
    const taught = observeScreenIdentity([...chrome, leftoverChat]);
    const live = [
      ...chrome,
      leftoverChat,
      {
        role: "a",
        label: "Paris capital of France",
        rect: { x: 12, y: 440, width: 240, height: 36 },
        hittable: true,
        visibleToUser: true,
      },
    ];
    const lines: string[] = [];
    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: live }) }),
      {
        kind: "expect-screen",
        screenId: "signed-in-home",
        screenTitle: "Signed-in home",
        fingerprint: taught.fingerprint,
        observations: [taught],
        timeoutMs: 250,
      },
      {
        log: (line) => lines.push(line),
        job: {
          browserTargetId: "grok-com",
          artifacts: [],
          resolvedInputs: {},
          action: "app-map:grok-web:test:home:root:r1",
        } as TestJob,
        runtime: {
          identityIgnoreRegions: [
            { name: "sidebar conversation titles", x: 0, y: 0.4, width: 0.24, height: 0.48 },
          ],
        },
      },
    );
    assert.deepEqual(lines, ["screen: reached Signed-in home"]);
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
      ...Array.from({ length: 7 }, (_, index) => ({
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

  it("accepts a Compose user-data list from its reviewed semantic shell", async () => {
    const approved = observeScreenIdentity([
      { role: "text", label: "Shared Conversations", depth: 11 },
      {
        role: "text",
        label: "Shared links can be viewed by anyone with the link.",
        depth: 10,
      },
      ...Array.from({ length: 12 }, (_, index) => ({
        role: "text",
        label: `Old shared conversation ${index}`,
        depth: 11,
      })),
    ]);
    const current = [
      { role: "text", label: "Shared Conversations", depth: 11 },
      {
        role: "text",
        label: "Shared links can be viewed by anyone with the link.",
        depth: 10,
      },
      ...Array.from({ length: 7 }, (_, index) => ({
        role: "text",
        label: `Entirely different shared conversation ${index}`,
        depth: 11,
      })),
    ];
    const lines: string[] = [];

    await runRecipeStep(
      stubDevice({ snapshot: () => Promise.resolve({ nodes: current }) }),
      {
        kind: "expect-screen",
        screenId: "shared",
        screenTitle: "Shared Conversations",
        fingerprint: "a".repeat(64),
        observations: [approved],
      },
      { log: (line) => lines.push(line) },
    );

    assert.deepEqual(lines, ["screen: reached Shared Conversations"]);
  });

  it("does not accept a dynamic Compose list from its title alone", async () => {
    const approved = observeScreenIdentity([
      { role: "text", label: "Shared Conversations", depth: 11 },
      {
        role: "text",
        label: "Shared links can be viewed by anyone with the link.",
        depth: 10,
      },
    ]);

    await assert.rejects(
      runRecipeStep(
        stubDevice({
          snapshot: () =>
            Promise.resolve({
              nodes: [
                { role: "text", label: "Shared Conversations", depth: 11 },
                { role: "text", label: "A different child-page explanation.", depth: 10 },
              ],
            }),
        }),
        {
          kind: "expect-screen",
          screenId: "shared",
          screenTitle: "Shared Conversations",
          fingerprint: "a".repeat(64),
          observations: [approved],
          timeoutMs: 1,
        },
        { ...noLog, observeVisualFingerprint: () => Promise.resolve("c".repeat(64)) },
      ),
      /not “Shared Conversations”/,
    );
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
    assert.equal(currentVerifiedScreen(tapContext.runtime), undefined);
    assert.equal(tapContext.runtime?.navigationCursor?.status, "unknown");
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
        navigationCursor: provenNavigation({
          screenId: "settings",
          screenTitle: "Settings",
          nodes: staleNodes,
          observedAt: 100,
          verifiedAt: 100,
        }),
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
        navigationCursor: provenNavigation({
          screenId: "usage",
          screenTitle: "Usage",
          nodes: visibleNodes,
          observedAt: 100,
          verifiedAt: 100,
        }),
      },
    };

    await assert.rejects(
      runRecipeStep(device, { kind: "tap", target: { label: "Set Up Auto Top-Up" } }, ctx),
      /named target absent from current Android accessibility tree/u,
    );
    assert.equal(snapshots, 5);
    assert.equal(presses, 0);
  });

  it("does not hide Android semantic drift behind a recorded absolute point", async () => {
    let presses = 0;
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes: [
            {
              role: "button",
              label: "Privacy Policy",
              enabled: true,
              hittable: true,
              rect: { x: 40, y: 900, width: 900, height: 120 },
            },
          ],
        }),
      press: () => {
        presses += 1;
        return Promise.resolve({});
      },
      wait: async () => {},
    });

    await assert.rejects(
      runRecipeStep(
        device,
        {
          kind: "tap",
          target: { label: "Help & Support", point: { x: 500, y: 1700 } },
        },
        noLog,
      ),
      /named target absent from current Android accessibility tree/u,
    );
    assert.equal(presses, 0);
  });

  it("waits for a late Android accessibility row before tapping it semantically", async () => {
    let snapshots = 0;
    const presses: unknown[] = [];
    const lateTarget = {
      role: "button",
      identifier: "settings_button",
      enabled: true,
      hittable: true,
      rect: { x: 860, y: 120, width: 120, height: 120 },
    };
    const device = stubDevice({
      snapshot: () => {
        snapshots += 1;
        return Promise.resolve({ nodes: snapshots >= 2 ? [lateTarget] : [] });
      },
      press: (options) => {
        presses.push(options);
        return Promise.resolve({});
      },
      wait: async () => {},
    });

    await runRecipeStep(device, { kind: "tap", target: { identifier: "settings_button" } }, noLog);

    assert.equal(snapshots, 3);
    assert.equal(presses.length, 1);
    assert.equal((presses[0] as { selector?: string }).selector, 'id="settings_button"');
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

  it("applies a bounded default to an unattended checkpoint and releases its waiter", async () => {
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
            { kind: "pause", message: "Approve the sign-in", reason: "consent" },
            { log: () => {}, job: owner, defaultHumanCheckpointTimeoutMs: 25 },
          ),
        /human checkpoint timed out/,
      );
      assert.equal(owner.waitingFor, undefined);
      assert.deepEqual(
        owner.artifacts.map((artifact) => artifact.kind),
        ["human-intervention-requested", "human-intervention-expired"],
      );
      assert.equal((owner.artifacts[0]?.data as { timeoutMs?: number } | undefined)?.timeoutMs, 25);
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
          if ((options as { ref?: string }).ref)
            throw new Error("Selector did not match an element");
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
          if ((options as { ref?: string }).ref)
            throw new Error("Selector did not match an element");
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

  it("proposes a reviewable graph repair when selector drift uses a reviewed fallback", async () => {
    const owner = job();
    await runRecipeStep(
      stubDevice({
        snapshot: () =>
          Promise.resolve({
            nodes: [
              {
                role: "button",
                label: "Settings",
                enabled: true,
                hittable: true,
                rect: { x: 770, y: 2040, width: 80, height: 80 },
              },
            ],
          }),
        press: () => Promise.resolve({}),
      }),
      {
        kind: "tap",
        target: { identifier: "settings_button" },
        fallbackTargets: [{ label: "Settings", role: "button" }],
        navigationContract: {
          connectionId: "open-settings",
          expectedScreenId: "settings",
          expectedFingerprint: "a".repeat(64),
          evidenceIds: ["settings-destination-tree"],
        },
      },
      { log: () => {}, job: owner },
    );

    const proposal = owner.artifacts.find(
      (artifact) => artifact.kind === "navigation-repair-proposal",
    );
    assert.ok(proposal);
    assert.deepEqual(proposal.data, {
      status: "pending-review",
      connectionId: "open-settings",
      beforeSelector: { identifier: "settings_button" },
      currentSelector: { label: "Settings", role: "button" },
      currentResolution: {
        strategy: "label",
        bounds: { x: 770, y: 2040, width: 80, height: 80 },
        point: { x: 810, y: 2080 },
      },
      attempts: [
        {
          target: { identifier: "settings_button" },
          error:
            "named target absent from current Android accessibility tree: selector is not present in the current accessibility tree (identifier settings_button)",
        },
      ],
      expectedDestination: {
        screenId: "settings",
        fingerprint: "a".repeat(64),
        evidenceIds: ["settings-destination-tree"],
      },
      persisted: false,
    });
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

  it("does not let a stale idle control pass while a busy control remains visible", async () => {
    const owner = job();
    let sample = 0;
    const device = stubDevice({
      wait: () => new Promise((resolve) => setTimeout(resolve, 25)),
      snapshot: () => {
        sample += 1;
        return Promise.resolve({
          nodes:
            sample === 1
              ? [{ identifier: "send", label: "Send" }]
              : [
                  { ref: "@answer", label: "Assistant response", value: "still generating" },
                  { identifier: "stop", label: "Stop generating" },
                  { identifier: "send", label: "Send" },
                ],
        });
      },
    });

    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          {
            kind: "wait-response",
            target: { ref: "@answer" },
            busyTarget: { identifier: "stop" },
            idleTarget: { identifier: "send" },
            timeoutMs: 300,
            stableForMs: 100,
          },
          { log: () => {}, job: owner },
        ),
      /response completion: timed out/u,
    );
    const evidence = owner.artifacts.find((item) => item.kind === "response-completion");
    assert.equal((evidence?.data as { status?: string } | undefined)?.status, "timeout");
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

  it("keeps Add Widget evidence stable for 500ms before dismissing the preview", async () => {
    let surface: "settings" | "preview" = "settings";
    let elapsedMs = 0;
    let dismissedAt: number | undefined;
    const settings = [
      {
        type: "Button",
        label: "Add Widget",
        hittable: true,
        rect: { x: 40, y: 420, width: 640, height: 64 },
      },
    ];
    const preview = [
      {
        type: "Application",
        label: "Widget preview",
        rect: { x: 0, y: 0, width: 834, height: 1112 },
      },
      {
        type: "Button",
        label: "Back",
        hittable: true,
        rect: { x: 20, y: 70, width: 60, height: 36 },
      },
    ];
    const device = stubDevice({
      snapshot: () => Promise.resolve({ nodes: surface === "settings" ? settings : preview }),
      press: (options) => {
        const selector =
          typeof options === "object" && options && "selector" in options
            ? String((options as { selector?: string }).selector ?? "")
            : "";
        if (selector.includes("Add Widget")) {
          surface = "preview";
        } else if (
          surface === "preview" &&
          typeof options === "object" &&
          options &&
          "x" in options
        ) {
          dismissedAt = elapsedMs;
          surface = "settings";
        }
        return Promise.resolve({});
      },
      wait: () => {
        // sleep() chunks at 100ms; its requested duration is reflected by the
        // injected clock below without imposing wall-clock time on the test.
        elapsedMs += 100;
        return Promise.resolve({});
      },
    });
    const job = { id: "add-widget", artifacts: [] } as unknown as TestJob;
    const raster: ScreenshotPayload = {
      capturedAt: 1,
      mime: "image/png",
      base64: Buffer.from("preview").toString("base64"),
      path: "/tmp/add-widget.png",
      bytes: 7,
      screenMatch: {
        fingerprint: "a".repeat(64),
        visualFingerprint: "a".repeat(64),
        matchedScreenId: null,
        status: "observed",
      },
    };

    await runWithTargetContext(
      { kind: "device", platform: "android", serial: "add-widget-preview" },
      () =>
        runTourStep(
          device,
          {
            kind: "tour",
            screenshot: false,
            fallbackStops: [{ label: "Add Widget", evidenceSurface: "preview" }],
          },
          () => {},
          job,
          {
            captureScreenshot: async () => ({ ...raster }),
            clock: () => elapsedMs,
          },
        ),
    );

    assert.ok(
      (dismissedAt ?? 0) >= 500,
      `Back must not dismiss the preview before evidence dwell (dismissedAt=${String(dismissedAt)}, elapsed=${elapsedMs})`,
    );
    const timing = job.artifacts.find((artifact) => artifact.kind === "destination-evidence-timing")
      ?.data as { navigationMs: number; evidenceDwellMs: number; surface: string };
    assert.equal(timing.surface, "preview");
    assert.equal(timing.navigationMs, 0);
    assert.ok(timing.evidenceDwellMs >= 500);
  });

  it("walks mapped fallback stops when the live tree is empty", async () => {
    const presses: unknown[] = [];
    const device = stubDevice({
      scroll: () => Promise.resolve({}),
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

  it("does not send the second raw tour-back point after the first iOS point is unknown", async () => {
    let screen: "settings" | "child" = "settings";
    const backPoints: Array<{ x?: number; y?: number }> = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({ nodes: screen === "settings" ? settingsNodes : appearanceNodes }),
      press: (input) => {
        const selector =
          typeof input === "object" && input && "selector" in input
            ? String((input as { selector?: string }).selector ?? "")
            : "";
        const point = input as { x?: number; y?: number };
        if (selector.includes("Appearance")) {
          screen = "child";
          return Promise.resolve({});
        }
        if (point.x === 78 || point.x === 44) {
          backPoints.push({ x: point.x, y: point.y });
          return Promise.reject(new Error("XCTest transport ended"));
        }
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });

    await assert.rejects(
      runIosRecipeStep(device, { kind: "tour", screenshot: false }, noLog),
      IosMutationOutcomeUnknownError,
    );

    assert.deepEqual(backPoints, [{ x: 78, y: 88 }]);
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
      scroll: () => Promise.resolve({}),
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
      scroll: () => Promise.resolve({}),
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

  const superGrokNodes = [
    {
      type: "Application",
      identifier: "ai.x.grok",
      label: "Grok",
      rect: { x: 0, y: 0, width: 834, height: 1112 },
    },
    {
      type: "TextView",
      identifier: "supergrok_title",
      label: "SuperGrok",
      hittable: true,
      rect: { x: 40, y: 80, width: 240, height: 40 },
    },
    {
      type: "Button",
      label: "Manage billing",
      hittable: true,
      rect: { x: 40, y: 200, width: 300, height: 56 },
    },
  ];
  const homeWithSettings = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "Button",
      identifier: "settings_button",
      label: "Settings",
      hittable: true,
      rect: { x: 40, y: 560, width: 72, height: 80 },
    },
  ];
  const settingsWithSuperGrok = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "Button",
      label: "SuperGrok",
      hittable: true,
      rect: { x: 20, y: 400, width: 300, height: 56 },
    },
  ];
  const composerOpen = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "Button",
      label: "Close",
      hittable: true,
      rect: { x: 20, y: 80, width: 80, height: 40 },
    },
    { type: "Keyboard", role: "keyboard", rect: { x: 0, y: 700, width: 834, height: 400 } },
  ];
  const superGrokFingerprint = observeScreenIdentity(superGrokNodes).fingerprint;
  const mappedSuperGrokPrelude = [
    { kind: "tap" as const, target: { identifier: "settings_button" } },
    { kind: "tap" as const, target: { label: "SuperGrok" } },
  ];

  function describePress(options: unknown): string {
    if (!options || typeof options !== "object") return "";
    if ("selector" in options && typeof options.selector === "string") return options.selector;
    if (
      "x" in options &&
      "y" in options &&
      typeof options.x === "number" &&
      typeof options.y === "number"
    ) {
      return `point:${options.x},${options.y}`;
    }
    return "";
  }

  function homeToSuperGrokDevice(start: "home" | "supergrok" | "composer") {
    let screen: "home" | "settings" | "supergrok" | "composer" = start;
    const presses: string[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes:
            screen === "home"
              ? homeWithSettings
              : screen === "settings"
                ? settingsWithSuperGrok
                : screen === "composer"
                  ? composerOpen
                  : superGrokNodes,
        }),
      press: (options) => {
        const selector = describePress(options);
        presses.push(selector);
        if (selector.includes("settings_button")) screen = "settings";
        else if (/label="SuperGrok"|SuperGrok/.test(selector) && !selector.includes("title")) {
          screen = "supergrok";
        }
        return Promise.resolve({});
      },
      back: () => {
        presses.push("hardware-back");
        return Promise.resolve({});
      },
      scroll: () => Promise.resolve({}),
      wait: () => Promise.resolve({}),
    });
    return { device, presses };
  }

  it("seeks SuperGrok from home by tapping mapped settings then SuperGrok", async () => {
    const { device, presses } = homeToSuperGrokDevice("home");
    await runIosRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        mappedStopsOnly: true,
        originTitle: "SuperGrok",
        originFingerprint: superGrokFingerprint,
        preludeSteps: mappedSuperGrokPrelude,
        fallbackStops: [{ label: "Manage billing" }],
      },
      noLog,
    );
    assert.match(presses[0] ?? "", /settings_button/);
    assert.match(presses[1] ?? "", /SuperGrok/);
    assert.equal(
      presses.some((press) => press.startsWith("point:")),
      false,
    );
  });

  it("skips mapped SuperGrok prelude when already on the destination fingerprint", async () => {
    const { device, presses } = homeToSuperGrokDevice("supergrok");
    await runIosRecipeStep(
      device,
      {
        kind: "tour",
        screenshot: false,
        mappedStopsOnly: true,
        originTitle: "SuperGrok",
        originFingerprint: superGrokFingerprint,
        preludeSteps: mappedSuperGrokPrelude,
      },
      noLog,
    );
    assert.equal(
      presses.some((press) => press.includes("settings_button") || press.includes("SuperGrok")),
      false,
    );
    assert.deepEqual(presses, []);
  });

  it("fails closed when the SuperGrok prelude start is not visible", async () => {
    const { device, presses } = homeToSuperGrokDevice("composer");
    await assert.rejects(
      () =>
        runIosRecipeStep(
          device,
          {
            kind: "tour",
            screenshot: false,
            mappedStopsOnly: true,
            originTitle: "SuperGrok",
            originFingerprint: superGrokFingerprint,
            preludeSteps: mappedSuperGrokPrelude,
            fallbackStops: [{ label: "Manage billing" }],
          },
          noLog,
        ),
      /tour:not-on-origin/,
    );
    assert.equal(
      presses.some(
        (press) =>
          press.includes("settings_button") ||
          press.includes("SuperGrok") ||
          press.includes("Settings") ||
          press.startsWith("point:"),
      ),
      false,
    );
  });
});

describe("runRecipeStep expect-screen mapped prelude", () => {
  const superGrokNodes = [
    {
      type: "Application",
      identifier: "ai.x.grok",
      label: "Grok",
      rect: { x: 0, y: 0, width: 834, height: 1112 },
    },
    {
      type: "TextView",
      identifier: "supergrok_title",
      label: "SuperGrok",
      hittable: true,
      rect: { x: 40, y: 80, width: 240, height: 40 },
    },
  ];
  const homeWithSettings = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "Button",
      identifier: "settings_button",
      label: "Settings",
      hittable: true,
      rect: { x: 40, y: 560, width: 72, height: 80 },
    },
  ];
  const settingsWithSuperGrok = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "Button",
      label: "SuperGrok",
      hittable: true,
      rect: { x: 20, y: 400, width: 300, height: 56 },
    },
  ];
  const composerOpen = [
    { type: "Application", label: "Grok", rect: { x: 0, y: 0, width: 834, height: 1112 } },
    {
      type: "Button",
      label: "Close",
      hittable: true,
      rect: { x: 20, y: 80, width: 80, height: 40 },
    },
    { type: "Keyboard", role: "keyboard", rect: { x: 0, y: 700, width: 834, height: 400 } },
  ];
  const fingerprint = observeScreenIdentity(superGrokNodes).fingerprint;

  function describePress(options: unknown): string {
    if (!options || typeof options !== "object") return "";
    if ("selector" in options && typeof options.selector === "string") return options.selector;
    if (
      "x" in options &&
      "y" in options &&
      typeof options.x === "number" &&
      typeof options.y === "number"
    ) {
      return `point:${options.x},${options.y}`;
    }
    return "";
  }

  function expectSuperGrokStep(): Extract<RecipeStep, { kind: "expect-screen" }> {
    // Compiled Tests attach inbound prelude onto expect-screen; the host is
    // read at runtime by mappedPreludeHost rather than the protocol union.
    return {
      kind: "expect-screen",
      screenId: "supergrok",
      screenTitle: "SuperGrok",
      fingerprint,
      timeoutMs: 250,
      preludeSteps: [
        { kind: "tap", target: { identifier: "settings_button" } },
        { kind: "tap", target: { label: "SuperGrok" } },
      ],
    } as Extract<RecipeStep, { kind: "expect-screen" }>;
  }

  function homeToSuperGrokDevice(start: "home" | "supergrok" | "composer") {
    let screen: "home" | "settings" | "supergrok" | "composer" = start;
    const presses: string[] = [];
    const device = stubDevice({
      snapshot: () =>
        Promise.resolve({
          nodes:
            screen === "home"
              ? homeWithSettings
              : screen === "settings"
                ? settingsWithSuperGrok
                : screen === "composer"
                  ? composerOpen
                  : superGrokNodes,
        }),
      press: (options) => {
        const selector = describePress(options);
        presses.push(selector);
        if (selector.includes("settings_button")) screen = "settings";
        else if (selector.includes("SuperGrok")) screen = "supergrok";
        return Promise.resolve({});
      },
      wait: () => Promise.resolve({}),
    });
    return { device, presses };
  }

  it("seeks SuperGrok from home by tapping mapped settings then SuperGrok", async () => {
    const { device, presses } = homeToSuperGrokDevice("home");
    await runRecipeStep(device, expectSuperGrokStep(), noLog);
    assert.match(presses[0] ?? "", /settings_button/);
    assert.match(presses[1] ?? "", /SuperGrok/);
    assert.equal(
      presses.some((press) => press.startsWith("point:")),
      false,
    );
  });

  it("skips mapped SuperGrok prelude when already on the destination fingerprint", async () => {
    const { device, presses } = homeToSuperGrokDevice("supergrok");
    await runRecipeStep(device, expectSuperGrokStep(), noLog);
    assert.deepEqual(presses, []);
  });

  it("fails closed when the SuperGrok prelude start is not visible", async () => {
    const { device, presses } = homeToSuperGrokDevice("composer");
    await assert.rejects(
      () =>
        runRecipeStep(device, expectSuperGrokStep(), {
          log: () => {},
          observeVisualFingerprint: () => Promise.resolve("f".repeat(64)),
        }),
      /expect-screen: on “.*”, not “SuperGrok”/,
    );
    assert.equal(
      presses.some(
        (press) =>
          press.includes("settings_button") ||
          press.includes("SuperGrok") ||
          press.startsWith("point:"),
      ),
      false,
    );
  });
});

it("marks only a failed pre-tap snapshot as not dispatched", async () => {
  let presses = 0;
  const device = stubDevice({
    snapshot: async () => {
      throw new Error("helper retirement failed");
    },
    press: async () => {
      presses++;
      return {};
    },
  });
  await assert.rejects(
    runRecipeStep(device, { kind: "tap", target: { label: "Rede e Internet" } }, noLog),
    InputNotDispatchedError,
  );
  assert.equal(presses, 0);
});
it("does not label an attempted tap failure as not dispatched", async () => {
  let presses = 0;
  const device = stubDevice({
    snapshot: async () => ({
      nodes: [
        {
          role: "button",
          label: "Continue",
          enabled: true,
          hittable: true,
          rect: { x: 10, y: 20, width: 100, height: 40 },
        },
      ],
    }),
    press: async () => {
      presses++;
      throw new Error("helper retirement failed after tap");
    },
  });
  await assert.rejects(
    runRecipeStep(device, { kind: "tap", target: { label: "Continue" } }, noLog),
    (error) => !(error instanceof InputNotDispatchedError),
  );
  assert.ok(presses > 0);
});

it("does not try a fallback target after an Android tap acknowledgement is lost", async () => {
  let presses = 0;
  const device = stubDevice({
    snapshot: async () => ({
      nodes: [
        {
          role: "button",
          label: "Send",
          enabled: true,
          hittable: true,
          rect: { x: 10, y: 20, width: 100, height: 40 },
        },
      ],
    }),
    press: async () => {
      presses += 1;
      throw new Error("connection reset");
    },
  });
  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "android-candidate-no-retry" },
      () =>
        runRecipeStepWithoutContext(
          device,
          { kind: "tap", target: { label: "Send" }, fallbackTargets: [{ label: "Submit" }] },
          noLog,
        ),
    ),
    InputOutcomeUnknownError,
  );
  assert.equal(presses, 1);
});

it("stops optional actions and campaign cleanup after an uncertain Android input", async () => {
  for (const campaign of [false, true]) {
    let presses = 0;
    const device = stubDevice({
      snapshot: async () => ({ nodes: [] }),
      press: async () => {
        presses++;
        throw new Error("acknowledgement lost");
      },
    });
    const primary = { kind: "tap" as const, target: { identifier: "Send" } };
    const recipeGraph = {
      primary: {
        id: "primary",
        title: "Primary",
        source: "custom" as const,
        steps: [primary],
        createdAt: 1,
        updatedAt: 1,
      },
      cleanup: {
        id: "cleanup",
        title: "Cleanup",
        source: "custom" as const,
        steps: [primary],
        createdAt: 1,
        updatedAt: 1,
      },
    };
    await assert.rejects(
      runRecipeStep(
        device,
        campaign
          ? {
              kind: "module",
              recipeId: "primary",
              check: {
                id: "send",
                title: "Send",
                cleanup: { recipeId: "cleanup", terminalScreenId: "home", onCancel: "skip" },
              },
            }
          : { ...primary, optional: true },
        { ...noLog, recipeGraph, runtime: {} },
      ),
      InputOutcomeUnknownError,
    );
    assert.equal(presses, 1, "neither optional handling nor cleanup may dispatch another input");
  }
});
