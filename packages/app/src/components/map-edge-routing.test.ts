import { describe, expect, it } from "vitest";
import { arrowHead, freeGapY, roundedPath, routeElbows } from "./map-edge-routing";

describe("map edge routing", () => {
  it("passes a skipped column through the nearest free gap", () => {
    const column = [
      { x: 400, y: 0, width: 200, height: 300 },
      { x: 400, y: 400, width: 200, height: 300 },
    ];
    expect(freeGapY(column, 330)).toBe(330);
    expect(freeGapY(column, 305)).toBe(350);
    expect(freeGapY(column, 900)).toBe(900);
    expect(freeGapY(column, 120)).toBe(-24);
  });

  it("gives every connection in a gutter its own lane", () => {
    const routes = routeElbows(
      [
        { id: "a", start: { x: 210, y: 100 }, end: { x: 390, y: 50 } },
        { id: "b", start: { x: 210, y: 150 }, end: { x: 390, y: 400 } },
        { id: "c", start: { x: 210, y: 200 }, end: { x: 390, y: 600 } },
        { id: "straight", start: { x: 210, y: 250 }, end: { x: 390, y: 250 } },
      ],
      new Map([
        [0, [{ x: 0, y: 0, width: 200, height: 300 }]],
        [400, [{ x: 400, y: 0, width: 200, height: 700 }]],
      ]),
      200,
    );
    const lane = (id: string) => routes.get(id)![1]!.x;
    expect(new Set(["a", "b", "c"].map(lane)).size).toBe(3);
    // Downward runs: the higher one takes the lane further right, so b and c never cross.
    expect(lane("b")).toBeGreaterThan(lane("c"));
    expect(routes.get("straight")).toEqual([
      { x: 210, y: 250 },
      { x: 390, y: 250 },
    ]);
  });

  it("routes around the cards of a skipped column", () => {
    const routes = routeElbows(
      [{ id: "long", start: { x: 210, y: 150 }, end: { x: 790, y: 150 } }],
      new Map([
        [0, [{ x: 0, y: 0, width: 200, height: 300 }]],
        [
          400,
          [
            { x: 400, y: 0, width: 200, height: 300 },
            { x: 400, y: 380, width: 200, height: 300 },
          ],
        ],
        [800, [{ x: 800, y: 0, width: 200, height: 300 }]],
      ]),
      200,
    );
    const crossing = routes.get("long")!.filter((point) => point.x >= 390 && point.x <= 610);
    for (const point of crossing) expect(point.y === -24 || point.y === 340).toBe(true);
  });

  it("draws rounded elbows and a chevron whose tip is the end of the line", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 50, y: 80 },
      { x: 100, y: 80 },
    ];
    expect(roundedPath(points)).toContain(" Q 50 0 ");
    const head = arrowHead(points);
    expect(head).toMatch(/L 100 80 L/);
  });
});
