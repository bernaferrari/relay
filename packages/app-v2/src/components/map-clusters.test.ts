import { describe, expect, it } from "vitest";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { PORTRAIT_NODE } from "./map-canvas-geometry";
import { mapClusters } from "./map-clusters";

const screen = (id: string): ProductMapScreen => ({
  id,
  title: id.toUpperCase(),
  variantCount: 0,
  variants: [],
  coveringTests: [],
  recentFailures: [],
});
const path = (from: string, to?: string): ProductMapPath => ({
  id: `${from}-${to ?? "?"}`,
  label: "Go",
  fromScreenId: from,
  fromTitle: from,
  coveringTests: [],
  ...(to ? { toScreenId: to, toTitle: to } : {}),
});

describe("mapClusters", () => {
  it("groups connected screens, names the entry, and skips loose screens", () => {
    const positions = new Map([
      ["home", { x: 0, y: 0 }],
      ["settings", { x: 400, y: 0 }],
      ["about", { x: 800, y: 0 }],
      ["loose", { x: 0, y: 900 }],
    ]);
    const clusters = mapClusters(
      ["home", "settings", "about", "loose"].map(screen),
      [path("home", "settings"), path("settings", "about"), path("about", "home"), path("loose")],
      positions,
      PORTRAIT_NODE,
      10,
    );
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.screenIds.sort()).toEqual(["about", "home", "settings"]);
    expect(clusters[0]!.bounds).toEqual({ minX: -10, minY: -10, maxX: 1018, maxY: 378 });
  });

  it("names the screen nothing inside leads to", () => {
    const clusters = mapClusters(
      ["b", "a"].map(screen),
      [path("a", "b")],
      new Map([
        ["a", { x: 0, y: 0 }],
        ["b", { x: 300, y: 0 }],
      ]),
      PORTRAIT_NODE,
    );
    expect(clusters[0]!.entryTitle).toBe("A");
  });
});
