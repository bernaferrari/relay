import assert from "node:assert/strict";
import { describe, test } from "node:test";
import type { RecipeStep } from "@relay/protocol";
import { compileExecutionRisk, EXECUTION_RISK_CODES } from "./execution-risk-compiler.js";

function graph(rootRecipeId: string, recipes: Record<string, { id: string; steps: RecipeStep[] }>) {
  return { kind: "recipe-graph" as const, rootRecipeId, recipes };
}

describe("compileExecutionRisk", () => {
  test("keeps ordinary bounded navigation safe and projects app boundaries", () => {
    const risk = compileExecutionRisk(
      graph("root", {
        root: {
          id: "root",
          steps: [
            {
              id: "open-settings",
              kind: "tap",
              target: { label: "Settings" },
              expectedApp: "com.example.app",
            },
          ],
        },
      }),
    );

    assert.deepEqual(risk, {
      schemaVersion: 1,
      level: "safe",
      reasons: [],
      externalEffects: [],
      confirmation: "none",
      expectedAppBoundaries: ["com.example.app"],
      maximumActions: 1,
      cleanupRequired: false,
    });
  });

  test("projects guarded external effects, cleanup, and stable reason codes", () => {
    const risk = compileExecutionRisk(
      graph("root", {
        root: {
          id: "root",
          steps: [
            { id: "open-link", kind: "app", action: "open", url: "https://example.test" },
            {
              id: "install-build",
              kind: "app",
              action: "install",
              app: "com.example.app",
              artifact: "fixture.apk",
            },
            {
              id: "grant-camera",
              kind: "permission",
              action: "grant",
              permission: "camera",
            },
          ],
        },
      }),
    );

    assert.equal(risk.level, "guarded");
    assert.equal(risk.confirmation, "once-per-run");
    assert.equal(risk.cleanupRequired, true);
    assert.equal(risk.maximumActions, 3);
    assert.deepEqual(risk.externalEffects, ["permission-change", "installation", "external-app"]);
    assert.deepEqual(risk.expectedAppBoundaries, ["com.example.app", "external-url"]);
    assert.deepEqual(
      risk.reasons.map(({ code, stepId }) => ({ code, stepId })),
      [
        { code: EXECUTION_RISK_CODES.appInstallation, stepId: "install-build" },
        { code: EXECUTION_RISK_CODES.externalApp, stepId: "open-link" },
        { code: EXECUTION_RISK_CODES.permissionChange, stepId: "grant-camera" },
      ],
    );
  });

  test("requires a human for destructive application removal", () => {
    const risk = compileExecutionRisk(
      graph("root", {
        root: {
          id: "root",
          steps: [{ id: "remove-app", kind: "app", action: "uninstall", app: "com.example.app" }],
        },
      }),
    );

    assert.equal(risk.level, "destructive");
    assert.equal(risk.confirmation, "human-only");
    assert.deepEqual(risk.externalEffects, ["data-deletion", "installation"]);
    assert.deepEqual(risk.reasons, [
      {
        stepId: "remove-app",
        code: EXECUTION_RISK_CODES.appUninstall,
        explanation: "The Test uninstalls an application and may remove its local data.",
      },
    ]);
  });

  test("fails closed for opaque code, missing recipes, and cycles", () => {
    const script = compileExecutionRisk(
      graph("root", {
        root: { id: "root", steps: [{ id: "custom", kind: "script", source: "tap()" }] },
      }),
    );
    assert.equal(script.level, "prohibited");
    assert.equal(script.reasons[0]?.code, EXECUTION_RISK_CODES.opaqueScript);

    const missing = compileExecutionRisk(
      graph("root", {
        root: { id: "root", steps: [{ id: "shared", kind: "module", recipeId: "missing" }] },
      }),
    );
    assert.equal(missing.level, "prohibited");
    assert.equal(missing.reasons[0]?.code, EXECUTION_RISK_CODES.missingRecipe);
    assert.equal(missing.maximumActions, undefined);

    const cycle = compileExecutionRisk(
      graph("root", {
        root: { id: "root", steps: [{ kind: "module", recipeId: "child" }] },
        child: { id: "child", steps: [{ kind: "module", recipeId: "root" }] },
      }),
    );
    assert.equal(cycle.level, "prohibited");
    assert.equal(cycle.reasons[0]?.code, EXECUTION_RISK_CODES.recipeCycle);
  });

  test("computes worst-case branch and repeat action bounds", () => {
    const risk = compileExecutionRisk(
      graph("root", {
        root: {
          id: "root",
          steps: [{ id: "twice", kind: "repeat", count: 2, recipeId: "choice" }],
        },
        choice: {
          id: "choice",
          steps: [
            {
              id: "choose",
              kind: "branch",
              input: "fixture",
              operator: "exists",
              thenRecipeId: "two-actions",
              elseRecipeId: "one-action",
            },
          ],
        },
        "two-actions": {
          id: "two-actions",
          steps: [
            { kind: "tap", target: { label: "One" } },
            { kind: "tap", target: { label: "Two" } },
          ],
        },
        "one-action": {
          id: "one-action",
          steps: [{ kind: "tap", target: { label: "Only" } }],
        },
      }),
    );

    assert.equal(risk.level, "safe");
    assert.equal(risk.maximumActions, 4);
    assert.equal(risk.maximumDurationMs, undefined);
  });

  test("projects an exact duration only when every step has an authored bound", () => {
    const risk = compileExecutionRisk(
      graph("root", {
        root: {
          id: "root",
          steps: [
            { kind: "sleep", ms: 250 },
            { kind: "wait-for", target: { label: "Ready" }, timeoutMs: 1_000 },
            {
              kind: "repeat",
              count: 2,
              recipeId: "settle",
            },
          ],
        },
        settle: { id: "settle", steps: [{ kind: "sleep", ms: 500 }] },
      }),
    );

    assert.equal(risk.maximumActions, 0);
    assert.equal(risk.maximumDurationMs, 2_250);
  });

  test("classifies the existing authoring interaction representation", () => {
    const risk = compileExecutionRisk({
      kind: "interactions",
      interactions: [
        {
          id: "write-clipboard",
          interaction: { kind: "clipboard", action: "write", text: "fixture" },
        },
        {
          id: "install-build",
          interaction: {
            kind: "app",
            action: "install",
            app: "com.example.app",
            artifact: "fixture.apk",
          },
        },
      ],
    });

    assert.equal(risk.level, "guarded");
    assert.equal(risk.maximumActions, 2);
    assert.equal(risk.cleanupRequired, true);
    assert.deepEqual(risk.expectedAppBoundaries, ["com.example.app"]);
    assert.deepEqual(
      risk.reasons.map((reason) => reason.code),
      [EXECUTION_RISK_CODES.appInstallation, EXECUTION_RISK_CODES.clipboardAccess],
    );
  });

  test("fails closed when a scenario cannot be frozen", () => {
    const risk = compileExecutionRisk({
      kind: "scenario-test",
      appMap: {} as never,
      test: { id: "broken", steps: [] } as never,
    });

    assert.equal(risk.level, "prohibited");
    assert.equal(risk.confirmation, "human-only");
    assert.equal(risk.reasons[0]?.code, EXECUTION_RISK_CODES.scenarioUncompilable);
  });
});
