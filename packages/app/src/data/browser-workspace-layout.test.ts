import { describe, expect, it } from "vitest";
import {
  browserDockSide,
  arrangeBrowsers,
  neighboringBrowser,
  browserLayoutGeometry,
  defaultBrowserLayout,
  dockBrowser,
  dockBrowserToEdge,
  reorderBrowserLayout,
  resizeBrowserSplit,
  restoreBrowserLayout,
  type DockSide,
} from "./browser-workspace-layout";
import { parseBrowserWorkspace } from "./browser-workspace-state";

const ids = ["Admin", "Member", "Guest", "Reviewer"];
describe("directional browser docking", () => {
  it.each(["left", "right", "top", "bottom"] as DockSide[])(
    "docks %s without losing or duplicating profiles",
    (side) => {
      const layout = dockBrowser(defaultBrowserLayout(ids)!, "Guest", "Member", side);
      const { tiles, splits } = browserLayoutGeometry(layout);
      expect(Object.keys(tiles).sort()).toEqual([...ids].sort());
      const source = tiles.Guest!,
        target = tiles.Member!;
      if (side === "left") expect(source.x + source.width).toBe(target.x);
      if (side === "right") expect(target.x + target.width).toBe(source.x);
      if (side === "top") expect(source.y + source.height).toBe(target.y);
      if (side === "bottom") expect(target.y + target.height).toBe(source.y);
      expect(
        Object.values(tiles).reduce((area, rect) => area + rect.width * rect.height, 0),
      ).toBeCloseTo(10000);
      expect(splits).toHaveLength(3);
      for (const [a, first] of Object.entries(tiles))
        for (const [b, second] of Object.entries(tiles)) {
          if (a === b) continue;
          const overlap =
            Math.max(
              0,
              Math.min(first.x + first.width, second.x + second.width) -
                Math.max(first.x, second.x),
            ) *
            Math.max(
              0,
              Math.min(first.y + first.height, second.y + second.height) -
                Math.max(first.y, second.y),
            );
          expect(overlap).toBe(0);
        }
    },
  );
  it("supports independently resized nested vertical and horizontal splits", () => {
    let layout = dockBrowser(
      defaultBrowserLayout(["Admin", "Member", "Guest"])!,
      "Guest",
      "Admin",
      "bottom",
    );
    layout = resizeBrowserSplit(resizeBrowserSplit(layout, "", 60), "0", 35);
    expect(browserLayoutGeometry(layout).tiles).toEqual({
      Admin: { x: 0, y: 0, width: 60, height: 35 },
      Guest: { x: 0, y: 35, width: 60, height: 65 },
      Member: { x: 60, y: 0, width: 40, height: 100 },
    });
    const reordered = reorderBrowserLayout(
      layout,
      ["Admin", "Member", "Guest"],
      ["Member", "Admin", "Guest"],
    );
    expect(browserLayoutGeometry(reordered).tiles.Member).toEqual(
      browserLayoutGeometry(layout).tiles.Admin,
    );
  });
  it("restores saved splits, prunes removed tiles, and upgrades the old workspace", () => {
    const tiles = ids.map((id) => ({
      id,
      browserId: id,
      name: id,
      accountName: "Current session",
    }));
    const legacy = parseBrowserWorkspace(JSON.stringify(tiles));
    const layout = dockBrowser(legacy.layout!, "Guest", "Member", "top");
    const restored = parseBrowserWorkspace(JSON.stringify({ version: 2, tiles, layout }));
    expect(restored).toEqual({ version: 2, tiles, layout });
    expect(
      Object.keys(
        browserLayoutGeometry(restoreBrowserLayout(layout, ["Admin", "Guest"])).tiles,
      ).sort(),
    ).toEqual(["Admin", "Guest"]);
    expect(() => parseBrowserWorkspace('{"version":2}')).toThrow();
    expect(
      restoreBrowserLayout({ axis: "vertical", ratio: -100, first: "Admin", second: "Admin" }, ids),
    ).toBeDefined();
    expect(
      Object.keys(
        browserLayoutGeometry(
          restoreBrowserLayout(
            { axis: "vertical", ratio: -100, first: "Admin", second: "Admin" },
            ids,
          ),
        ).tiles,
      ),
    ).toHaveLength(4);
  });
  it("docks to a full workspace edge instead of forcing another nested split", () => {
    for (const side of ["left", "right", "top", "bottom"] as const) {
      const layout = dockBrowserToEdge(defaultBrowserLayout(ids)!, "Guest", side);
      const { tiles } = browserLayoutGeometry(layout);
      expect(Object.keys(tiles).sort()).toEqual([...ids].sort());
      expect(side === "left" || side === "right" ? tiles.Guest!.height : tiles.Guest!.width).toBe(
        100,
      );
      expect(restoreBrowserLayout(layout, ids)).toEqual(layout);
    }
  });
  it("balances presets and follows visible neighbors rather than fixed array offsets", () => {
    const columns = arrangeBrowsers(ids, "columns")!;
    expect(
      Object.values(browserLayoutGeometry(columns).tiles).every(
        (rect) => rect.width === 25 && rect.height === 100,
      ),
    ).toBe(true);
    expect(neighboringBrowser(columns, "Member", "right")).toBe("Guest");
    expect(neighboringBrowser(columns, "Member", "top")).toBeUndefined();
    const rows = arrangeBrowsers(ids, "rows")!;
    expect(
      Object.values(browserLayoutGeometry(rows).tiles).every(
        (rect) => rect.height === 25 && rect.width === 100,
      ),
    ).toBe(true);
    expect(neighboringBrowser(rows, "Member", "bottom")).toBe("Guest");
    expect(neighboringBrowser(rows, "Member", "left")).toBeUndefined();
    expect(
      Object.keys(browserLayoutGeometry(arrangeBrowsers(ids.slice(0, 3), "columns")).tiles),
    ).toHaveLength(3);
  });
  it("uses all four edges even for very wide or tall targets", () => {
    expect(browserDockSide(500, 2, 1000, 100)).toBe("top");
    expect(browserDockSide(500, 98, 1000, 100)).toBe("bottom");
    expect(browserDockSide(2, 500, 100, 1000)).toBe("left");
    expect(browserDockSide(98, 500, 100, 1000)).toBe("right");
    const layout = defaultBrowserLayout(ids)!;
    expect(dockBrowser(layout, "Admin", "Admin", "top")).toBe(layout);
    expect(dockBrowser(layout, "missing", "Admin", "top")).toBe(layout);
  });
});
