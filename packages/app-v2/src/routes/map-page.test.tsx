/** @jsxImportSource react */
import type { ProductMapOverview } from "@relay/product/map-exploration";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
import { MAP_MAX_SCALE, fitMapToBounds, zoomMapAtPoint } from "../components/infinite-map-canvas";
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

async function render() {
  const history = createMemoryHistory({ initialEntries: ["/apps/shop/map"] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const mapService: MapProductService = { get: async () => overview };
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
    expect(document.querySelector('a[href="/apps/shop"]')?.textContent).toBe("Shopping");
    expect(document.body.textContent).toContain("Known screens and verified paths");
    expect(document.body.textContent).toContain("1 of 2 screens covered");
    expect(document.body.textContent).not.toContain("Combine");
    expect(document.body.textContent).not.toContain("targetProfile");
    expect(document.querySelector('a[href="/tests/new?app=shop&view=path"]')).not.toBeNull();
    expect(document.querySelector('a[href*="path=home-cart"]')).not.toBeNull();

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

    const pathLink = document.querySelector<HTMLAnchorElement>('a[href*="path=home-cart"]');
    await act(async () => pathLink?.click());
    expect(history.location.pathname).toBe("/tests/new");
    expect(history.location.search).toContain("path=home-cart");
  }, 15_000);

  it("focuses a screen into its Tests and failure evidence, with repair gated", async () => {
    await render();
    const cart = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Cart"),
    );
    await act(async () => cart?.click());
    expect(document.body.textContent).toContain("Covering Tests");
    expect(document.body.textContent).toContain("No saved Test covers this screen yet.");
    expect(document.body.textContent).toContain("Recent failures");
    expect(document.querySelector('a[href="/runs/run-1"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Edit Map · Developer Mode");
    const developerMode = button("Edit Map · Developer Mode");
    expect(developerMode.getAttribute("aria-expanded")).toBe("false");
    await act(async () => developerMode.click());
    expect(developerMode.getAttribute("aria-expanded")).toBe("true");
    expect(document.body.textContent).toContain("Edit Map is not enabled in Explore");
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
