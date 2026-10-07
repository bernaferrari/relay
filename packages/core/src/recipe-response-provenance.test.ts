import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { contentAssertionPassed } from "./content-assertion-match.js";
import { registerEvaluationProvider } from "./evaluation.js";
import { runRecipeStep as runRecipeStepWithoutContext } from "./recipe-runner.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { TestJob } from "./session.js";
import type { Device } from "./device.js";
import { runWithTargetContext } from "./target-context.js";
import { JobCancelledError } from "./control.js";

const runRecipeStep: typeof runRecipeStepWithoutContext = (...args) =>
  runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-com" }, () =>
    runRecipeStepWithoutContext(...args),
  );

function job(): TestJob {
  return { resolvedInputs: {}, artifacts: [], status: "running" } as unknown as TestJob;
}

function stubDevice(
  pages: SnapshotNode[][],
  fill: () => Promise<unknown> = async () => ({}),
): Device {
  let sample = 0;
  return {
    interactions: {
      find: async () => ({}),
      press: async () => ({}),
      type: async () => ({}),
      fill,
    },
    command: {
      wait: () => new Promise((resolve) => setTimeout(resolve, 20)),
      home: async () => ({}),
    },
    capture: {
      snapshot: () => {
        const nodes = pages[Math.min(sample, pages.length - 1)] ?? [];
        sample += 1;
        return Promise.resolve({ nodes });
      },
    },
  } as unknown as Device;
}

type SnapshotNode = {
  label?: string;
  value?: string;
  identifier?: string;
  role?: string;
  ref?: string;
  rect?: { x: number; y: number; width: number; height: number };
};

function grok(nodes: SnapshotNode[]): SnapshotNode[] {
  return nodes;
}

function turn(value: string, ref: string, y = 240): SnapshotNode {
  return {
    role: "article",
    label: "Grok",
    identifier: "assistant-message",
    value,
    ref,
    rect: { x: 200, y, width: 400, height: 48 },
    visibleToUser: true,
  } as SnapshotNode;
}

const extract = {
  kind: "extract" as const,
  as: "response",
  target: { identifier: "assistant-message" },
  role: "assistant" as const,
};
const assertFour = {
  kind: "assert-content" as const,
  input: "response",
  expected: "4",
  match: "number-equals" as const,
};

describe("current-action response provenance", () => {
  const replacePrompt = {
    kind: "type" as const,
    id: "ask-replaced-prompt",
    text: "2+2",
    mode: "replace" as const,
    target: { identifier: "composer" },
  };

  it("replace input captures the old turn before dispatch and rejects an idle leftover", async () => {
    const owner = job();
    const leftover = grok([turn("4", "@old"), { identifier: "response.done" }]);
    const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
    let boundaryAtFill: unknown;
    const device = stubDevice([leftover], async () => {
      boundaryAtFill = ctx.runtime?.responseBoundary;
      return {};
    });
    await runRecipeStep(device, replacePrompt, ctx);
    assert.equal(ctx.runtime?.responseBoundary?.source, "initiating-action");
    assert.equal(ctx.runtime?.responseBoundary?.initiatingActionId, replacePrompt.id);
    assert.equal(boundaryAtFill, ctx.runtime?.responseBoundary);
    assert.equal(ctx.runtime?.responseBoundary?.turnIds.length, 1);
    await assert.rejects(
      () =>
        runRecipeStep(
          device,
          {
            kind: "wait-response",
            target: { identifier: "assistant-message" },
            idleTarget: { identifier: "response.done" },
            timeoutMs: 60,
            stableForMs: 20,
          },
          ctx,
        ),
      /response completion: timed out/u,
    );
    await assert.rejects(() => runRecipeStep(device, extract, ctx), /no verified new answer/u);
    assert.equal(owner.resolvedInputs.response, undefined);
  });

  it("replace input then identical new answer retains current-action turn identity", async () => {
    const owner = job();
    const leftover = grok([turn("4", "@old")]);
    const next = grok([turn("4", "@old"), turn("4", "@new", 80)]);
    const device = stubDevice([leftover, leftover, leftover, next, next, next]);
    const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
    await runRecipeStep(device, replacePrompt, ctx);
    await runRecipeStep(
      device,
      { kind: "wait-response", target: extract.target, timeoutMs: 2_000, stableForMs: 20 },
      ctx,
    );
    await runRecipeStep(device, extract, ctx);
    await runRecipeStep(device, assertFour, ctx);
    assert.equal(owner.resolvedInputs.response, "4");
    const artifact = owner.artifacts.find((item) => item.kind === "conversation-turn");
    assert.equal(
      (artifact?.data as { initiatingActionId?: string }).initiatingActionId,
      replacePrompt.id,
    );
  });

  it("replace input never extracts leftover content after a new quota or error", async () => {
    for (const label of ["Try again in 10 minutes", "Something went wrong"]) {
      const owner = job();
      const leftover = grok([turn("4", "@old")]);
      const quota = grok([turn("4", "@old"), { role: "text", label }]);
      const device = stubDevice([leftover, leftover, quota, quota]);
      const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
      await runRecipeStep(device, replacePrompt, ctx);
      await assert.rejects(() => runRecipeStep(device, extract, ctx), /no verified new answer/u);
      assert.equal(owner.resolvedInputs.response, undefined);
    }
  });

  it("cancellation during the replacement boundary probe never dispatches input", async () => {
    const cancellation = new JobCancelledError();
    let fills = 0;
    const device = stubDevice([[]], async () => {
      fills += 1;
      return {};
    });
    device.capture.snapshot = async () => {
      throw cancellation;
    };
    await assert.rejects(
      () => runRecipeStep(device, replacePrompt, { log: () => {}, job: job(), runtime: {} }),
      (error) => error === cancellation,
    );
    assert.equal(fills, 0);
  });

  it("type then extract refuses leftover 4 when the new observation is quota", async () => {
    const owner = job();
    const leftover = grok([turn("4", "@old")]);
    const quota = grok([
      turn("4", "@old"),
      { role: "text", label: "Try again in 10 minutes; no answer generated" },
    ]);
    const device = stubDevice([leftover, quota, quota]);
    const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
    await runRecipeStep(device, { kind: "type", id: "ask-2plus2", text: "2+2" }, ctx);
    await assert.rejects(() => runRecipeStep(device, extract, ctx), /no verified new answer/u);
    assert.equal(owner.resolvedInputs.response, undefined);
  });

  it("old 4 then new 5 fails unchanged number-equals 4 and records response identity", async () => {
    const owner = job();
    const leftover = grok([turn("4", "@old")]);
    const next = grok([turn("4", "@old"), turn("5", "@new", 80)]);
    const device = stubDevice([leftover, leftover, leftover, next, next, next, next]);
    const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
    await runRecipeStep(device, { kind: "type", id: "ask-next", text: "3+1" }, ctx);
    await runRecipeStep(
      device,
      {
        kind: "wait-response",
        target: { identifier: "assistant-message" },
        timeoutMs: 2_000,
        stableForMs: 20,
      },
      ctx,
    );
    await runRecipeStep(device, extract, ctx);
    assert.equal(owner.resolvedInputs.response, "5");
    const turnArtifact = owner.artifacts.find((item) => item.kind === "conversation-turn");
    const data = turnArtifact?.data as { responseId?: string; initiatingActionId?: string };
    assert.equal(data.initiatingActionId, "ask-next");
    assert.doesNotMatch(String(data.responseId), /@new|@old/u);
    assert.match(String(data.responseId), /turn:/u);
    await assert.rejects(() => runRecipeStep(device, assertFour, ctx), /content assertion/u);
    const check = owner.artifacts.find((item) => item.kind === "content-assertion");
    assert.equal((check?.data as { passed?: boolean }).passed, false);
    assert.equal((check?.data as { responseId?: string }).responseId, data.responseId);
  });

  it("old 4 then a new identified 4 passes number-equals", async () => {
    const owner = job();
    const leftover = grok([turn("4", "@old")]);
    const next = grok([turn("4", "@old"), turn("4", "@new", 80)]);
    const device = stubDevice([leftover, leftover, leftover, next, next, next, next]);
    const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
    await runRecipeStep(device, { kind: "type", id: "ask-again", text: "2+2" }, ctx);
    await runRecipeStep(
      device,
      {
        kind: "wait-response",
        target: { identifier: "assistant-message" },
        timeoutMs: 2_000,
        stableForMs: 20,
      },
      ctx,
    );
    await runRecipeStep(device, extract, ctx);
    await runRecipeStep(device, assertFour, ctx);
    assert.equal(owner.resolvedInputs.response, "4");
    assert.equal(contentAssertionPassed("4", "4", "number-equals"), true);
  });

  it("does not treat a reminted leftover ref as a new answer", async () => {
    const owner = job();
    const leftover = grok([turn("4", "@old")]);
    const reminted = grok([turn("4", "@reminted")]);
    const device = stubDevice([leftover, reminted, reminted]);
    const ctx: RecipeStepContext = { log: () => {}, job: owner, runtime: {} };
    await runRecipeStep(device, { kind: "type", id: "ask-again", text: "2+2" }, ctx);
    await assert.rejects(() => runRecipeStep(device, extract, ctx), /no verified new answer/u);
  });

  it("does not let a semantic judge rescue a failed deterministic assertion", async () => {
    const unregister = registerEvaluationProvider({
      id: "rescue-judge",
      evaluate: async () => ({
        status: "pass",
        confidence: 1,
        score: 1,
        summary: "looks like four",
        criteria: [],
        provider: "rescue-judge",
        model: "test",
        evaluatedAt: 1,
      }),
    });
    const owner = job();
    owner.artifacts.push({
      kind: "content-assertion",
      capturedAt: 1,
      data: { input: "response", expected: "4", match: "number-equals", passed: false },
    });
    owner.resolvedInputs.response = "5";
    try {
      await assert.rejects(
        () =>
          runRecipeStep(
            stubDevice([[]]),
            {
              kind: "evaluate-semantic",
              input: "response",
              criteria: ["The answer is 4"],
              provider: "rescue-judge",
            },
            { log: () => {}, job: owner },
          ),
        /deterministic content assertion already failed/u,
      );
    } finally {
      unregister();
    }
  });
});
