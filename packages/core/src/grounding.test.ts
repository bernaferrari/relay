import assert from "node:assert/strict";
import test from "node:test";
import {
  GroundingError,
  StubVisionGrounder,
  createDefaultGrounder,
  groundTarget,
  type Grounder,
} from "./grounding.js";
import type { SnapshotNode } from "./device.js";

const askImagineMenu: SnapshotNode[] = [
  {
    label: "Ask",
    visibleToUser: true,
    hittable: true,
    rect: { x: 400, y: 140, width: 80, height: 40 },
  },
  {
    label: "Imagine",
    visibleToUser: true,
    hittable: true,
    rect: { x: 520, y: 140, width: 100, height: 40 },
  },
  { hittable: true, visibleToUser: true, rect: { x: 40, y: 140, width: 72, height: 72 } },
  { hittable: true, visibleToUser: true, rect: { x: 960, y: 140, width: 72, height: 72 } },
  {
    label: "Appearance",
    identifier: "settings_appearance",
    visibleToUser: true,
    hittable: true,
    rect: { x: 40, y: 400, width: 400, height: 56 },
  },
];

test("a unique label with a shared android:id/title taps the label", async () => {
  const result = await groundTarget({
    serial: "fake",
    target: "Network & internet",
    nodes: [
      {
        label: "Network & internet",
        identifier: "android:id/title",
        visibleToUser: true,
        rect: { x: 80, y: 605, width: 800, height: 50 },
      },
      {
        label: "Connected devices",
        identifier: "android:id/title",
        visibleToUser: true,
        rect: { x: 80, y: 811, width: 800, height: 50 },
      },
    ],
    grounder: new StubVisionGrounder(),
  });
  assert.equal(result.method, "a11y");
  assert.deepEqual(result.interaction, { kind: "label", label: "Network & internet" });
});

test("unique a11y label resolves with method a11y", async () => {
  const result = await groundTarget({
    serial: "fake",
    target: "Appearance",
    nodes: askImagineMenu,
    grounder: new StubVisionGrounder(),
  });
  assert.equal(result.method, "a11y");
  assert.equal(result.confidence, 0.95);
  assert.deepEqual(result.interaction, {
    kind: "identifier",
    identifier: "settings_appearance",
  });
});

test("InteractInput passthrough skips matching", async () => {
  const result = await groundTarget({
    serial: "fake",
    target: { kind: "point", x: 12, y: 34 },
    nodes: [],
    grounder: new StubVisionGrounder(),
  });
  assert.equal(result.method, "a11y");
  assert.equal(result.confidence, 1);
  assert.deepEqual(result.interaction, { kind: "point", x: 12, y: 34 });
});

test("Menu heuristic fires when Ask/Imagine are present", async () => {
  const result = await groundTarget({
    serial: "fake",
    target: "Menu",
    nodes: askImagineMenu,
    grounder: new StubVisionGrounder(),
  });
  assert.equal(result.method, "heuristic");
  assert.equal(result.interaction.kind, "point");
  if (result.interaction.kind === "point") {
    assert.ok(result.interaction.x < 200);
    assert.ok(result.interaction.y > 100);
  }
});

test("structured error lists candidates when nothing matches", async () => {
  await assert.rejects(
    () =>
      groundTarget({
        serial: "fake",
        target: "NotARealControl",
        nodes: askImagineMenu,
        grounder: new StubVisionGrounder(),
        screenshot: { base64: "aaa" },
      }),
    (error: unknown) => {
      assert.ok(error instanceof GroundingError);
      assert.match(error.message, /No unique match/);
      assert.ok(error.candidates.some((item) => item.label === "Appearance"));
      assert.ok(error.candidates.some((item) => item.label === "Menu"));
      const json = error.toJSON();
      assert.equal(json.code, "grounding_failed");
      assert.ok(Array.isArray(json.candidates));
      return true;
    },
  );
});

test("createDefaultGrounder stubs when OpenRouter key is missing", () => {
  const grounder = createDefaultGrounder({} as NodeJS.ProcessEnv);
  assert.ok(grounder instanceof StubVisionGrounder);
});

test("vision grounder can supply a hit after a11y/heuristic miss", async () => {
  const vision: Grounder = {
    async groundVision() {
      return {
        interaction: { kind: "label", label: "VisionHit" },
        confidence: 0.6,
      };
    },
  };
  const result = await groundTarget({
    serial: "fake",
    target: "SomethingAmbiguous",
    nodes: [{ label: "Ask", visibleToUser: true, rect: { x: 1, y: 1, width: 10, height: 10 } }],
    screenshot: { base64: "abc" },
    grounder: vision,
  });
  assert.equal(result.method, "vision");
  assert.deepEqual(result.interaction, { kind: "label", label: "VisionHit" });
});
