/** @jsxImportSource react */
import type { ProductMapOverview } from "@relay/product/map-exploration";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayV2App } from "../app";
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
  it("is route-addressable, keyboard focusable, and keeps map controls restrained", async () => {
    const { history } = await render();
    expect(history.location.pathname).toBe("/apps/shop/map");
    expect(document.body.textContent).toContain("Known screens and verified paths");
    expect(document.body.textContent).toContain("1 of 2 screens covered");
    expect(document.body.textContent).not.toContain("Combine");
    expect(document.body.textContent).not.toContain("targetProfile");
    expect(document.querySelector('a[href="/tests/new?app=shop&view=path"]')).not.toBeNull();
    expect(document.querySelector('a[href*="path=home-cart"]')).not.toBeNull();

    const canvas = document.querySelector<HTMLElement>(".relay-map-canvas");
    expect(canvas?.tabIndex).toBe(0);
    const zoomIn = [...document.querySelectorAll("button")].find(
      (button) => button.textContent?.trim() === "Zoom in",
    );
    await act(async () => zoomIn?.click());
    expect(document.body.textContent).toContain("110%");

    const panRight = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Pan right"),
    );
    await act(async () => panRight?.click());
    expect(document.activeElement).toBe(canvas);
  }, 15_000);

  it("focuses a screen into its Tests and failure evidence, with repair gated", async () => {
    await render();
    const cart = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Cart"),
    );
    await act(async () => cart?.click());
    expect(document.body.textContent).toContain("Covering Tests");
    expect(document.body.textContent).toContain("No Test covers this screen yet.");
    expect(document.body.textContent).toContain("Recent failures");
    expect(document.querySelector('a[href="/runs/run-1"]')).not.toBeNull();
    expect(document.body.textContent).toContain("Edit Map · Developer Mode");
    expect(document.body.textContent).toContain("Edit Map is not enabled in Explore");
  });
});
