import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapScenarioTest, AppMapScenarioTestStep } from "@relay/protocol";
import {
  AppMapTestStepOperationError,
  addScenarioTestStep,
  applyScenarioTestStepEdits,
  bindScenarioTestStep,
  findScenarioTestStep,
  patchScenarioTestStep,
  removeScenarioTestStep,
  reorderScenarioTestSteps,
  selectScenarioTestStep,
  unbindScenarioTestStep,
} from "../app-map.js";

const unresolved = { status: "unresolved" as const, reason: "Choose a binding" };

function leaf(id: string, intent = id): AppMapScenarioTestStep {
  return { id, kind: "manual", intent, binding: unresolved };
}

function scenario(): AppMapScenarioTest {
  return {
    id: "checkout-test",
    organizationId: "org-1",
    projectId: "project-1",
    appMapId: "map-1",
    createdAt: 1,
    updatedAt: 1,
    name: "Checkout",
    kind: "scenario",
    intentSchemaVersion: 1,
    steps: [
      leaf("open-cart"),
      {
        id: "choose-path",
        kind: "decision",
        intent: "Choose a checkout path",
        binding: unresolved,
        thenSteps: [leaf("guest-checkout")],
      },
      {
        id: "retry-payment",
        kind: "loop",
        intent: "Retry payment",
        binding: unresolved,
        steps: [leaf("submit-payment")],
      },
    ],
  };
}

function expectOperationError(fn: () => unknown, code: AppMapTestStepOperationError["code"]): void {
  assert.throws(fn, (error) => {
    assert.ok(error instanceof AppMapTestStepOperationError);
    assert.equal(error.code, code);
    return true;
  });
}

test("finds and selects nested steps with stable structural locations", () => {
  const source = scenario();
  const guest = source.steps[1];
  assert.deepEqual(findScenarioTestStep(source, "guest-checkout"), {
    step: guest?.kind === "decision" ? guest.thenSteps[0] : undefined,
    parentStepId: "choose-path",
    branch: "then",
    index: 0,
    ancestorStepIds: ["choose-path"],
  });
  assert.equal(selectScenarioTestStep(source, "submit-payment").branch, "steps");
  assert.equal(findScenarioTestStep(source, "missing"), undefined);
  expectOperationError(() => selectScenarioTestStep(source, "missing"), "step-not-found");
});

test("adds at root and into decision and loop branches without mutating input", () => {
  const source = scenario();
  const root = addScenarioTestStep(source, leaf("before-cart"), {}, 0);
  const otherwise = addScenarioTestStep(root, leaf("member-checkout"), {
    parentStepId: "choose-path",
    branch: "else",
  });
  const loop = addScenarioTestStep(
    otherwise,
    leaf("verify-payment"),
    { parentStepId: "retry-payment", branch: "steps" },
    1,
  );

  assert.deepEqual(
    source.steps.map(({ id }) => id),
    ["open-cart", "choose-path", "retry-payment"],
  );
  const originalDecision = source.steps[1];
  assert.equal(
    originalDecision?.kind === "decision" ? originalDecision.elseSteps : undefined,
    undefined,
  );
  assert.deepEqual(
    loop.steps.map(({ id }) => id),
    ["before-cart", "open-cart", "choose-path", "retry-payment"],
  );
  const decision = selectScenarioTestStep(loop, "choose-path").step;
  assert.deepEqual(decision.kind === "decision" ? decision.elseSteps?.map(({ id }) => id) : [], [
    "member-checkout",
  ]);
  assert.equal(selectScenarioTestStep(loop, "verify-payment").index, 1);
});

test("patches only authorable fields and preserves identity and kind", () => {
  const source = scenario();
  const changed = patchScenarioTestStep(source, "open-cart", {
    intent: "Open the shopping cart",
    note: "Starts from the product page",
  });
  const patched = selectScenarioTestStep(changed, "open-cart").step;

  assert.equal(patched.id, "open-cart");
  assert.equal(patched.kind, "manual");
  assert.equal(patched.intent, "Open the shopping cart");
  assert.equal(patched.note, "Starts from the product page");
  assert.equal(selectScenarioTestStep(source, "open-cart").step.note, undefined);

  const withoutNote = patchScenarioTestStep(changed, "open-cart", { note: null });
  assert.equal(selectScenarioTestStep(withoutNote, "open-cart").step.note, undefined);
  assert.equal("note" in selectScenarioTestStep(withoutNote, "open-cart").step, false);
  expectOperationError(
    () => patchScenarioTestStep(source, "open-cart", { id: "replacement" } as never),
    "invalid-patch",
  );
  expectOperationError(
    () => patchScenarioTestStep(source, "open-cart", { kind: "script" } as never),
    "invalid-patch",
  );
});

test("removes nested steps and reorders only complete sibling sets", () => {
  const source = scenario();
  const reordered = reorderScenarioTestSteps(source, ["retry-payment", "choose-path", "open-cart"]);
  assert.deepEqual(
    reordered.steps.map(({ id }) => id),
    ["retry-payment", "choose-path", "open-cart"],
  );

  const removed = removeScenarioTestStep(reordered, "guest-checkout");
  const decision = selectScenarioTestStep(removed, "choose-path").step;
  assert.deepEqual(decision.kind === "decision" ? decision.thenSteps : [], []);
  assert.equal(findScenarioTestStep(source, "guest-checkout")?.step.id, "guest-checkout");

  expectOperationError(
    () => reorderScenarioTestSteps(source, ["open-cart", "choose-path"]),
    "incomplete-order",
  );
  expectOperationError(
    () => reorderScenarioTestSteps(source, ["open-cart", "choose-path", "choose-path"]),
    "incomplete-order",
  );
});

test("binds and unbinds while preserving step identity", () => {
  const source = scenario();
  const bound = bindScenarioTestStep(source, "open-cart", {
    status: "resolved",
    kind: "pause",
    message: "Open the cart manually",
  });
  assert.deepEqual(selectScenarioTestStep(bound, "open-cart").step.binding, {
    status: "resolved",
    kind: "pause",
    message: "Open the cart manually",
  });

  const unbound = unbindScenarioTestStep(bound, "open-cart", "Device map changed", [
    { kind: "screen", id: "cart", label: "Cart" },
  ]);
  assert.deepEqual(selectScenarioTestStep(unbound, "open-cart").step.binding, {
    status: "unresolved",
    reason: "Device map changed",
    candidates: [{ kind: "screen", id: "cart", label: "Cart" }],
  });
  assert.equal(selectScenarioTestStep(source, "open-cart").step.binding.status, "unresolved");

  expectOperationError(
    () => bindScenarioTestStep(source, "open-cart", unresolved),
    "invalid-binding",
  );
  expectOperationError(
    () =>
      bindScenarioTestStep(source, "open-cart", {
        status: "resolved",
        kind: "script",
        source: "return true",
      }),
    "invalid-binding",
  );
});

test("applies serializable edits in order and identifies a failed batch edit", () => {
  const source = scenario();
  const changed = applyScenarioTestStepEdits(source, [
    { kind: "test.patch", patch: { name: "Checkout safely" } },
    { kind: "step.add", step: leaf("review-order"), index: 1 },
    {
      kind: "step.patch",
      stepId: "review-order",
      patch: { intent: "Review the order" },
    },
    {
      kind: "step.reorder",
      orderedStepIds: ["review-order", "open-cart", "choose-path", "retry-payment"],
    },
    { kind: "step.unbind", stepId: "review-order", reason: "Needs mapping" },
  ]);

  assert.equal(changed.steps[0]?.id, "review-order");
  assert.equal(changed.name, "Checkout safely");
  assert.equal(changed.steps[0]?.intent, "Review the order");
  assert.deepEqual(
    source.steps.map(({ id }) => id),
    ["open-cart", "choose-path", "retry-payment"],
  );

  assert.throws(
    () => applyScenarioTestStepEdits(source, [{ kind: "test.patch", patch: {} }]),
    (error) =>
      error instanceof AppMapTestStepOperationError &&
      error.code === "invalid-patch" &&
      error.editIndex === 0,
  );

  assert.throws(
    () =>
      applyScenarioTestStepEdits(source, [
        { kind: "step.patch", stepId: "open-cart", patch: { intent: "Open cart" } },
        { kind: "step.remove", stepId: "missing" },
      ]),
    (error) => {
      assert.ok(error instanceof AppMapTestStepOperationError);
      assert.equal(error.code, "step-not-found");
      assert.equal(error.editIndex, 1);
      assert.match(error.message, /Edit 1 \(step\.remove\) failed/);
      return true;
    },
  );
  assert.equal(source.steps[0]?.intent, "open-cart");
});

test("reports precise placement, identity, and index failures", () => {
  const source = scenario();
  expectOperationError(() => addScenarioTestStep(source, leaf("open-cart")), "step-id-conflict");
  expectOperationError(() => addScenarioTestStep(source, leaf("late"), {}, 99), "invalid-index");
  expectOperationError(
    () => addScenarioTestStep(source, leaf("nested"), { parentStepId: "missing", branch: "then" }),
    "parent-not-found",
  );
  expectOperationError(
    () =>
      addScenarioTestStep(source, leaf("nested"), { parentStepId: "open-cart", branch: "then" }),
    "invalid-parent",
  );
  expectOperationError(
    () =>
      addScenarioTestStep(source, leaf("nested"), {
        parentStepId: "retry-payment",
        branch: "else",
      }),
    "invalid-branch",
  );
});
