import assert from "node:assert/strict";
import test from "node:test";
import type {
  JourneyGraph,
  JourneyGraphFlow,
  JourneyGraphScreen,
  JourneyGraphTransition,
  RecipeStep,
} from "@relay/protocol";
import {
  compileJourneyGraph,
  JourneyGraphCompileError,
  type JourneyGraphCompileErrorCode,
  validateJourneyGraphIntegrity,
} from "./journey-graph-compiler.js";

const at = 1;

function screen(id: string): JourneyGraphScreen {
  return { id, title: id.toUpperCase(), createdAt: at, updatedAt: at };
}

function flow(name: string, screenId: string, id = `flow-${name}`): JourneyGraphFlow {
  return { id, name, screenId, createdAt: at, updatedAt: at };
}

function transition(
  id: string,
  fromScreenId: string,
  destination: JourneyGraphTransition["destination"],
  stepIds: string[] = [`step-${id}`],
  overrides: Partial<JourneyGraphTransition> = {},
): JourneyGraphTransition {
  return {
    id,
    fromScreenId,
    destination,
    stepIds,
    state: "recorded",
    kind: "forward",
    review: { status: "verified", updatedAt: at, verifiedAt: at },
    createdAt: at,
    updatedAt: at,
    ...overrides,
  };
}

function graph(
  screens: JourneyGraphScreen[],
  transitions: JourneyGraphTransition[],
  flows: JourneyGraphFlow[] = [flow("Main", screens[0]!.id)],
): JourneyGraph {
  return { schemaVersion: 1, screens, transitions, flows };
}

function tap(id: string, label = id): RecipeStep {
  return { id, kind: "tap", target: { label } };
}

function expectCompileError(
  code: JourneyGraphCompileErrorCode,
  run: () => unknown,
  message?: RegExp,
): void {
  assert.throws(run, (error: unknown) => {
    assert.ok(error instanceof JourneyGraphCompileError);
    assert.equal(error.code, code);
    if (message) assert.match(error.message, message);
    return true;
  });
}

test("compiles an explicit path from the named flow into recipe-compatible steps", () => {
  const steps = [tap("open"), tap("submit")];
  const value = graph(
    [screen("landing"), screen("form")],
    [
      transition("to-form", "landing", { kind: "screen", screenId: "form" }, ["open"]),
      transition("finish", "form", { kind: "end" }, ["submit"]),
    ],
    [flow("Checkout", "landing"), flow("Resume", "form")],
  );
  const before = JSON.stringify({ value, steps });

  const compiled = compileJourneyGraph({
    graph: value,
    flowName: "Checkout",
    recipeSteps: steps,
    transitionPath: ["to-form", "finish"],
  });

  assert.deepEqual(compiled.flow, {
    id: "flow-Checkout",
    name: "Checkout",
    startScreenId: "landing",
  });
  assert.deepEqual(compiled.transitionIds, ["to-form", "finish"]);
  assert.deepEqual(compiled.steps, steps);
  assert.deepEqual(compiled.terminal, { kind: "end" });
  assert.deepEqual(compiled.stepProvenance, [
    {
      compiledStepIndex: 0,
      transitionPathIndex: 0,
      transitionStepIndex: 0,
      stepId: "open",
      transitionId: "to-form",
      fromScreenId: "landing",
      destination: { kind: "screen", screenId: "form" },
    },
    {
      compiledStepIndex: 1,
      transitionPathIndex: 1,
      transitionStepIndex: 0,
      stepId: "submit",
      transitionId: "finish",
      fromScreenId: "form",
      destination: { kind: "end" },
    },
  ]);
  assert.deepEqual(compiled.transitionProvenance, [
    {
      transitionPathIndex: 0,
      transitionId: "to-form",
      fromScreenId: "landing",
      destination: { kind: "screen", screenId: "form" },
      compiledStepRange: [0, 1],
    },
    {
      transitionPathIndex: 1,
      transitionId: "finish",
      fromScreenId: "form",
      destination: { kind: "end" },
      compiledStepRange: [1, 2],
    },
  ]);
  assert.equal(JSON.stringify({ value, steps }), before, "compilation must not mutate its inputs");
});

test("infers a deterministic path only when each screen has one outgoing transition", () => {
  const value = graph(
    [screen("a"), screen("b")],
    [
      transition("next", "a", { kind: "screen", screenId: "b" }),
      transition("done", "b", { kind: "end" }),
    ],
  );

  const compiled = compileJourneyGraph({
    graph: value,
    flowName: "Main",
    recipeSteps: [tap("step-next"), tap("step-done")],
  });

  assert.deepEqual(compiled.transitionIds, ["next", "done"]);
  assert.deepEqual(
    compiled.steps.map((step) => step.id),
    ["step-next", "step-done"],
  );
});

test("an explicit empty path selects the flow start without traversing", () => {
  const compiled = compileJourneyGraph({
    graph: graph([screen("start")], []),
    flowName: "Main",
    recipeSteps: [],
    transitionPath: [],
    maxTransitions: 0,
  });

  assert.deepEqual(compiled.steps, []);
  assert.deepEqual(compiled.transitionProvenance, []);
  assert.deepEqual(compiled.terminal, { kind: "screen", screenId: "start" });
});

test("preserves provenance for verified automatic edges with no recipe steps", () => {
  const compiled = compileJourneyGraph({
    graph: graph(
      [screen("loading"), screen("ready")],
      [
        transition("settle", "loading", { kind: "screen", screenId: "ready" }, [], {
          mode: "automatic",
        }),
      ],
    ),
    flowName: "Main",
    recipeSteps: [],
    transitionPath: ["settle"],
  });

  assert.deepEqual(compiled.steps, []);
  assert.deepEqual(compiled.transitionProvenance[0]?.compiledStepRange, [0, 0]);
  assert.deepEqual(compiled.terminal, { kind: "screen", screenId: "ready" });
});

test("supports finite explicit return loops, including repeated transitions", () => {
  const value = graph(
    [screen("list"), screen("detail")],
    [
      transition("open", "list", { kind: "screen", screenId: "detail" }),
      transition("back", "detail", { kind: "screen", screenId: "list" }, ["step-back"], {
        kind: "return",
      }),
    ],
  );

  const compiled = compileJourneyGraph({
    graph: value,
    flowName: "Main",
    recipeSteps: [tap("step-open"), { id: "step-back", kind: "key", key: "back" }],
    transitionPath: ["open", "back", "open"],
  });

  assert.deepEqual(compiled.transitionIds, ["open", "back", "open"]);
  assert.deepEqual(
    compiled.steps.map((step) => step.id),
    ["step-open", "step-back", "step-open"],
  );
  assert.deepEqual(compiled.terminal, { kind: "screen", screenId: "detail" });
});

test("rejects an implicit cycle instead of traversing forever", () => {
  const value = graph(
    [screen("a"), screen("b")],
    [
      transition("out", "a", { kind: "screen", screenId: "b" }),
      transition("return", "b", { kind: "screen", screenId: "a" }, [], {
        kind: "return",
      }),
    ],
  );

  expectCompileError("implicit-cycle", () =>
    compileJourneyGraph({
      graph: value,
      flowName: "Main",
      recipeSteps: [tap("step-out")],
    }),
  );
});

test("rejects ambiguous implicit branches but accepts an explicit branch", () => {
  const value = graph(
    [screen("a"), screen("b"), screen("c")],
    [
      transition("left", "a", { kind: "screen", screenId: "b" }),
      transition("right", "a", { kind: "screen", screenId: "c" }),
    ],
  );
  const recipeSteps = [tap("step-left"), tap("step-right")];

  expectCompileError("ambiguous-branch", () =>
    compileJourneyGraph({ graph: value, flowName: "Main", recipeSteps }),
  );
  assert.deepEqual(
    compileJourneyGraph({
      graph: value,
      flowName: "Main",
      recipeSteps,
      transitionPath: ["right"],
    }).transitionIds,
    ["right"],
  );
});

test("rejects missing transitions and discontinuous explicit paths", async (context) => {
  const value = graph(
    [screen("a"), screen("b"), screen("c")],
    [
      transition("a-b", "a", { kind: "screen", screenId: "b" }),
      transition("c-end", "c", { kind: "end" }),
      transition("a-end", "a", { kind: "end" }),
    ],
  );
  const recipeSteps = [tap("step-a-b"), tap("step-c-end"), tap("step-a-end")];

  await context.test("missing id", () => {
    expectCompileError("missing-transition", () =>
      compileJourneyGraph({
        graph: value,
        flowName: "Main",
        recipeSteps,
        transitionPath: ["unknown"],
      }),
    );
  });
  await context.test("wrong source", () => {
    expectCompileError("discontinuous-path", () =>
      compileJourneyGraph({
        graph: value,
        flowName: "Main",
        recipeSteps,
        transitionPath: ["a-b", "c-end"],
      }),
    );
  });
  await context.test("continues after end", () => {
    expectCompileError("discontinuous-path", () =>
      compileJourneyGraph({
        graph: value,
        flowName: "Main",
        recipeSteps,
        transitionPath: ["a-end", "a-b"],
      }),
    );
  });
});

test("rejects edges that need recording or have not been verified", async (context) => {
  await context.test("needs recording", () => {
    const pending = transition("pending", "a", { kind: "end" }, [], {
      state: "needs-recording",
      review: undefined,
    });
    expectCompileError("needs-recording", () =>
      compileJourneyGraph({
        graph: graph([screen("a")], [pending]),
        flowName: "Main",
        recipeSteps: [],
        transitionPath: ["pending"],
      }),
    );
  });

  for (const status of [undefined, "draft", "failed"] as const) {
    await context.test(status ? `${status} review` : "missing review", () => {
      const edge = transition("edge", "a", { kind: "end" }, [], {
        review: status ? { status, updatedAt: at } : undefined,
      });
      expectCompileError("unverified-transition", () =>
        compileJourneyGraph({
          graph: graph([screen("a")], [edge]),
          flowName: "Main",
          recipeSteps: [],
          transitionPath: ["edge"],
        }),
      );
    });
  }
});

test("resolves only selected edge steps, so unrelated drafts remain authorable", () => {
  const value = graph(
    [screen("a"), screen("b"), screen("draft")],
    [
      transition("valid", "a", { kind: "screen", screenId: "b" }, ["known"]),
      transition("draft", "a", { kind: "screen", screenId: "draft" }, ["not-yet-added"], {
        state: "needs-recording",
        review: undefined,
      }),
    ],
  );

  const compiled = compileJourneyGraph({
    graph: value,
    flowName: "Main",
    recipeSteps: [tap("known")],
    transitionPath: ["valid"],
  });
  assert.deepEqual(
    compiled.steps.map((step) => step.id),
    ["known"],
  );
});

test("rejects missing and ambiguous recipe step references", async (context) => {
  const value = graph([screen("a")], [transition("edge", "a", { kind: "end" }, ["required-step"])]);

  await context.test("missing step", () => {
    expectCompileError("missing-step", () =>
      compileJourneyGraph({
        graph: value,
        flowName: "Main",
        recipeSteps: [],
        transitionPath: ["edge"],
      }),
    );
  });
  await context.test("duplicate supplied step id", () => {
    expectCompileError("ambiguous-step", () =>
      compileJourneyGraph({
        graph: value,
        flowName: "Main",
        recipeSteps: [tap("required-step"), tap("required-step", "Duplicate")],
        transitionPath: ["edge"],
      }),
    );
  });
});

test("validates graph ids and references before traversal", async (context) => {
  await context.test("duplicate screen id", () => {
    expectCompileError("invalid-graph", () =>
      validateJourneyGraphIntegrity(graph([screen("same"), screen("same")], [])),
    );
  });
  await context.test("missing flow screen", () => {
    expectCompileError("invalid-graph", () =>
      validateJourneyGraphIntegrity(graph([screen("a")], [], [flow("Main", "missing")])),
    );
  });
  await context.test("missing transition source", () => {
    expectCompileError("invalid-graph", () =>
      validateJourneyGraphIntegrity(
        graph([screen("a")], [transition("edge", "missing", { kind: "end" })]),
      ),
    );
  });
  await context.test("missing transition destination", () => {
    expectCompileError("invalid-graph", () =>
      validateJourneyGraphIntegrity(
        graph([screen("a")], [transition("edge", "a", { kind: "screen", screenId: "missing" })]),
      ),
    );
  });
  await context.test("duplicate transition id", () => {
    expectCompileError("invalid-graph", () =>
      validateJourneyGraphIntegrity(
        graph(
          [screen("a")],
          [transition("same", "a", { kind: "end" }), transition("same", "a", { kind: "end" })],
        ),
      ),
    );
  });
  await context.test("empty transition step id", () => {
    expectCompileError("invalid-graph", () =>
      validateJourneyGraphIntegrity(
        graph([screen("a")], [transition("edge", "a", { kind: "end" }, [""])]),
      ),
    );
  });
});

test("requires an unambiguous named flow", () => {
  const value = graph([screen("a")], [], [flow("Main", "a", "first"), flow("Main", "a", "second")]);
  expectCompileError("ambiguous-flow", () =>
    compileJourneyGraph({ graph: value, flowName: "Main", recipeSteps: [] }),
  );

  expectCompileError("missing-flow", () =>
    compileJourneyGraph({
      graph: graph([screen("a")], []),
      flowName: "Unknown",
      recipeSteps: [],
    }),
  );
});

test("enforces explicit and inferred traversal bounds", () => {
  const value = graph(
    [screen("a"), screen("b")],
    [transition("next", "a", { kind: "screen", screenId: "b" })],
  );
  const recipeSteps = [tap("step-next")];

  expectCompileError("path-too-long", () =>
    compileJourneyGraph({
      graph: value,
      flowName: "Main",
      recipeSteps,
      transitionPath: ["next"],
      maxTransitions: 0,
    }),
  );
  expectCompileError("path-too-long", () =>
    compileJourneyGraph({
      graph: value,
      flowName: "Main",
      recipeSteps,
      maxTransitions: 0,
    }),
  );
  expectCompileError("path-too-long", () =>
    compileJourneyGraph({
      graph: value,
      flowName: "Main",
      recipeSteps,
      transitionPath: [],
      maxTransitions: -1,
    }),
  );
});
