import { describe, expect, it } from "vitest";
import { layeredMapLayout } from "./map-layered-layout";

const size = { width: 200, height: 300, columnGap: 200, rowGap: 60 };
const edges = (...pairs: string[]) =>
  pairs.map((pair) => {
    const [from, to] = pair.split(">");
    return { from: from!, to: to! };
  });

function overlaps(points: Map<string, { x: number; y: number }>) {
  const list = [...points.values()];
  return list.some((a, i) =>
    list.some(
      (b, j) => i < j && Math.abs(a.x - b.x) < size.width && Math.abs(a.y - b.y) < size.height,
    ),
  );
}

describe("layered map layout", () => {
  it("puts screens in columns by distance from the entry", () => {
    const points = layeredMapLayout(
      ["home", "a", "b", "deep"],
      edges("home>a", "home>b", "a>deep"),
      {
        ...size,
        roots: ["home"],
      },
    );
    const column = (id: string) => points.get(id)!.x / 400;
    expect([column("home"), column("a"), column("b"), column("deep")]).toEqual([0, 1, 1, 2]);
    expect(overlaps(points)).toBe(false);
  });

  it("places every screen once through cycles, returns, and disconnected screens", () => {
    const ids = ["home", "a", "b", "alone"];
    const points = layeredMapLayout(ids, edges("home>a", "a>b", "b>home", "b>a"), {
      ...size,
      roots: ["home"],
    });
    expect([...points.keys()].sort()).toEqual([...ids].sort());
    expect(overlaps(points)).toBe(false);
    // A screen no path reaches sits below the flow instead of inside it.
    expect(points.get("alone")!.y).toBeGreaterThan(points.get("b")!.y);
  });

  it("reserves a gap for a connection that skips a column", () => {
    const points = layeredMapLayout(
      ["home", "a", "b", "c", "far"],
      edges("home>a", "home>b", "home>c", "a>far", "home>far"),
      { ...size, roots: ["home"] },
    );
    const middle = ["a", "b", "c"].map((id) => points.get(id)!.y).sort((x, y) => x - y);
    const gaps = middle.slice(1).map((y, index) => y - middle[index]! - size.height);
    // The home→far connection needs one gap wider than an ordinary row gap,
    // or room above or below the column.
    const roomy =
      gaps.some((gap) => gap > size.rowGap) ||
      points.get("far")!.y + size.height / 2 < middle[0]! ||
      points.get("far")!.y + size.height / 2 > middle.at(-1)! + size.height;
    expect(roomy).toBe(true);
  });

  it("orders columns so independent branches do not cross", () => {
    // a→d and b→c would cross if the second column kept discovery order.
    const points = layeredMapLayout(
      ["root", "a", "b", "c", "d"],
      edges("root>a", "root>b", "b>c", "a>d"),
      { ...size, roots: ["root"] },
    );
    const aAbove = points.get("a")!.y < points.get("b")!.y;
    const dAbove = points.get("d")!.y < points.get("c")!.y;
    expect(aAbove).toBe(dAbove);
  });
});
