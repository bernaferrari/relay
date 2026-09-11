import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { MapEdges, roundedConnector, returnConnector, quadraticReturn } from "./map-edges";

it("labels an unrecorded destination instead of drawing a dangling arrow", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      paths={[
        {
          id: "send",
          label: "Send QA prompt",
          fromScreenId: "home",
          fromTitle: "Home",
          coveringTests: [],
        },
      ]}
      positions={new Map([["home", { x: 0, y: 0 }]])}
      screens={[{ id: "home" }]}
      imageDimensions={new Map()}
      markerId="arrow"
    />,
  );
  expect(markup).toContain("Destination not recorded");
  expect(markup).not.toContain("marker-end=");
  expect(markup).toContain("Send QA prompt");
});

it("keeps straight connections straight and rounds right-angle bends", () => {
  expect(
    roundedConnector([
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 0 },
    ]),
  ).not.toContain("Q");
  const bent = roundedConnector([
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 50, y: 100 },
    { x: 100, y: 100 },
  ]);
  expect(bent).toContain("Q 50 0");
  expect(bent).not.toContain("NaN");
});

it("starts a connection at its recorded click and paints a directional target", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      paths={[
        {
          id: "tap",
          label: "Open",
          fromScreenId: "home",
          toScreenId: "next",
          fromTitle: "Home",
          coveringTests: [],
          sourceAnchor: { point: { x: 0.25, y: 0.5 } },
        },
      ]}
      positions={
        new Map([
          ["home", { x: 0, y: 0 }],
          ["next", { x: 420, y: 0 }],
        ])
      }
      screens={[{ id: "home", screenshotUri: "home.png" }, { id: "next" }]}
      imageDimensions={new Map([["home", { width: 208, height: 300 }]])}
      markerId="click-arrow"
      showInteractionTargets
    />,
  );
  expect(markup).toContain("M 52 198");
  expect(markup).toContain("translate(52 198) rotate(0)");
  expect(markup).toContain("M 0 -5 A 5 5 0 1 0 0 5 L 7 0 Z");
});

it("leaves breathing room at both preview edges", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      paths={[
        {
          id: "next",
          label: "Continue",
          fromScreenId: "a",
          toScreenId: "b",
          fromTitle: "A",
          coveringTests: [],
        },
      ]}
      positions={
        new Map([
          ["a", { x: 0, y: 0 }],
          ["b", { x: 420, y: 0 }],
        ])
      }
      screens={[
        { id: "a", screenshotUri: "a.png" },
        { id: "b", screenshotUri: "b.png" },
      ]}
      imageDimensions={
        new Map([
          ["a", { width: 208, height: 300 }],
          ["b", { width: 208, height: 300 }],
        ])
      }
      markerId="gap"
    />,
  );
  expect(markup).toContain("M 222 198");
  expect(markup).toContain("L 406 198");
});

it("routes same-row returns below previews with a separate bottom landing", () => {
  const source = { x: 420, y: 48, width: 208, height: 300 };
  const target = { x: 0, y: 48, width: 208, height: 300 };
  const route = returnConnector(source, target);
  expect(route.points[0]).toEqual({ x: 555.2, y: 362 });
  expect(route.points.at(-1)).toEqual({ x: 72.8, y: 362 });
  expect(route.points.every((p) => p.y > 348)).toBe(true);
  expect(route.label.y).toBeGreaterThan(348);
});

it("routes lower branch returns directly to distinct bottom ports", () => {
  const source = { x: 420, y: 484, width: 208, height: 300 };
  const target = { x: 0, y: 48, width: 208, height: 300 };
  const a = returnConnector(source, target, 0, 2);
  const b = returnConnector(source, target, 1, 2);
  expect(a.points.every((p) => p.y > target.y + target.height)).toBe(true);
  expect(a.points.at(-1)?.x).not.toBe(b.points.at(-1)?.x);
  expect(a.label).not.toEqual(b.label);
  expect(roundedConnector(a.points)).not.toContain("NaN");
});

it("uses one quadratic curve for a revealed back route", () => {
  const d = quadraticReturn([
    { x: 400, y: 362 },
    { x: 100, y: 362 },
  ]);
  expect(d).toBe("M 400 362 Q 250 434 100 362");
  expect(d).not.toContain("C");
  expect(d).not.toContain("L");
});

it("orders destination exits across different sources sharing a corridor", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      paths={[
        {
          id: "one",
          fromScreenId: "a",
          fromTitle: "A",
          toScreenId: "c",
          label: "One",
          coveringTests: [],
        },
        {
          id: "two",
          fromScreenId: "b",
          fromTitle: "B",
          toScreenId: "d",
          label: "Two",
          coveringTests: [],
        },
      ]}
      positions={
        new Map([
          ["a", { x: 0, y: 0 }],
          ["b", { x: 0, y: 428 }],
          ["c", { x: 600, y: 1000 }],
          ["d", { x: 600, y: 1428 }],
        ])
      }
      screens={[{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }]}
      imageDimensions={new Map()}
      markerId="ordered"
    />,
  );
  const first = markup.match(/id="-0" d="([^"]+)"/)![1]!;
  const second = markup.match(/id="-1" d="([^"]+)"/)![1]!;
  const firstLane = Number(first.match(/Q ([\d.]+)/)![1]);
  const secondLane = Number(second.match(/Q ([\d.]+)/)![1]);
  expect(firstLane).toBeGreaterThan(secondLane);
});

it("uses separated bottom and top ports for horizontal branches", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      horizontal
      paths={[
        {
          id: "next",
          label: "Next",
          fromScreenId: "a",
          toScreenId: "b",
          fromTitle: "A",
          toTitle: "B",
          coveringTests: [],
        },
      ]}
      positions={
        new Map([
          ["a", { x: 0, y: 0 }],
          ["b", { x: 0, y: 600 }],
        ])
      }
      screens={[{ id: "a" }, { id: "b" }]}
      imageDimensions={new Map()}
      markerId="horizontal"
    />,
  );
  expect(markup).toContain('d="M 104 362 L 104 586"');
});
