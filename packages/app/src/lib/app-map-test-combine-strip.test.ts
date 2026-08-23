import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapVariable } from "@relay/protocol";
import {
  applyableVariables,
  projectTestCombineStrip,
  testCombineCaptureForLens,
  testCombineLensFromPolicy,
  testCombineSentence,
  testCombineStripRunInput,
  testDestinationHasFullSurfaceBinding,
  testDestinationScreenId,
  testWholePageAvailability,
  variableCanApply,
} from "./app-map-test-combine-strip";

function language(apply: AppMapVariable["apply"], options = ["en", "ja", "pt"]): AppMapVariable {
  return {
    id: "language",
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: "Language",
    kind: "language",
    apply,
    options: options.map((id) => ({ id, label: id.toUpperCase() })),
    createdAt: 1,
    updatedAt: 1,
  };
}

test("only Variables that can apply and undo appear on the Test strip", () => {
  const ready = language({
    kind: "list",
    entryPath: [{ kind: "tap", target: { label: "Open" } }],
    exitPath: [{ kind: "back" }],
  });
  const locale = language({ kind: "appLocale", app: "com.example" });
  locale.id = "app-locale";
  const broken = language({ kind: "list" });
  broken.id = "broken";
  assert.equal(variableCanApply(ready), true);
  assert.deepEqual(
    applyableVariables([ready, locale, broken]).map((item) => item.id),
    ["language", "app-locale"],
  );
});

test("Visual and Smoke map onto existing capture policies", () => {
  assert.deepEqual(testCombineCaptureForLens("visual"), { mode: "every-screen" });
  assert.deepEqual(testCombineCaptureForLens("smoke"), { mode: "failures-only" });
  assert.equal(testCombineLensFromPolicy("every-screen"), "visual");
  assert.equal(testCombineLensFromPolicy("failures-only"), "smoke");
});

test("the strip projects selected worlds as rows of this Test", () => {
  const variable = language({ kind: "appLocale", app: "com.example" });
  const strip = projectTestCombineStrip({
    test: { id: "settings-tour", name: "Settings tour" },
    variables: [variable],
    selected: { language: ["ja", "pt"] },
  });
  assert.equal(strip.worlds.length, 2);
  assert.equal(strip.cells.length, 2);
  assert.deepEqual(
    strip.cells.map((cell) => cell.values.language),
    ["ja", "pt"],
  );
  assert.equal(strip.column.id, "settings-tour");
  assert.equal(strip.combineId, "matrix-language-to-settings-tour");
  assert.match(
    testCombineSentence({
      testName: "Settings tour",
      worlds: strip.worlds,
      lens: "visual",
    }),
    /Run Settings tour in JA and PT as a visual/u,
  );
});

test("Whole page binds the last destination as a full-surface recapture", () => {
  const map = {
    connections: {
      open: {
        destination: { kind: "screen" as const, screenId: "long-list" },
      },
    },
  };
  const test = {
    steps: [
      {
        id: "open",
        kind: "instruction" as const,
        intent: "Open the list",
        binding: {
          status: "resolved" as const,
          kind: "connections" as const,
          connectionIds: ["open"],
        },
      },
    ],
  };
  assert.equal(testDestinationScreenId(map, test), "long-list");
  assert.equal(
    testDestinationScreenId(
      { connections: {} },
      {
        steps: [],
        surfaceBindings: [
          {
            screenId: "settings",
            variantId: "settings-en",
            captureMode: "full-surface",
            reason: "Settings scrolls.",
            compare: "visual-and-semantic",
            repair: "propose-recapture",
          },
        ],
      },
    ),
    "settings",
  );
  assert.deepEqual(
    testCombineStripRunInput({
      selected: { language: ["ja"] },
      lens: "visual",
      cell: "ja",
      wholePage: false,
      destinationScreenId: "long-list",
    }),
    { in: { language: ["ja"] }, lens: "visual", cell: "ja" },
  );
  assert.deepEqual(
    testCombineStripRunInput({
      selected: { language: ["ja"] },
      lens: "visual",
      cell: "ja",
      wholePage: true,
      destinationScreenId: "long-list",
    }),
    {
      in: { language: ["ja"] },
      lens: "visual",
      cell: "ja",
      surfaceCapture: { forceRecaptureScreenIds: ["long-list"] },
    },
  );
});

test("Whole page is not ready without a frozen full-surface binding", () => {
  const steps = [
    {
      id: "open",
      kind: "instruction" as const,
      intent: "Open the list",
      binding: {
        status: "resolved" as const,
        kind: "connections" as const,
        connectionIds: ["open"],
      },
    },
  ];
  const viewportOnly = {
    screens: {},
    screenVariants: {},
    connections: {
      open: { destination: { kind: "screen" as const, screenId: "long-list" } },
    },
  };
  assert.deepEqual(testWholePageAvailability(viewportOnly, { steps }), {
    destinationScreenId: "long-list",
    ready: false,
  });
  assert.equal(testDestinationHasFullSurfaceBinding(viewportOnly, {}, "long-list"), false);
  assert.equal(
    testDestinationHasFullSurfaceBinding(
      viewportOnly,
      {
        surfaceBindings: [
          {
            screenId: "long-list",
            variantId: "long-list-en",
            captureMode: "full-surface",
            reason: "The list scrolls.",
            compare: "visual-and-semantic",
            repair: "propose-recapture",
          },
        ],
      },
      "long-list",
    ),
    true,
  );
  assert.equal(
    testWholePageAvailability(
      {
        screens: {
          "long-list": { variantIds: ["long-list-en"] },
        } as never,
        screenVariants: {
          "long-list-en": {
            scrollSurfaces: [{ capturePolicy: { captureMode: "full-surface" } }],
          },
        } as never,
        connections: viewportOnly.connections,
      },
      { steps },
    ).ready,
    true,
  );
});
