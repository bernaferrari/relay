/** @jsxImportSource react */
import type { ProductMapOverview } from "@relay/product/map-exploration";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import {
  MAP_MAX_SCALE,
  fitMapToBounds,
  zoomMapAtPoint,
  layoutMapScreens,
} from "../components/infinite-map-canvas";
import type { MapProductService } from "../data/map-product-service";
import type { RecordingProductService } from "../data/recording-product-service";
import type { Platform } from "../platform/types";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const platform: Platform = {
  platform: "web",
  getServerUrl: () => "http://127.0.0.1:8787",
  storage: { get: () => null, set: () => undefined, remove: () => undefined },
};

const overview: ProductMapOverview = {
  appMapId: "shop",
  appName: "Shopping",
  description: "Purchase flow",
  revision: 4,
  screens: [
    {
      id: "home",
      title: "Home",
      position: { x: 24, y: 24 },
      variantCount: 1,
      coveringTests: [{ id: "browse", name: "Browse products" }],
      recentFailures: [],
    },
    {
      id: "cart",
      title: "Cart",
      position: { x: 280, y: 24 },
      variantCount: 1,
      coveringTests: [],
      recentFailures: [{ id: "failure", outcome: "product-failure", runId: "run-1" }],
    },
  ],
  paths: [
    {
      id: "home-cart",
      label: "Open cart",
      fromScreenId: "home",
      toScreenId: "cart",
      fromTitle: "Home",
      toTitle: "Cart",
      coveringTests: [{ id: "browse", name: "Browse products" }],
    },
  ],
  coverage: {
    screenCount: 2,
    coveredScreenCount: 1,
    pathCount: 1,
    coveredPathCount: 1,
    testCount: 1,
  },
  pendingProposalCount: 1,
  navigation: { route: "/apps/shop/map", href: "/apps/shop/map" },
};

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

async function render(mapService: MapProductService = { get: async () => overview }) {
  const history = createMemoryHistory({ initialEntries: ["/apps/shop/map"] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayV2App
        platform={platform}
        history={history}
        mapService={mapService}
        productService={{} as RecordingProductService}
      />,
    );
  });
  for (let index = 0; index < 5; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
  return { history };
}

describe("Map exploration", () => {
  it("lays out connected screens in reading order without cycling", () => {
    const screens = ["a", "b", "c"].map((id) => ({
      ...overview.screens[0]!,
      id,
      position: undefined,
    }));
    const paths = [
      ["a", "b"],
      ["b", "c"],
      ["c", "a"],
    ].map(([fromScreenId, toScreenId], index) => ({
      ...overview.paths[0]!,
      id: String(index),
      fromScreenId: fromScreenId!,
      toScreenId,
    }));
    const positions = layoutMapScreens(screens, paths);
    expect(positions.get("a")!.x).toBeLessThan(positions.get("b")!.x);
    expect(positions.get("b")!.x).toBeLessThan(positions.get("c")!.x);
    expect(new Set([...positions.values()].map((point) => `${point.x},${point.y}`)).size).toBe(3);
  });

  it("keeps cursor-centered zoom and fit math stable and bounded", () => {
    const point = { x: 120, y: 80 };
    const before = { x: 20, y: 30, scale: 1 };
    const after = zoomMapAtPoint(before, 2, point);

    expect((point.x - before.x) / before.scale).toBe((point.x - after.x) / after.scale);
    expect((point.y - before.y) / before.scale).toBe((point.y - after.y) / after.scale);
    expect(zoomMapAtPoint(before, 100, point).scale).toBe(MAP_MAX_SCALE);

    const fitted = fitMapToBounds(
      { minX: 20, minY: 10, maxX: 420, maxY: 210 },
      { width: 1_000, height: 600 },
    );
    expect(fitted.scale).toBeGreaterThan(1);
    expect(fitted.x).toBeGreaterThan(0);
    expect(fitted.y).toBeGreaterThan(0);
  });

  it("is route-addressable, keyboard focusable, and keeps map controls restrained", async () => {
    const { history } = await render();
    expect(history.location.pathname).toBe("/apps/shop/map");
    expect(document.querySelector('a[href="/apps/shop"]')?.getAttribute("aria-label")).toBe(
      "Back to app",
    );
    expect(document.querySelector('[aria-label="Screens and verified paths"]')).not.toBeNull();
    expect(document.body.textContent).toContain("1 screens tested");
    expect(document.body.textContent).not.toContain("Combine");
    expect(document.body.textContent).not.toContain("targetProfile");
    expect(document.querySelector('a[href="/tests/new?app=shop"]')).not.toBeNull();

    const canvas = document.querySelector<HTMLElement>(".relay-map-canvas");
    const world = document.querySelector<HTMLElement>(".relay-map-world");
    expect(canvas?.tabIndex).toBe(0);
    expect(document.querySelectorAll(".relay-map-edge")).toHaveLength(1);
    expect(document.querySelector(".relay-map-edge text")?.textContent).toBe("Open cart");
    expect(document.querySelector(".relay-map-edge rect")).not.toBeNull();
    expect(
      document.querySelector<HTMLElement>('.relay-map-screen[style*="left: 280px"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Pan right");

    const initialTransform = world?.style.transform;
    const zoomIn = document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]');
    await act(async () => zoomIn?.click());
    expect(world?.style.transform).not.toBe(initialTransform);
    expect(document.querySelector(".relay-map-zoom")?.textContent).toMatch(/\d+%/);

    const beforeKey = world?.style.transform;
    await act(async () =>
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(world?.style.transform).not.toBe(beforeKey);
    expect(document.activeElement).toBe(canvas);

    const home = [...document.querySelectorAll<HTMLButtonElement>(".relay-map-screen")].find(
      (screen) => screen.textContent?.includes("Home"),
    );
    for (let index = 0; index < 20; index += 1) {
      await act(async () =>
        canvas?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
      );
    }
    const beforeReveal = world?.style.transform;
    await act(async () => home?.focus());
    expect(world?.style.transform).not.toBe(beforeReveal);

    const beforeDrag = world?.style.transform;
    await act(async () => {
      canvas?.dispatchEvent(pointerEvent("pointerdown", 160, 140));
      canvas?.dispatchEvent(pointerEvent("pointermove", 220, 180));
      canvas?.dispatchEvent(pointerEvent("pointerup", 220, 180));
    });
    expect(world?.style.transform).not.toBe(beforeDrag);

    const beforeWheel = world?.style.transform;
    await act(async () =>
      canvas?.dispatchEvent(
        new WheelEvent("wheel", {
          bubbles: true,
          cancelable: true,
          clientX: 240,
          clientY: 180,
          deltaY: -120,
        }),
      ),
    );
    expect(world?.style.transform).not.toBe(beforeWheel);

    await act(async () => button("Paths").click());
    const pathLink = document.querySelector<HTMLAnchorElement>('a[href*="path=home-cart"]');
    await act(async () => pathLink?.click());
    expect(history.location.pathname).toBe("/tests/new");
    expect(history.location.search).toContain("path=home-cart");
  }, 15_000);

  it("searches paths beyond the former 24-row limit and clears empty results", async () => {
    await render({
      get: async () => ({
        ...overview,
        paths: Array.from({ length: 30 }, (_, index) => ({
          ...overview.paths[0]!,
          id: `path-${index}`,
          fromTitle: `Screen ${index}`,
          label: `Journey ${index}`,
        })),
      }),
    });
    await act(async () => button("Paths").click());
    expect(document.querySelector('a[href*="path=path-29"]')).not.toBeNull();
    const input = document.querySelector<HTMLInputElement>("#map-path-search")!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(input, "missing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("No matching paths");
    await act(async () => button("Clear search").click());
    expect(document.querySelector('a[href*="path=path-29"]')).not.toBeNull();
  });

  it("focuses a screen into its Tests and failure evidence, with repair gated", async () => {
    await render();
    const cart = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Cart"),
    );
    await act(async () => cart?.click());
    expect(document.body.textContent).toContain("Tests");
    expect(document.body.textContent).toContain("No saved Test covers this screen yet.");
    expect(document.body.textContent).toContain("Recent failures");
    expect(document.querySelector('a[href="/runs/run-1"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Review map changes");
    const developerMode = button("Review map changes");
    expect(developerMode.getAttribute("aria-expanded")).toBe("false");
    await act(async () => developerMode.click());
    expect(developerMode.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("No proposal needs a decision");
  });

  it("reviews canonical Map proposals with the current revision", async () => {
    const decisions: unknown[] = [];
    let pending = true;
    await render({
      get: async () => ({ ...overview, pendingProposalCount: pending ? 1 : 0 }),
      listProposals: async () =>
        pending
          ? [
              {
                id: "proposal-1",
                title: "Add checkout path",
                description: "Observed during a reviewed Session.",
                status: "pending",
                createdAt: 1,
                updatedAt: 2,
                baseRevision: 4,
              },
            ]
          : [],
      approveProposal: async (input) => {
        decisions.push(input);
        pending = false;
        return { ...overview, revision: 5, pendingProposalCount: 0 };
      },
    });
    await act(async () => button("Review map changes").click());
    expect(document.body.textContent).toContain("Add checkout path");
    await act(async () => button("Approve").click());
    expect(decisions).toEqual([
      {
        appMapId: "shop",
        proposalId: "proposal-1",
        expectedRevision: 4,
        reason: "Reviewed in Relay",
      },
    ]);
  });
});

function button(label: string) {
  const result = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!result) throw new Error(`Button not found: ${label}`);
  return result;
}

function pointerEvent(type: string, clientX: number, clientY: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}
