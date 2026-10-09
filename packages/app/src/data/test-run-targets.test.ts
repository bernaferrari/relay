import { expect, it } from "vitest";
import type { ProductTestEditorDocument } from "./test-editor-product-service";
import { recordedTestRunPlatforms } from "./test-run-targets";

function document(
  test: Partial<ProductTestEditorDocument["test"]> = {},
  recordedPlatforms?: ProductTestEditorDocument["recordedPlatforms"],
): ProductTestEditorDocument {
  return {
    appMapId: "app",
    appName: "App",
    revision: 1,
    savedPaths: [],
    history: [],
    repairs: [],
    test: {
      id: "test",
      organizationId: "local",
      projectId: "default",
      appMapId: "app",
      name: "Test",
      kind: "scenario",
      intentSchemaVersion: 1,
      steps: [],
      createdAt: 1,
      updatedAt: 1,
      ...test,
    },
    recordedPlatforms,
  };
}

it("keeps legacy tests with unknown platforms discoverable", () => {
  expect(recordedTestRunPlatforms(document())).toBeUndefined();
  expect(recordedTestRunPlatforms(null)).toBeUndefined();
});

it("scopes native captures and website origins to their recorded platform", () => {
  expect(recordedTestRunPlatforms(document({}, ["android"]))).toEqual(["android"]);
  expect(recordedTestRunPlatforms(document({ originApplication: "https://example.com" }))).toEqual([
    "browser",
  ]);
  expect(recordedTestRunPlatforms(document(), "ios")).toEqual(["ios"]);
});

it("uses reviewed family routes without making a linked companion runnable here", () => {
  expect(
    recordedTestRunPlatforms(
      document(
        {
          family: {
            logicalIntentRevision: 1,
            bindingRevision: 1,
            routeVariants: [
              {
                id: "android",
                revision: 1,
                predicate: { platforms: ["android"] },
                bindings: {},
                reviewedAt: 1,
                reviewedBy: "reviewer",
              },
            ],
          },
          nativeRouteCompanions: [{ platform: "ios", appMapId: "other", testId: "other-test" }],
        },
        ["browser"],
      ),
    ),
  ).toEqual(["android"]);
});

it("does not guess a destination for an explicitly empty route family", () => {
  expect(
    recordedTestRunPlatforms(
      document({
        family: { logicalIntentRevision: 1, bindingRevision: 1, routeVariants: [] },
      }),
    ),
  ).toEqual([]);
});
