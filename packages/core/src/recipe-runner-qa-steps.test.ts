import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PNG } from "pngjs";
import { runRecipeStep } from "./recipe-runner.js";
import { registerEvaluationProvider } from "./evaluation.js";
import { registerVisualEvaluationProvider } from "./evaluation-visual.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { TestJob } from "./session.js";
import { runWithTargetContext } from "./target-context.js";
import type { Device } from "./device.js";

function job(): TestJob {
  return { resolvedInputs: {}, artifacts: [] } as unknown as TestJob;
}

function stubBrowserDevice(): Device {
  const png = PNG.sync.write(new PNG({ width: 2, height: 2 }));
  return {
    interactions: {},
    command: { wait: async () => ({}), home: async () => ({}) },
    capture: {
      snapshot: async () => ({ nodes: [] }),
      screenshot: async (input?: { path?: string }) => {
        if (input?.path) await writeFile(input.path, png);
        return { path: input?.path ?? "", bytes: png };
      },
    },
  } as unknown as Device;
}

describe("daily QA recipe steps", () => {
  it("fails wait-response when the reply exceeds maxMs", async () => {
    const owner = job();
    let sample = 0;
    const device = {
      interactions: {},
      command: {
        wait: () => new Promise((resolve) => setTimeout(resolve, 30)),
        home: async () => ({}),
      },
      capture: {
        snapshot: () => {
          sample += 1;
          const value = sample < 2 ? "" : "Paris is in France.";
          return Promise.resolve({
            nodes: value
              ? [
                  { ref: "@answer", label: "Assistant response", value },
                  { label: "Send", value: "Ready" },
                ]
              : [],
          });
        },
      },
    } as unknown as Device;
    await assert.rejects(
      () =>
        runWithTargetContext(
          { kind: "device", platform: "android", serial: "recipe-qa-maxms" },
          () =>
            runRecipeStep(
              device,
              {
                kind: "wait-response",
                target: { ref: "@answer" },
                idleTarget: { label: "Send" },
                timeoutMs: 2_000,
                stableForMs: 50,
                maxMs: 1,
              },
              { log: () => {}, job: owner },
            ),
        ),
      /exceeded maxMs/,
    );
  });

  it("evaluates a screenshot with a registered visual judge", async () => {
    const unregister = registerVisualEvaluationProvider({
      id: "visual-fixture",
      evaluate: async () => ({
        status: "pass",
        confidence: 1,
        score: 1,
        summary: "composer is empty",
        criteria: [],
        provider: "visual-fixture",
        model: "fixture",
        evaluatedAt: Date.now(),
      }),
    });
    const owner = job();
    const ctx: RecipeStepContext = { log: () => {}, job: owner };
    try {
      await runWithTargetContext(
        { kind: "browser", platform: "browser", targetId: "grok-web" },
        () =>
          runRecipeStep(
            stubBrowserDevice(),
            {
              kind: "evaluate-visual",
              criteria: ["Composer is empty"],
              provider: "visual-fixture",
            },
            ctx,
          ),
      );
      assert.equal(
        owner.artifacts.some((item) => item.kind === "visual-evaluation"),
        true,
      );
      assert.equal(
        owner.artifacts.some((item) => item.kind === "judged-image"),
        true,
      );
      const image = owner.artifacts.find((item) => item.kind === "judged-image");
      assert.equal(typeof (image?.data as { sha256?: string } | undefined)?.sha256, "string");
      assert.equal((image?.data as { sha256: string }).sha256.length, 64);
    } finally {
      unregister();
    }
  });

  it("stores both visual verdicts, the judged image, and cost when judges disagree", async () => {
    const unregisterFirst = registerVisualEvaluationProvider({
      id: "visual-pass",
      evaluate: async () => ({
        status: "pass",
        confidence: 0.95,
        score: 1,
        summary: "composer looks empty",
        criteria: [],
        provider: "visual-pass",
        model: "pass-v1",
        evaluatedAt: Date.now(),
        costUsd: 0.0012,
      }),
    });
    const unregisterSecond = registerVisualEvaluationProvider({
      id: "visual-fail",
      evaluate: async () => ({
        status: "fail",
        confidence: 0.9,
        score: 0,
        summary: "composer shows a prompt",
        criteria: [],
        provider: "visual-fail",
        model: "fail-v1",
        evaluatedAt: Date.now(),
        costUsd: 0.0008,
      }),
    });
    const owner = job();
    const logs: string[] = [];
    try {
      await assert.rejects(
        () =>
          runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
            runRecipeStep(
              stubBrowserDevice(),
              {
                kind: "evaluate-visual",
                criteria: ["Composer is empty"],
                provider: "visual-pass",
                requireAgreement: true,
                secondProvider: "visual-fail",
              },
              { log: (line) => logs.push(line), job: owner, runtime: {} },
            ),
          ),
        /judge uncertain: judges disagree/,
      );
      assert.equal(owner.artifacts.filter((item) => item.kind === "visual-evaluation").length, 2);
      assert.equal(
        owner.artifacts.some((item) => item.kind === "judge-consensus"),
        true,
      );
      assert.equal(
        owner.artifacts.some((item) => item.kind === "judged-image"),
        true,
      );
      assert.equal(
        logs.some((line) => line.includes("$0.0012")),
        true,
      );
    } finally {
      unregisterFirst();
      unregisterSecond();
    }
  });

  it("registers an identity-ignore region for later screen proofs", async () => {
    const owner = job();
    const runtime: RecipeStepContext["runtime"] = {};
    await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
      runRecipeStep(
        stubBrowserDevice(),
        {
          kind: "identity-ignore",
          name: "reply body",
          region: { x: 80, y: 180, width: 900, height: 1400 },
        },
        { log: () => {}, job: owner, runtime },
      ),
    );
    assert.deepEqual(runtime?.identityIgnoreRegions, [
      { x: 80, y: 180, width: 900, height: 1400, name: "reply body" },
    ]);
    assert.equal(
      owner.artifacts.some((item) => item.kind === "identity-ignore"),
      true,
    );
  });

  it("rejects browser background at the platform seam", async () => {
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
          runRecipeStep(
            stubBrowserDevice(),
            { kind: "app", action: "background", app: "ai.x.grok" },
            { log: () => {}, job: job() },
          ),
        ),
      /not supported on browser/,
    );
  });

  it("fails closed when the semantic judge is not configured", async () => {
    const owner = job();
    owner.resolvedInputs.response = "Paris is in France.";
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
          runRecipeStep(
            stubBrowserDevice(),
            {
              kind: "evaluate-semantic",
              input: "response",
              criteria: ["Names France"],
              provider: "missing-judge-provider",
            },
            { log: () => {}, job: owner },
          ),
        ),
      /semantic judge unavailable/,
    );
    assert.equal(
      owner.artifacts.some((item) => item.kind === "semantic-evaluation"),
      false,
    );
  });

  it("fails an intentionally wrong criterion and stores the fail verdict", async () => {
    const unregister = registerEvaluationProvider({
      id: "judge-wrong-criterion",
      evaluate: async (input) => ({
        status: "fail",
        confidence: 0.99,
        score: 0,
        summary: "The reply does not mention Mars.",
        criteria: input.criteria.map((description, index) => ({
          id: `criterion-${index + 1}`,
          description,
          passed: false,
          score: 0,
          evidence: "France",
        })),
        provider: "judge-wrong-criterion",
        model: "fixture",
        evaluatedAt: 1,
      }),
    });
    const owner = job();
    owner.resolvedInputs.response = "Paris is in France.";
    try {
      await assert.rejects(
        () =>
          runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
            runRecipeStep(
              stubBrowserDevice(),
              {
                kind: "evaluate-semantic",
                input: "response",
                criteria: ["Mentions Mars"],
                provider: "judge-wrong-criterion",
              },
              { log: () => {}, job: owner },
            ),
          ),
        /semantic assertion: The reply does not mention Mars/,
      );
      const evaluation = owner.artifacts.find((item) => item.kind === "semantic-evaluation");
      assert.equal((evaluation?.data as { status?: string } | undefined)?.status, "fail");
    } finally {
      unregister();
    }
  });

  it("marks an ambiguous judge as uncertain, never a silent pass", async () => {
    const unregister = registerEvaluationProvider({
      id: "judge-ambiguous",
      evaluate: async (input) => ({
        status: "uncertain",
        confidence: 0.4,
        score: 0.5,
        summary: "The reply could be read either way.",
        criteria: input.criteria.map((description, index) => ({
          id: `criterion-${index + 1}`,
          description,
          passed: false,
          score: 0.5,
          evidence: "ambiguous",
        })),
        provider: "judge-ambiguous",
        model: "fixture",
        evaluatedAt: 1,
      }),
    });
    const owner = job();
    owner.resolvedInputs.response = "Maybe.";
    try {
      await assert.rejects(
        () =>
          runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
            runRecipeStep(
              stubBrowserDevice(),
              {
                kind: "evaluate-semantic",
                input: "response",
                criteria: ["Gives a definitive ranking"],
                provider: "judge-ambiguous",
              },
              { log: () => {}, job: owner },
            ),
          ),
        /judge uncertain: The reply could be read either way/,
      );
      const evaluation = owner.artifacts.find((item) => item.kind === "semantic-evaluation");
      assert.equal((evaluation?.data as { status?: string } | undefined)?.status, "uncertain");
      assert.equal(
        owner.artifacts.some(
          (item) =>
            item.kind === "semantic-evaluation" &&
            (item.data as { status?: string } | undefined)?.status === "pass",
        ),
        false,
      );
    } finally {
      unregister();
    }
  });

  it("blocks iOS upload with a Files-app reason before dispatch", async () => {
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial: "ipad-upload" }, () =>
          runRecipeStep(
            stubBrowserDevice(),
            { kind: "upload", file: "tests/fixtures/sample.pdf" },
            { log: () => {}, job: job() },
          ),
        ),
      /Files-app/,
    );
  });
});
