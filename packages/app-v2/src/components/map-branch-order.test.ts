import { expect, it } from "vitest";
import { orderMapBranches } from "./map-branch-order";
const paths = [4, 1, 3, 0, 5, 2].map((i) => ({
  id: String(i),
  fromScreenId: "source",
  fromTitle: "Source",
  toScreenId: `screen-${i}`,
  label: `Control ${i}`,
  coveringTests: [],
  sourceAnchor: { point: { x: 0.5, y: i / 6 } },
}));
it("orders vertical branches by control position rather than creation order", () => {
  expect(orderMapBranches(paths, false).map((p) => p.id)).toEqual(["0", "1", "2", "3", "4", "5"]);
});
it("puts upper controls on the outside of horizontal branches", () => {
  const ordered = orderMapBranches(paths, true);
  expect(ordered.map((p) => p.id)).toEqual(["0", "2", "4", "5", "3", "1"]);
  for (const side of [ordered.slice(0, 3), ordered.slice(3).reverse()])
    for (let i = 1; i < side.length; i++)
      expect(side[i]!.sourceAnchor!.point.y).toBeGreaterThan(side[i - 1]!.sourceAnchor!.point.y);
});
it("preserves recorded order when any control position is unknown", () => {
  const incomplete = paths.map((p, i) => (i === 0 ? { ...p, sourceAnchor: undefined } : p));
  expect(orderMapBranches(incomplete, true)).toEqual(incomplete);
  expect(paths.map((p) => p.id)).toEqual(["4", "1", "3", "0", "5", "2"]);
});
