import assert from "node:assert/strict";
import test from "node:test";
import {
  COMPONENT_SOURCE_LIMIT,
  DEFAULT_SOURCE_LIMIT,
  SCRIPT_SOURCE_LIMIT,
  evaluateProductDocumentBoundaries,
  evaluateSourceBudgets,
  sourceLineCount,
} from "./check-source-budgets.mjs";

test("counts source lines without treating the final newline as a module", () => {
  assert.equal(sourceLineCount("one\ntwo\n"), 2);
  assert.equal(sourceLineCount(""), 0);
});

test("renderer observation sessions cannot become a second editable graph", () => {
  assert.deepEqual(
    evaluateProductDocumentBoundaries([
      {
        path: "packages/app/src/lib/parallel-import.ts",
        lines: 3,
        source:
          "import type { DiscoverySession } from '@relay/protocol';\nimport type { CanvasGraph } from './canvas';\nexport function importDiscoveryAppMap() {}",
      },
    ]),
    [
      "packages/app/src/lib/parallel-import.ts mixes observation-session and App Map document types; project observations through a core review proposal instead.",
      "packages/app/src/lib/parallel-import.ts recreates the removed Discovery-to-canvas authoring path; App Map is the only editable document.",
    ],
  );
  assert.deepEqual(
    evaluateProductDocumentBoundaries([
      {
        path: "packages/app/src/components/fixture-results.tsx",
        lines: 1,
        source: "import type { FixtureSession } from '@relay/protocol';",
      },
      {
        path: "packages/core/src/app-map/observation-proposal.ts",
        lines: 1,
        source: "import type { DiscoverySession, AppMap } from '@relay/protocol';",
      },
    ]),
    [],
  );
});

test("rejects new component, source, and script monoliths at their respective limits", () => {
  assert.deepEqual(
    evaluateSourceBudgets(
      [
        { path: "packages/app/src/components/new-panel.tsx", lines: COMPONENT_SOURCE_LIMIT + 1 },
        { path: "packages/core/src/new-domain.ts", lines: DEFAULT_SOURCE_LIMIT + 1 },
        { path: "scripts/new-tool.mjs", lines: SCRIPT_SOURCE_LIMIT + 1 },
        { path: "packages/app/scripts/new-tool.mts", lines: SCRIPT_SOURCE_LIMIT + 1 },
      ],
      {},
    ),
    [
      `packages/app/src/components/new-panel.tsx has ${COMPONENT_SOURCE_LIMIT + 1} lines; split it below the ${COMPONENT_SOURCE_LIMIT}-line component limit.`,
      `packages/core/src/new-domain.ts has ${DEFAULT_SOURCE_LIMIT + 1} lines; split it below the ${DEFAULT_SOURCE_LIMIT}-line source limit.`,
      `scripts/new-tool.mjs has ${SCRIPT_SOURCE_LIMIT + 1} lines; split it below the ${SCRIPT_SOURCE_LIMIT}-line script module limit.`,
      `packages/app/scripts/new-tool.mts has ${SCRIPT_SOURCE_LIMIT + 1} lines; split it below the ${SCRIPT_SOURCE_LIMIT}-line script module limit.`,
    ],
  );
});

test("grandfathered modules can neither grow nor shrink without ratcheting the ceiling", () => {
  const path = "packages/core/src/legacy.ts";
  assert.equal(evaluateSourceBudgets([{ path, lines: 1_000 }], { [path]: 1_000 }).length, 0);
  assert.match(
    evaluateSourceBudgets([{ path, lines: 1_001 }], { [path]: 1_000 })[0] ?? "",
    /grew/u,
  );
  assert.match(
    evaluateSourceBudgets([{ path, lines: 999 }], { [path]: 1_000 })[0] ?? "",
    /lower its grandfathered ceiling/u,
  );
});

test("stale exceptions are removed once their file or exceptional size disappears", () => {
  const path = "packages/app/src/components/old-panel.tsx";
  assert.deepEqual(evaluateSourceBudgets([], { [path]: 800 }), [
    `${path} no longer exists; remove its grandfathered exception.`,
  ]);
  assert.match(
    evaluateSourceBudgets([{ path, lines: COMPONENT_SOURCE_LIMIT }], { [path]: 800 }).join(" "),
    /remove its grandfathered exception/u,
  );
});
