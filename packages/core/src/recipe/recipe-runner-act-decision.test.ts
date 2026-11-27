import assert from "node:assert/strict";
import test from "node:test";
import {
  actCandidates,
  concreteStepsForDecision,
  normalizeActDecision,
  type ActObservationGeometry,
} from "./recipe-runner-act-decision.js";
import { browserPressKeyChord } from "../browser/browser-actuation.js";
import { checkCriteriaRequireVisualJudgment } from "./recipe-runner-check.js";

const geometry: ActObservationGeometry = {
  scale: 2,
  imageWidth: 1_600,
  imageHeight: 1_200,
  viewportWidth: 800,
  viewportHeight: 600,
};

test("unlabeled interactive controls stay visible to the model with coordinates", () => {
  const candidates = actCandidates(
    [
      { role: "button", label: "", rect: { x: 100, y: 50, width: 40, height: 40 }, hittable: true },
      { type: "div", rect: { x: 0, y: 0, width: 20, height: 20 } },
      { role: "button", label: "Save", rect: { x: 0, y: 100, width: 60, height: 30 } },
    ],
    geometry,
  );
  assert.equal(candidates.length, 2);
  const iconOnly = candidates[0]!;
  assert.equal(iconOnly.role, "button");
  // Candidate coordinates are in screenshot pixels (logical 120,70 × scale 2).
  assert.deepEqual({ x: iconOnly.x, y: iconOnly.y }, { x: 240, y: 140 });
  assert.deepEqual(iconOnly.target, { point: { x: 120, y: 70 } });
  // A plain layout div with no label, identifier, or interactive role is noise.
  assert.equal(candidates[1]!.label, "Save");
});

test("batch decisions normalize in order and drop malformed items", () => {
  const decision = normalizeActDecision({
    action: "tap",
    actions: [
      { action: "type", text: "Ada", candidateId: "c1" },
      { action: "type", text: "Lovelace", candidateId: "c2", submit: true },
      { action: "hover" },
    ],
    reason: "fill the form",
  });
  assert.equal(decision.action, "batch");
  if (decision.action !== "batch") return;
  assert.equal(decision.actions.length, 2);
  assert.equal(decision.actions[0]!.action, "type");
});

test("a batch never means two different first actions", () => {
  const decision = normalizeActDecision({
    action: "tap",
    candidateId: "c9",
    actions: [{ action: "scroll", direction: "left" }],
    reason: "ambiguous payload",
  });
  assert.equal(decision.action, "batch");
  if (decision.action !== "batch") return;
  assert.deepEqual(decision.actions, [{ action: "scroll", direction: "left" }]);
});

test("wait is bounded and verbs require their fields", () => {
  const wait = normalizeActDecision({ action: "wait", ms: 999_999, reason: "loading" });
  assert.equal(wait.action === "wait" && wait.ms, 15_000);
  assert.equal(
    normalizeActDecision({ action: "select", candidateId: "c1", reason: "no option" }).action,
    "impossible",
  );
  assert.equal(
    normalizeActDecision({ action: "press-key", reason: "no key" }).action,
    "impossible",
  );
});

test("coordinate taps translate screenshot pixels into logical coordinates", () => {
  const decision = normalizeActDecision({
    action: "tap",
    point: { x: 300, y: 200 },
    reason: "icon-only share button",
  });
  const concrete = concreteStepsForDecision(decision, [], geometry);
  assert.equal(concrete.coordinateVisual, true);
  const step = concrete.steps[0]!;
  assert.equal(step.kind, "tap");
  if (step.kind !== "tap") return;
  assert.deepEqual(step.target.point, {
    x: 150,
    y: 100,
    referenceBounds: { width: 800, height: 600 },
  });
});

test("semantic candidates always beat coordinates", () => {
  const candidates = actCandidates([
    { role: "button", label: "Share", rect: { x: 0, y: 0, width: 50, height: 20 } },
  ]);
  const decision = normalizeActDecision({
    action: "tap",
    candidateId: "c1",
    point: { x: 10, y: 10 },
    reason: "both present",
  });
  const concrete = concreteStepsForDecision(decision, candidates, geometry);
  assert.equal(concrete.coordinateVisual, false);
  const step = concrete.steps[0]!;
  assert.equal(step.kind === "tap" && step.target.label, "Share");
});

test("new verbs translate into ordinary recipe steps", () => {
  const candidates = actCandidates([
    { identifier: "country", label: "Country", rect: { x: 0, y: 0, width: 50, height: 20 } },
  ]);
  const select = concreteStepsForDecision(
    normalizeActDecision({ action: "select", candidateId: "c1", option: "Canada", reason: "pick" }),
    candidates,
  );
  assert.deepEqual(select.steps, [
    { kind: "select", target: { identifier: "country", label: "Country" }, option: "Canada" },
  ]);
  const press = concreteStepsForDecision(
    normalizeActDecision({
      action: "press-key",
      key: "k",
      modifiers: ["controlOrMeta"],
      reason: "open search",
    }),
    candidates,
  );
  assert.deepEqual(press.steps, [{ kind: "press-key", key: "k", modifiers: ["controlOrMeta"] }]);
  const horizontal = concreteStepsForDecision(
    normalizeActDecision({ action: "scroll", direction: "right", reason: "reveal" }),
    candidates,
  );
  assert.deepEqual(horizontal.steps, [{ kind: "scroll", direction: "right" }]);
});

test("batch steps concatenate in order with joined summary", () => {
  const candidates = actCandidates([
    { identifier: "first", type: "TextField", rect: { x: 0, y: 0, width: 50, height: 20 } },
    { identifier: "last", type: "TextField", rect: { x: 0, y: 30, width: 50, height: 20 } },
  ]);
  const concrete = concreteStepsForDecision(
    normalizeActDecision({
      action: "tap",
      actions: [
        { action: "type", text: "Ada", candidateId: "c1" },
        { action: "type", text: "Lovelace", candidateId: "c2" },
      ],
      reason: "fill the form",
    }),
    candidates,
  );
  assert.deepEqual(
    concrete.steps.map((step) => (step.kind === "type" ? step.text : step.kind)),
    ["Ada", "Lovelace"],
  );
  assert.match(concrete.summary, /→/u);
});

test("press-key chords are bounded and portable", () => {
  assert.equal(browserPressKeyChord("k", ["controlOrMeta"]), "ControlOrMeta+k");
  assert.equal(browserPressKeyChord("escape"), "Escape");
  assert.equal(browserPressKeyChord("tab", ["shift"]), "Shift+Tab");
  assert.throws(() => browserPressKeyChord("a"), /control or meta/u);
  assert.throws(() => browserPressKeyChord("escape", ["controlOrMeta"]), /explicitly/u);
  // Duplicate modifiers collapse rather than producing a broken chord.
  assert.equal(browserPressKeyChord("enter", ["shift", "shift"]), "Shift+Enter");
});

test("visual check language stays with the visual judge", () => {
  assert.equal(checkCriteriaRequireVisualJudgment(["the two panels do not overlap"]), true);
  assert.equal(checkCriteriaRequireVisualJudgment(["the save button is below the title"]), true);
  assert.equal(checkCriteriaRequireVisualJudgment(["exactly 3 items are listed"]), true);
  assert.equal(checkCriteriaRequireVisualJudgment(["the header uses the brand color"]), true);
  assert.equal(checkCriteriaRequireVisualJudgment(["text is not truncated"]), true);
  assert.equal(checkCriteriaRequireVisualJudgment(["a Save button is present"]), false);
  assert.equal(checkCriteriaRequireVisualJudgment(["the user is signed in"]), false);
});
