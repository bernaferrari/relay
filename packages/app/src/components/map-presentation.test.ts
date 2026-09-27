import { expect, it } from "vitest";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { compactMap } from "./map-presentation";

const screens: ProductMapScreen[] = ["home", "draft", "conversation"].map((id) => ({
  id,
  title: id,
  variants: [],
  variantCount: 0,
  coveringTests: [],
  recentFailures: [],
}));
const paths: ProductMapPath[] = [
  {
    id: "type",
    fromScreenId: "home",
    toScreenId: "draft",
    fromTitle: "Home",
    toTitle: "Draft",
    label: "Enter text",
    actionKinds: ["wait-for", "type"],
    coveringTests: [],
  },
  {
    id: "send",
    fromScreenId: "draft",
    toScreenId: "conversation",
    fromTitle: "Draft",
    toTitle: "Conversation",
    label: "Submit",
    actionKinds: ["tap"],
    coveringTests: [],
  },
];

it("folds a typed draft into an ordered connection without mutating the saved map", () => {
  const result = compactMap(screens, paths);
  expect(result.screens.map((screen) => screen.id)).toEqual(["home", "conversation"]);
  expect(result.paths).toHaveLength(1);
  expect(result.paths[0]).toMatchObject({
    fromScreenId: "home",
    toScreenId: "conversation",
    label: "Enter text → Submit",
    intermediateScreens: [screens[1]],
  });
  expect(paths[0]?.toScreenId).toBe("draft");
  expect(screens).toHaveLength(3);
});

it("preserves branches, unrecorded exits, loops, failures and deep-linked evidence", () => {
  const failedScreens = screens.map((screen) =>
    screen.id === "draft"
      ? {
          ...screen,
          recentFailures: [{ id: "failure", outcome: "product-failure" as const, runId: "run" }],
        }
      : screen,
  );
  expect(compactMap(failedScreens, paths).screens).toHaveLength(3);
  const branch = { ...paths[1]!, id: "other", toScreenId: undefined };
  expect(compactMap(screens, [...paths, branch]).screens).toHaveLength(3);
  expect(
    compactMap(screens, [paths[0]!, { ...paths[1]!, toScreenId: "home" }]).screens,
  ).toHaveLength(3);
  expect(compactMap(screens, paths, "draft").screens).toHaveLength(3);
  expect(compactMap(screens, paths, undefined, "send").screens).toHaveLength(3);
  expect(
    compactMap(screens, [{ ...paths[0]!, actionKinds: ["tap"] }, paths[1]!]).screens,
  ).toHaveLength(3);
  expect(
    compactMap(screens, [{ ...paths[0]!, actionKinds: undefined }, paths[1]!]).screens,
  ).toHaveLength(3);
});
