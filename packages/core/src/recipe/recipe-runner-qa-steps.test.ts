import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PNG } from "pngjs";
import { runRecipeStep } from "./recipe-runner.js";
import { registerEvaluationProvider } from "../evaluation/evaluation.js";
import { registerVisualEvaluationProvider } from "../evaluation/evaluation-visual.js";
import { registerCheckDecider } from "./recipe-runner-check.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import type { TestJob } from "../session/session.js";
import { runWithTargetContext } from "../target/target-context.js";
import type { Device } from "../device/device.js";

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
      assert.equal((image!.data as { sha256: string }).sha256.length, 64);
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

  it("registers an identity-ignore region for this checkpoint's screen proofs", async () => {
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
      { x: 80, y: 180, width: 900, height: 1400, name: "reply body", frameIndex: 0 },
    ]);
    assert.equal(
      owner.artifacts.some((item) => item.kind === "identity-ignore"),
      true,
    );
  });

  it("fails evaluate-visual closed without OPENROUTER_API_KEY", async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await assert.rejects(
        () =>
          runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
            runRecipeStep(
              stubBrowserDevice(),
              { kind: "evaluate-visual", criteria: ["Composer is empty"] },
              { log: () => {}, job: job() },
            ),
          ),
        /visual judge unavailable: No model provider is configured/u,
      );
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous;
    }
  });

  it("fails evaluate-visual consensus closed without OPENROUTER, not as Needs review", async () => {
    const previous = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENROUTER_API_KEY;
    try {
      await assert.rejects(
        () =>
          runWithTargetContext({ kind: "browser", platform: "browser", targetId: "grok-web" }, () =>
            runRecipeStep(
              stubBrowserDevice(),
              {
                kind: "evaluate-visual",
                criteria: ["Composer is empty"],
                requireAgreement: true,
                secondProvider: "openrouter",
              },
              { log: () => {}, job: job() },
            ),
          ),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /visual judge unavailable: No model provider is configured/u);
          assert.doesNotMatch(message, /^judge uncertain:/u);
          return true;
        },
      );
    } finally {
      if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previous;
    }
  });

  it("rejects iOS lock at the platform seam", async () => {
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "device", platform: "ios", serial: "ipad-lock" }, () =>
          runRecipeStep(
            stubBrowserDevice(),
            { kind: "device", action: "lock" },
            { log: () => {}, job: job() },
          ),
        ),
      /not supported by this iOS runner/u,
    );
  });

  it("rejects browser offline on Android at the platform seam", async () => {
    await assert.rejects(
      () =>
        runWithTargetContext(
          { kind: "device", platform: "android", serial: "emulator-offline" },
          () =>
            runRecipeStep(
              stubBrowserDevice(),
              { kind: "offline", state: "on" },
              { log: () => {}, job: job() },
            ),
        ),
      /browser/u,
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

describe("plain-English check saved paths", () => {
  function semanticDevice(label = "Total due: $0"): Device {
    const base = stubBrowserDevice();
    return {
      ...base,
      interactions: {
        find: async ({ query }: { query: string }) => {
          if (query === "@total" || label.includes(query)) return {};
          throw new Error("No match");
        },
      },
      capture: {
        ...base.capture,
        snapshot: async () => ({
          nodes: [{ type: "text", content: label, visibleToUser: true }],
        }),
      },
    } as unknown as Device;
  }

  async function runCheck(
    step: Extract<Parameters<typeof runRecipeStep>[1], { kind: "evaluate-visual" }>,
    owner = job(),
  ) {
    await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "web" }, () =>
      runRecipeStep(semanticDevice(), step, { log: () => {}, job: owner }),
    );
    return owner;
  }

  it("replays a saved semantic check without either model", async () => {
    const owner = await runCheck({
      kind: "evaluate-visual",
      id: "relay-test-check-1",
      criteria: ["The total is zero"],
      cached: [
        {
          kind: "expect",
          target: { text: "Total due: $0", role: "text" },
          condition: "visible",
          timeoutMs: 1,
        },
      ],
    });
    const result = owner.artifacts.find((item) => item.kind === "check-result")?.data as {
      source?: string;
      recipeStepId?: string;
    };
    assert.deepEqual([result.source, result.recipeStepId], ["cache", "relay-test-check-1"]);
    assert.equal(
      owner.artifacts.some((item) => item.kind === "visual-evaluation"),
      false,
    );
  });

  it("resolves semantic evidence, confirms it visually, and records reusable steps", async () => {
    const unregisterCheck = registerCheckDecider(async ({ candidates }) => ({
      action: "expect",
      candidateIds: [candidates[0]!.id],
      reason: "the total text directly proves it",
    }));
    const unregisterVisual = registerVisualEvaluationProvider({
      id: "visual-fixture",
      evaluate: async () => ({
        status: "pass",
        confidence: 1,
        score: 1,
        summary: "total is zero",
        criteria: [],
        provider: "visual-fixture",
        model: "fixture",
        evaluatedAt: Date.now(),
      }),
    });
    try {
      const owner = await runCheck({
        kind: "evaluate-visual",
        id: "relay-test-check-1",
        criteria: ["The total is zero"],
        provider: "visual-fixture",
      });
      const result = owner.artifacts.find((item) => item.kind === "check-result")?.data as {
        source?: string;
        steps?: unknown[];
        confirmedByJudge?: boolean;
      };
      assert.equal(result.source, "model");
      assert.equal(result.confirmedByJudge, true);
      assert.deepEqual(result.steps, [
        { kind: "expect", target: { text: "Total due: $0", role: "text" }, condition: "visible" },
      ]);
      assert.equal(
        owner.artifacts.some((item) => item.kind === "visual-evaluation"),
        true,
      );
    } finally {
      unregisterCheck();
      unregisterVisual();
    }
  });

  it("records a miss, re-resolves live, and keeps infrastructure errors fatal", async () => {
    const unregisterCheck = registerCheckDecider(async ({ candidates }) => ({
      action: "expect",
      candidateIds: [candidates[0]!.id],
      reason: "replacement evidence",
    }));
    const unregisterVisual = registerVisualEvaluationProvider({
      id: "visual-fixture",
      evaluate: async () => ({
        status: "pass",
        confidence: 1,
        score: 1,
        summary: "total is zero",
        criteria: [],
        provider: "visual-fixture",
        model: "fixture",
        evaluatedAt: Date.now(),
      }),
    });
    try {
      const owner = await runCheck({
        kind: "evaluate-visual",
        id: "relay-test-check-1",
        criteria: ["The total is zero"],
        provider: "visual-fixture",
        cached: [
          {
            kind: "expect",
            target: { text: "Gone", role: "text" },
            condition: "visible",
            timeoutMs: 1,
          },
        ],
      });
      assert.equal(
        owner.artifacts.some(
          (item) =>
            item.kind === "check-decision" &&
            (item.data as { action?: string }).action === "cache-miss",
        ),
        true,
      );
      const result = owner.artifacts.find((item) => item.kind === "check-result")?.data as {
        source?: string;
      };
      assert.equal(result.source, "model");
    } finally {
      unregisterCheck();
      unregisterVisual();
    }
  });

  it("keeps snapshot and transport failures fatal instead of re-resolving a check", async () => {
    const device = semanticDevice();
    (device.interactions as { find: () => Promise<never> }).find = async () => {
      throw new Error("connection lost");
    };
    const owner = job();
    await assert.rejects(
      () =>
        runWithTargetContext({ kind: "browser", platform: "browser", targetId: "web" }, () =>
          runRecipeStep(
            device,
            {
              kind: "evaluate-visual",
              id: "relay-test-check-1",
              criteria: ["The total is zero"],
              cached: [
                {
                  kind: "expect",
                  target: { text: "Total due: $0", role: "text" },
                  condition: "visible",
                  timeoutMs: 1,
                },
              ],
            },
            { log: () => {}, job: owner },
          ),
        ),
      /connection lost/,
    );
    assert.equal(
      owner.artifacts.some((item) => item.kind === "check-decision"),
      false,
    );
    assert.equal(
      owner.artifacts.some((item) => item.kind === "check-result"),
      false,
    );
  });
});

it("crafted action-shaped validation paths never execute and fall back to the judge", async () => {
  const unregisterVisual = registerVisualEvaluationProvider({
    id: "visual-fixture",
    evaluate: async () => ({
      status: "pass",
      confidence: 1,
      score: 1,
      summary: "looks right",
      criteria: [],
      provider: "visual-fixture",
      model: "fixture",
      evaluatedAt: Date.now(),
    }),
  });
  const owner = job();
  try {
    await runWithTargetContext({ kind: "browser", platform: "browser", targetId: "web" }, () =>
      runRecipeStep(
        stubBrowserDevice(),
        {
          kind: "evaluate-visual",
          id: "relay-test-check-1",
          criteria: ["The screen looks right"],
          provider: "visual-fixture",
          cached: [{ kind: "tap", target: { label: "Must never run" } }],
        },
        { log: () => {}, job: owner },
      ),
    );
    assert.equal(
      owner.artifacts.some((item) => item.kind === "visual-evaluation"),
      true,
    );
    assert.equal(
      owner.artifacts.some(
        (item) =>
          item.kind === "check-decision" &&
          (item.data as { action?: string }).action === "cache-miss",
      ),
      false,
    );
  } finally {
    unregisterVisual();
  }
});
