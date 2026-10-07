import assert from "node:assert/strict";
import test from "node:test";
import type { AppMapCompiledTest, RecipeStep } from "@relay/protocol";
import { preflightCompiledAppMapTestOffline } from "./offline-test-preflight.js";

function plan(
  steps: RecipeStep[],
  observations?: Extract<RecipeStep, { kind: "expect-screen" }>["observations"],
): AppMapCompiledTest {
  return {
    schemaVersion: 1,
    appMapId: "chat",
    appMapRevision: 1,
    test: { id: "response", name: "Completed response", kind: "scenario", intentSchemaVersion: 1 },
    rootRecipeId: "root",
    recipes: {
      root: {
        id: "root",
        title: "Root",
        parameters: [],
        steps: [
          {
            kind: "expect-screen",
            screenId: "home",
            screenTitle: "Home",
            fingerprint: "home",
            ...(observations ? { observations } : {}),
          },
          ...steps,
        ],
      },
    },
    stepProvenance: [],
    performance: {
      executableOperations: 0,
      moduleCalls: 0,
      operationCounts: {},
      screenshotCount: 0,
      destinationProofCount: 0,
    },
    startup: { mode: "cold" },
  };
}

const gone: RecipeStep = {
  id: "idle",
  kind: "expect",
  target: { label: "Stop message" },
  condition: "gone",
  timeoutMs: 900_000,
};
const source = {
  reference: "relay-evidence://completed-response",
  evidenceId: "completed-response",
  sha256: "a".repeat(64),
};
const other = {
  role: "button",
  label: "Send",
  hittable: true,
  rect: { x: 10, y: 10, width: 30, height: 30 },
};
const stop = {
  role: "textview",
  label: "Stop message",
  enabled: false,
  hittable: false,
  rect: { x: 50, y: 10, width: 30, height: 30 },
};

test("gone accepts raw observed absence while preserving the runtime check and positive selector blocker", () => {
  const compiled = plan([gone, { id: "tap-stop", kind: "tap", target: { label: "Stop message" } }]);
  const before = structuredClone(compiled);
  const report = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: { home: [{ source, nodes: [other] }] },
  });
  assert.equal(
    report.selectors.find((selector) => selector.recipeStepId === "idle")?.status,
    "resolved",
  );
  assert.deepEqual(
    report.findings
      .filter((finding) => finding.code === "selector-absent")
      .map((finding) => finding.recipeStepId),
    ["tap-stop"],
  );
  assert.equal(report.summary.blockers, 1);
  assert.deepEqual(compiled, before, "offline assessment never removes or weakens the wait");
});

test("gone present unique content remains a runtime check; duplicated candidates fail closed", () => {
  const compiled = plan([gone]);
  const unique = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: { home: [{ source, nodes: [stop] }] },
  });
  assert.equal(unique.summary.blockers, 0, "presence does not require an activatable control");
  assert.equal(unique.selectors[0]?.status, "resolved");
  const ambiguous = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: {
      home: [{ source, nodes: [stop, { ...stop, rect: { ...stop.rect, y: 90 } }] }],
    },
  });
  assert.ok(
    ambiguous.findings.some(
      (finding) => finding.code === "selector-ambiguous" && finding.severity === "blocker",
    ),
  );
});

test("gone uses normalized evidence only when no immutable raw capture was declared", () => {
  const compiled = plan([gone], [{ fingerprint: "home", nodes: [other], volatileSignals: [] }]);
  const absent = preflightCompiledAppMapTestOffline(compiled);
  assert.equal(absent.summary.blockers, 0);
  assert.equal(absent.selectors[0]?.status, "resolved");
  const unreadable = preflightCompiledAppMapTestOffline(compiled, {
    rawSourcesByScreenId: { home: [{ source }] },
  });
  assert.equal(unreadable.selectors[0]?.status, "raw-evidence-unavailable");
  assert.ok(unreadable.summary.blockers > 0);
  const ambiguous = preflightCompiledAppMapTestOffline(
    plan([gone], [{ fingerprint: "home", nodes: [stop, stop], volatileSignals: [] }]),
  );
  assert.ok(
    ambiguous.findings.some(
      (finding) => finding.code === "selector-ambiguous" && finding.severity === "blocker",
    ),
  );
});
