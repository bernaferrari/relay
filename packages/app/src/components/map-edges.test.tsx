/** @jsxImportSource react */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { PresentedMapPath } from "./map-presentation";
import { MapEdges } from "./map-edges";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const path = (id: string, from: string, to: string, extra: Partial<PresentedMapPath> = {}) =>
  ({
    id,
    label: `Open ${to}`,
    fromScreenId: from,
    toScreenId: to,
    fromTitle: from,
    toTitle: to,
    coveringTests: [],
    ...extra,
  }) as PresentedMapPath;

const positions = new Map([
  ["home", { x: 0, y: 0 }],
  ["a", { x: 500, y: -400 }],
  ["b", { x: 500, y: 400 }],
  ["c", { x: 1000, y: 0 }],
]);

async function render(
  paths: PresentedMapPath[],
  props: Partial<Parameters<typeof MapEdges>[0]> = {},
) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () =>
    root.render(
      <MapEdges
        paths={paths}
        positions={positions}
        screens={[...positions.keys()].map((id) => ({ id }))}
        imageDimensions={new Map()}
        {...props}
      />,
    ),
  );
  cleanup = async () => {
    await act(async () => root.unmount());
    container.remove();
  };
  return container;
}

const lines = (container: HTMLElement, slot = "map-edge") =>
  [...container.querySelectorAll(`[data-slot="${slot}"] [data-slot="map-edge-line"]`)].map(
    (line) => line.getAttribute("d") ?? "",
  );

it("draws forward moves quietly and keeps labels off the map", async () => {
  const container = await render([path("up", "home", "a"), path("down", "home", "b")]);
  expect(lines(container)).toHaveLength(2);
  expect(container.querySelector('[data-slot="map-edge-label"]')).toBeNull();
  expect(container.querySelectorAll('[data-slot="map-edge-arrow"]')).toHaveLength(2);
});

it("hides moves back to an earlier screen until their screen is selected", async () => {
  const back = path("back", "c", "home", { label: "Back" });
  expect(lines(await render([back]))).toHaveLength(0);
  await cleanup?.();
  const selected = await render([back], { selectedScreenId: "c" });
  expect(selected.querySelectorAll('[data-slot="map-edge-line"]').length).toBeGreaterThan(0);
});

it("marks moves runs found as drafts", async () => {
  const container = await render([path("draft", "home", "a", { draft: true })]);
  expect(
    container
      .querySelector('[data-draft="true"] [data-slot="map-edge-line"]')
      ?.getAttribute("stroke-dasharray"),
  ).toBe("6 5");
});

it("lifts the selected path above the cards with its label, keeping pointer targets below", async () => {
  const container = await render([path("up", "home", "a"), path("down", "home", "b")], {
    selectedPathId: "down",
  });
  const lifted = container.querySelectorAll('[data-slot="map-edge-lifted"]');
  expect(lifted).toHaveLength(1);
  expect(lifted[0]!.querySelector('[data-slot="map-edge-label"]')?.textContent).toBe("Open b");
  expect(lifted[0]!.querySelector('[data-slot="map-edge-hit"]')).toBeNull();
  expect(
    container.querySelectorAll('[data-slot="map-edge"] [data-slot="map-edge-hit"]').length,
  ).toBe(0);
});

it("opens a connection by click or keyboard", async () => {
  const select = vi.fn();
  const container = await render([path("route", "home", "c", { label: "Enter text → Submit" })], {
    onSelectPath: select,
  });
  const route = container.querySelector('[role="button"]')!;
  expect(route.getAttribute("aria-label")).toBe("home: Enter text → Submit → c");
  await act(async () => {
    route.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    route.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  expect(select.mock.calls).toEqual([["route"], ["route"]]);
});

it("shares one trunk for moves from one screen in one direction, never across directions", async () => {
  const container = await render([
    path("up", "home", "a"),
    path("down", "home", "b"),
    path("down-far", "home", "c"),
  ]);
  const verticalX = (d: string) =>
    [...d.matchAll(/L (-?[\d.]+) (-?[\d.]+)/g)].map((match) => Number(match[1]));
  const [up, down] = lines(container);
  // Up and down leave on different lanes.
  expect(new Set(verticalX(up!)).has(verticalX(down!)[1]!)).toBe(false);
});
