import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { AppMapCompiledTest, AppMapScenarioTest } from "@relay/protocol";
import type { JobInfo } from "../lib/api-types";
import { AppMapTestEvidencePanel } from "./app-map-test-evidence-panel";
import type { AppMapTestStartupScreenSource } from "../lib/app-map-test-startup-policy";

const testFixture: AppMapScenarioTest = {
  kind: "scenario",
  id: "checkout",
  organizationId: "org",
  projectId: "project",
  appMapId: "shop",
  name: "Checkout",
  intentSchemaVersion: 1,
  steps: [
    {
      id: "confirm",
      kind: "validation",
      intent: "Confirm the total",
      binding: { status: "unresolved", reason: "Fixture" },
    },
  ],
  createdAt: 1,
  updatedAt: 1,
};

const plan: AppMapCompiledTest = {
  schemaVersion: 1,
  appMapId: "shop",
  appMapRevision: 4,
  test: { id: "checkout", name: "Checkout", kind: "scenario", intentSchemaVersion: 1 },
  rootRecipeId: "app-map:shop:test:checkout:root:r4",
  performance: {
    executableOperations: 1,
    moduleCalls: 0,
    operationCounts: { sleep: 1 },
    screenshotCount: 0,
    destinationProofCount: 0,
  },
  startup: { mode: "cold" },
  recipes: {
    "app-map:shop:test:checkout:root:r4": {
      id: "app-map:shop:test:checkout:root:r4",
      title: "Checkout",
      parameters: [],
      steps: [{ id: "confirm-recipe", kind: "sleep", ms: 1 }],
    },
  },
  stepProvenance: [
    {
      recipeId: "app-map:shop:test:checkout:root:r4",
      stepIndex: 0,
      recipeStepId: "confirm-recipe",
      testId: "checkout",
      testStepId: "confirm",
      bindingKind: "assertion",
      referencedEntityIds: [],
    },
  ],
};

const failedRun: JobInfo = {
  id: "run-1",
  action: plan.rootRecipeId,
  status: "error",
  queuedAt: 1,
  startedAt: 2,
  finishedAt: 7,
  logs: [],
  error: "Expected $42, observed $41",
  failureCategory: "deterministic-assertion",
  steps: [
    {
      id: "trace-confirm",
      index: 0,
      kind: "sleep",
      tone: "danger",
      title: "Confirm",
      glyphs: [],
      startedAt: 2,
      finishedAt: 7,
      durationMs: 5,
      frames: [],
      log: "Mismatch",
      status: "error",
    },
  ],
};

test("results make the latest failure and exact authored step actionable", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const onSelectStep = vi.fn();
  const dispose = render(
    () => (
      <AppMapTestEvidencePanel
        test={testFixture}
        plan={plan}
        selectedStepId="confirm"
        run={failedRun}
        counts={{ frames: 0, events: 0, artifacts: 0 }}
        provenance={plan.stepProvenance}
        detailError=""
        devices={[]}
        frameUrl={() => ""}
        onSelectStep={onSelectStep}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Latest result");
  expect(root.textContent).toContain("Failed");
  expect(root.textContent).toContain("Failed at");
  expect(root.textContent).toContain("Confirm the total");
  expect(root.textContent).toContain("Expected $42, observed $41");
  expect(root.textContent).toContain("1/1");
  root.querySelector<HTMLButtonElement>("button")!.click();
  expect(onSelectStep).toHaveBeenCalledWith("confirm");

  dispose();
  document.body.replaceChildren();
});

test("nested provenance stays explicit when no nested runtime trace exists", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const nestedPlan: AppMapCompiledTest = {
    ...plan,
    recipes: {
      ...plan.recipes,
      branch: {
        id: "branch",
        title: "Branch",
        parameters: [],
        steps: [{ id: "nested-recipe", kind: "sleep", ms: 1 }],
      },
    },
    stepProvenance: [
      {
        ...plan.stepProvenance[0]!,
        recipeId: "branch",
        recipeStepId: "nested-recipe",
      },
    ],
  };
  const dispose = render(
    () => (
      <AppMapTestEvidencePanel
        test={testFixture}
        plan={nestedPlan}
        selectedStepId="confirm"
        run={failedRun}
        counts={{ frames: 0, events: 0, artifacts: 0 }}
        provenance={nestedPlan.stepProvenance}
        detailError=""
        devices={[]}
        frameUrl={() => ""}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Not observed");
  expect(root.textContent).toContain("no nested trace join");
  expect(root.textContent).toContain("0/0");

  dispose();
  document.body.replaceChildren();
});

test("compiled summary exposes the deterministic schedule proposal without implying it runs", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const scheduledPlan: AppMapCompiledTest = {
    ...plan,
    executionSchedule: {
      schemaVersion: 2,
      mode: "review-required",
      checks: [
        {
          checkId: "open-privacy",
          recipeId: "privacy",
          authoredIndex: 1,
          proposedIndex: 0,
          sourceScreenId: "settings",
          semanticDocumentOrder: 0,
          documentY: 180,
          disposition: "scheduled",
          reason: "reviewed-return-equivalence",
          returnToSource: {
            sourceScreenId: "settings",
            terminalScreenId: "privacy",
            kind: "back",
            connectionIds: ["settings-to-privacy"],
          },
        },
        {
          checkId: "open-help",
          recipeId: "help",
          authoredIndex: 0,
          proposedIndex: 1,
          sourceScreenId: "settings",
          disposition: "deferred",
          reason: "unknown-cursor",
        },
      ],
      deferredBranches: [
        {
          checkId: "open-help",
          recipeId: "review-cold-help",
          reason: "cold-reset-branch",
        },
      ],
    },
  };
  const dispose = render(
    () => (
      <AppMapTestEvidencePanel
        test={testFixture}
        plan={scheduledPlan}
        counts={{ frames: 0, events: 0, artifacts: 0 }}
        provenance={scheduledPlan.stepProvenance}
        detailError=""
        devices={[]}
        frameUrl={() => ""}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("Execution proposal");
  expect(root.textContent).toContain("Review required");
  expect(root.textContent).toContain("Reviewed return");
  expect(root.textContent).toContain("Needs source proof");
  expect(root.textContent).toContain("1 review-only recovery");
  expect(root.textContent).toContain("Saved Test order stays unchanged.");
  expect(root.querySelector("[data-app-map-schedule-check='open-privacy']")).not.toBeNull();

  dispose();
  document.body.replaceChildren();
});

test("compiled summary makes a verified checkpoint and its no-relaunch recovery rule explicit", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const warmPlan: AppMapCompiledTest = {
    ...plan,
    startup: { mode: "verified-checkpoint", screenId: "settings" },
  };
  const appMap = {
    screens: {
      settings: { id: "settings", title: "Settings" },
    },
  } satisfies AppMapTestStartupScreenSource;
  const dispose = render(
    () => (
      <AppMapTestEvidencePanel
        appMap={appMap}
        test={testFixture}
        plan={warmPlan}
        counts={{ frames: 0, events: 0, artifacts: 0 }}
        provenance={warmPlan.stepProvenance}
        detailError=""
        devices={[]}
        frameUrl={() => ""}
      />
    ),
    root,
  );

  expect(root.textContent).toContain("What ran · Verified checkpoint · Settings · map revision 4");
  expect(root.textContent).toContain("Relay first proves the live Settings (settings) checkpoint");
  expect(root.textContent).toContain(
    "never falls back to the cold prefix or relaunches to recover",
  );
  expect(root.textContent).toContain("A paused job resumes this exact plan");

  dispose();
  document.body.replaceChildren();
});

test("latest result row opens the exact run with pointer or keyboard semantics", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const onOpenRun = vi.fn();
  const dispose = render(
    () => (
      <AppMapTestEvidencePanel
        test={testFixture}
        plan={plan}
        run={failedRun}
        counts={{ frames: 0, events: 0, artifacts: 0 }}
        provenance={plan.stepProvenance}
        detailError=""
        devices={[]}
        frameUrl={() => ""}
        onOpenRun={onOpenRun}
      />
    ),
    root,
  );

  const row = root.querySelector<HTMLButtonElement>("[data-test-result-row='run-1']")!;
  expect(row).not.toBeNull();
  expect(row.getAttribute("aria-label")).toContain("Failed");
  row.click();
  expect(onOpenRun).toHaveBeenCalledWith("run-1");

  dispose();
  document.body.replaceChildren();
});
