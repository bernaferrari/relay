import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap, AppMapVariable } from "@relay/protocol";
import {
  RepeatSpecResolutionError,
  resolveRepeatSpec,
  resolvedRepeatSelection,
} from "./repeat-spec.js";

function variable(id: string, options: string[]): AppMapVariable {
  return {
    id,
    organizationId: "org",
    projectId: "project",
    appMapId: "map",
    name: id,
    kind: id === "language" ? "language" : "custom",
    apply: { kind: "appLocale", app: "com.example" },
    options: options.map((value) => ({ id: value })),
    createdAt: 1,
    updatedAt: 1,
  };
}

function map(): AppMap {
  return {
    id: "map",
    revision: 7,
    variables: {
      language: variable("language", ["en", "pt-BR"]),
      theme: variable("theme", ["light", "dark"]),
    },
  } as unknown as AppMap;
}

test("RepeatSpec resolves all and supported from canonical saved ids in ordered dimensions", () => {
  const resolved = resolveRepeatSpec(map(), {
    dimensions: [
      { id: "theme", values: "all" },
      { id: "language", values: "supported" },
    ],
    strategy: "pairwise",
    pilot: { mode: "specified", case: { theme: "dark", language: "pt-BR" } },
    resume: "untouched",
  });

  assert.deepEqual(resolved, {
    dimensions: [
      { id: "theme", valueIds: ["light", "dark"] },
      { id: "language", valueIds: ["en", "pt-BR"] },
    ],
    strategy: "pairwise",
    pilot: { mode: "specified", case: { theme: "dark", language: "pt-BR" } },
    resume: "untouched",
  });
  assert.deepEqual(resolvedRepeatSelection(resolved), {
    theme: ["light", "dark"],
    language: ["en", "pt-BR"],
  });
});

test("RepeatSpec fails closed before execution on unknown dimensions, values, and pilot tuples", () => {
  const cases = [
    {
      spec: { dimensions: [{ id: "device", values: "supported" as const }] },
      code: "REPEAT_DIMENSION_NOT_FOUND",
    },
    {
      spec: { dimensions: [{ id: "language", values: ["missing"] }] },
      code: "REPEAT_VALUE_NOT_FOUND",
    },
    {
      spec: {
        dimensions: [{ id: "language", values: ["en"] }],
        pilot: { mode: "specified" as const, case: { language: "pt-BR" } },
      },
      code: "REPEAT_PILOT_CASE_INVALID",
    },
  ];
  for (const item of cases) {
    assert.throws(
      () => resolveRepeatSpec(map(), item.spec),
      (error: unknown) => error instanceof RepeatSpecResolutionError && error.code === item.code,
    );
  }
});

test("failed and all resume modes are structured pre-dispatch blockers", () => {
  for (const resume of ["failed", "all"] as const) {
    assert.throws(
      () =>
        resolveRepeatSpec(map(), {
          dimensions: [{ id: "language", values: ["en"] }],
          resume,
        }),
      (error: unknown) =>
        error instanceof RepeatSpecResolutionError &&
        error.code === "REPEAT_RESUME_MODE_UNAVAILABLE",
    );
  }
});
