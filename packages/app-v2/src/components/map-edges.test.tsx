import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  MapEdges,
  roundedConnector,
  returnConnector,
  quadraticReturn,
  selfLoopConnector,
} from "./map-edges";

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
  expect(markup).toContain("M 52 178");
  expect(markup).toContain("translate(52 178) rotate(0)");
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
  expect(markup).toContain("M 222 178");
  expect(markup).toContain("L 406 178");
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
  expect(markup).toContain('d="M 104 342 L 104 586"');
});

it("joins upper and lower sibling branches at the same junction", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      paths={["top", "middle", "bottom"].map((id) => ({
        id,
        fromScreenId: "source",
        fromTitle: "Source",
        toScreenId: id,
        label: id,
        coveringTests: [],
      }))}
      positions={
        new Map([
          ["source", { x: 0, y: 428 }],
          ["top", { x: 600, y: 0 }],
          ["middle", { x: 600, y: 428 }],
          ["bottom", { x: 600, y: 856 }],
        ])
      }
      screens={["source", "top", "middle", "bottom"].map((id) => ({ id }))}
      imageDimensions={new Map()}
      markerId="shared"
    />,
  );
  const route = (index: number) =>
    markup.match(new RegExp(`id="-${index}" d="([^" ]+[^"]*)"`))![1]!;
  const upper = Number(route(0).match(/Q ([\d.]+)/)![1]);
  const lower = Number(route(2).match(/Q ([\d.]+)/)![1]);
  expect(upper).toBe(lower);
  expect(route(1)).not.toContain("Q");
});

it("routes farther horizontal siblings above the nearer capture", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      horizontal
      paths={["near", "left", "right"].map((id) => ({
        id,
        fromScreenId: "source",
        fromTitle: "Source",
        toScreenId: id,
        label: id,
        coveringTests: [],
      }))}
      positions={
        new Map([
          ["source", { x: 320, y: 0 }],
          ["near", { x: 320, y: 600 }],
          ["left", { x: 0, y: 900 }],
          ["right", { x: 640, y: 900 }],
        ])
      }
      screens={["source", "near", "left", "right"].map((id) => ({ id }))}
      imageDimensions={new Map()}
      markerId="clear-horizontal"
    />,
  );
  for (const index of [1, 2]) {
    const d = markup.match(new RegExp(`id="-${index}" d="([^"]+)"`))![1]!;
    const firstBendY = Number(d.match(/Q [\d.]+ ([\d.]+)/)![1]);
    expect(firstBendY).toBeLessThan(600 - 14);
  }
});

it.each([-420, 420])("exits the control sideways toward a horizontal destination at %s", (x) => {
  const markup = renderToStaticMarkup(
    <MapEdges
      horizontal
      showInteractionTargets
      paths={[
        {
          id: "tap",
          fromScreenId: "home",
          fromTitle: "Home",
          toScreenId: "next",
          label: "Tap",
          coveringTests: [],
          sourceAnchor: {
            point: { x: 0.5, y: 0.5 },
            rect: { x: 0.25, y: 0.4, width: 0.5, height: 0.2 },
          },
        },
      ]}
      positions={
        new Map([
          ["home", { x: 0, y: 0 }],
          ["next", { x, y: 600 }],
        ])
      }
      screens={[{ id: "home", screenshotUri: "home.png" }, { id: "next" }]}
      imageDimensions={new Map([["home", { width: 208, height: 300 }]])}
      markerId="sideways"
    />,
  );
  const originX = x < 0 ? 52 : 156;
  expect(markup).toContain(`M ${originX} 178 L ${x + 104 + (x < 0 ? 12 : -12)} 178`);
  const d = markup.match(/id="-0" d="([^"]+)"/)![1]!;
  expect(d.match(/Q/g)).toHaveLength(1);
  expect(markup).toContain(`translate(${originX} 178) rotate(${x < 0 ? 180 : 0})`);
});

it("keeps labels out of the map and opens connections by click or keyboard", async () => {
  const select = vi.fn();
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MapEdges
        paths={[
          {
            id: "route",
            label: "Enter text → Submit",
            fromScreenId: "home",
            toScreenId: "chat",
            fromTitle: "Home",
            toTitle: "Chat",
            coveringTests: [],
          },
        ]}
        positions={
          new Map([
            ["home", { x: 0, y: 0 }],
            ["chat", { x: 600, y: 0 }],
          ])
        }
        screens={[{ id: "home" }, { id: "chat" }]}
        imageDimensions={new Map()}
        markerId="interactive"
        onSelectPath={select}
      />,
    ),
  );
  expect(container.querySelector('[data-slot="map-edge-label"]')).toBeNull();
  const route = container.querySelector('[role="button"]')!;
  expect(route.getAttribute("aria-label")).toBe("Home: Enter text → Submit → Chat");
  await act(async () => {
    route.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    route.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(select.mock.calls).toEqual([["route"], ["route"]]);
  await act(async () => root.unmount());
});

it("keeps self-loops outside the preview and clear of the center exit", () => {
  const box = { x: 100, y: 50, width: 320, height: 200 };
  const points = selfLoopConnector(box);
  expect(points.every((point) => point.x > box.x + box.width)).toBe(true);
  expect(points.every((point) => point.y < box.y + box.height / 2)).toBe(true);
  expect(points[0]?.x).toBe(points.at(-1)?.x);
  expect(selfLoopConnector(box, 1)[1]?.x).toBeGreaterThan(points[1]!.x);
});

it("renders a self-loop without crossing the screen", () => {
  const markup = renderToStaticMarkup(
    <MapEdges
      paths={[
        {
          id: "self",
          fromScreenId: "home",
          toScreenId: "home",
          fromTitle: "Home",
          label: "Check content",
          coveringTests: [],
        },
      ]}
      positions={new Map([["home", { x: 0, y: 0 }]])}
      screens={[{ id: "home" }]}
      imageDimensions={new Map()}
      markerId="self"
    />,
  );
  expect(markup).toContain('data-slot="map-edge-line"');
  expect(markup).not.toContain('data-slot="map-edge-label"');
});

it("returns from an upper screen to a visible side port above the destination footer", () => {
  const source = { x: 600, y: 0, width: 320, height: 200 };
  const target = { x: 0, y: 400, width: 320, height: 200 };
  const route = returnConnector(source, target);
  expect(route.points.at(-1)?.x).toBe(target.x + target.width + 14);
  expect(route.points.at(-1)?.y).toBeGreaterThan(target.y + target.height / 2);
  expect(route.points.at(-1)?.y).toBeLessThan(target.y + target.height);
});

it("keeps connector and arrow size fixed when highlighted, with solid recorded returns", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MapEdges
        paths={[
          {
            id: "return",
            label: "Chat",
            fromScreenId: "imagine",
            toScreenId: "home",
            fromTitle: "Imagine",
            coveringTests: [],
          },
        ]}
        positions={
          new Map([
            ["imagine", { x: 600, y: 0 }],
            ["home", { x: 0, y: 400 }],
          ])
        }
        screens={[{ id: "imagine" }, { id: "home" }]}
        imageDimensions={new Map()}
        markerId="stable"
        onSelectPath={() => {}}
      />,
    ),
  );
  const line = container.querySelector('[data-slot="map-edge-line"]')!;
  const width = line.getAttribute("stroke-width");
  const geometry = line.getAttribute("d");
  expect(line.hasAttribute("stroke-dasharray")).toBe(false);
  const edge = container.querySelector('[data-slot="map-edge"]')!;
  await act(async () => edge.dispatchEvent(new FocusEvent("focusin", { bubbles: true })));
  expect(edge.getAttribute("data-state")).toBe("selected");
  expect(line.getAttribute("stroke-width")).toBe(width);
  expect(line.getAttribute("d")).toBe(geometry);
  await act(async () => root.unmount());
});
