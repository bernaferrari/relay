/** @jsxImportSource react */
import type { ProductMapOverview } from "@relay/product/map-exploration";
import { createMemoryHistory } from "@tanstack/react-router";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { RelayApp } from "../app";
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
      variants: [],
      coveringTests: [{ id: "browse", name: "Browse products" }],
      recentFailures: [],
      ignoreRegionNames: ["reply body"],
    },
    {
      id: "cart",
      title: "Cart",
      position: { x: 280, y: 24 },
      variantCount: 1,
      variants: [],
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

async function render(
  mapService: MapProductService = { get: async () => overview },
  productService = {} as RecordingProductService,
  initialEntry = "/apps/shop/map",
) {
  const history = createMemoryHistory({ initialEntries: [initialEntry] });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => {
    root.render(
      <RelayApp
        platform={platform}
        history={history}
        mapService={mapService}
        productService={productService}
      />,
    );
  });
  for (let index = 0; index < 5; index += 1) {
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  }
  return { history };
}

describe("Map exploration", () => {
  it("restores an inspected screen from a deep link and keeps it while changing views", async () => {
    const { history } = await render(undefined, undefined, "/apps/shop/map?screen=cart");
    expect(document.body.textContent).toContain("Cart");
    await act(async () => button("Screens").click());
    expect(history.location.search).toContain("screen=cart");
    await act(async () => button("Map").click());
    expect(history.location.search).toContain("screen=cart");
  });

  it("keeps routine returns local until explicitly inspected", async () => {
    await render({
      get: async () => ({
        ...overview,
        paths: [
          ...overview.paths,
          {
            ...overview.paths[0]!,
            id: "back",
            label: "Back to Home",
            fromScreenId: "cart",
            toScreenId: "home",
            fromTitle: "Cart",
            toTitle: "Home",
          },
        ],
      }),
    });
    expect(document.querySelectorAll('[data-slot="map-edge"]')).toHaveLength(1);
    const control = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Inspect Back to Home to Home"]',
    );
    expect(control).not.toBeNull();
    await act(async () => control?.click());
    expect(document.querySelectorAll('[data-slot="map-edge"]')).toHaveLength(2);
    expect(control?.getAttribute("aria-pressed")).toBe("true");
    await act(async () => control?.click());
    expect(document.querySelectorAll('[data-slot="map-edge"]')).toHaveLength(1);
  });

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

  it("aligns continuations and reserves separate rows for sibling subtrees", () => {
    const screens = ["home", "settings", "appearance", "theme", "privacy", "data"].map((id) => ({
      ...overview.screens[0]!,
      id,
      position: undefined,
    }));
    const paths = [
      ["home", "settings"],
      ["settings", "appearance"],
      ["appearance", "theme"],
      ["settings", "privacy"],
      ["privacy", "data"],
      ["data", "settings"],
    ].map(([fromScreenId, toScreenId], index) => ({
      ...overview.paths[0]!,
      id: String(index),
      label: index === 5 ? "Back to Settings" : "Open",
      fromScreenId: fromScreenId!,
      toScreenId,
    }));
    const positions = layoutMapScreens(screens, paths);
    expect(positions.get("home")!.y).toBe(positions.get("settings")!.y);
    expect(positions.get("appearance")!.y).toBe(positions.get("theme")!.y);
    expect(positions.get("privacy")!.y).toBe(positions.get("data")!.y);
    expect(positions.get("privacy")!.y).toBeGreaterThan(positions.get("appearance")!.y);
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
    expect(document.body.textContent).toContain("1 screens in tests");
    expect(document.body.textContent).not.toContain("Combine");
    expect(document.body.textContent).not.toContain("targetProfile");
    expect(document.querySelector('a[href="/tests/new?app=shop"]')).not.toBeNull();

    const canvas = document.querySelector<HTMLElement>('[data-slot="map-canvas"]');
    const world = document.querySelector<HTMLElement>('[data-slot="map-world"]');
    expect(canvas?.tabIndex).toBe(0);
    expect(document.querySelectorAll('[data-slot="map-edge"]')).toHaveLength(1);
    // Recorded connections are named by their accessible label, not an on-canvas chip.
    expect(document.querySelector('[data-slot="map-edge"]')?.getAttribute("aria-label")).toContain(
      "Open cart",
    );
    expect(document.querySelector('[data-slot="map-edge-label"]')).toBeNull();
    expect(
      document.querySelector<HTMLElement>('[data-slot="map-screen"][style*="left: 560px"]'),
    ).not.toBeNull();
    expect(document.body.textContent).not.toContain("Pan right");

    const initialTransform = world?.style.transform;
    const zoomIn = document.querySelector<HTMLButtonElement>('button[aria-label="Zoom in"]');
    await act(async () => zoomIn?.click());
    expect(world?.style.transform).not.toBe(initialTransform);
    expect(document.querySelector('[data-slot="map-zoom"]')?.textContent).toMatch(/\d+%/);

    const beforeKey = world?.style.transform;
    await act(async () =>
      canvas?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })),
    );
    expect(world?.style.transform).not.toBe(beforeKey);
    expect(document.activeElement).toBe(canvas);

    const home = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="map-screen"]')].find(
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
    expect(world?.style.transform).toBe(beforeDrag);
    await act(async () => {
      canvas?.dispatchEvent(pointerEvent("pointerdown", -10000, -10000));
      canvas?.dispatchEvent(pointerEvent("pointermove", 10000, 10000));
    });
    expect(document.querySelectorAll('[data-slot="map-screen"][aria-pressed="true"]')).toHaveLength(
      2,
    );
    expect(document.body.textContent).toContain("2 screens selected");
    await act(async () => canvas?.dispatchEvent(pointerEvent("pointerup", 10000, 10000)));
    expect(document.querySelectorAll('[data-slot="map-screen"][aria-pressed="true"]')).toHaveLength(
      2,
    );
    await act(async () =>
      document.querySelector<HTMLButtonElement>('button[aria-label="Hand tool"]')?.click(),
    );
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
    await act(async () => button("Home → Cart").click());
    expect(history.location.pathname).toBe("/apps/shop/map");
    expect(document.querySelector('[aria-label="Selected path"]')).not.toBeNull();
    const pathLink = document.querySelector<HTMLAnchorElement>('a[href*="path=home-cart"]');
    await act(async () => pathLink?.click());
    expect(history.location.pathname).toBe("/tests/new");
    expect(history.location.search).toContain("path=home-cart");
  }, 15_000);

  it("temporarily pans with Space and explains connection direction", async () => {
    await render();
    const canvas = document.querySelector<HTMLElement>('[data-slot="map-canvas"]')!;
    await act(async () =>
      canvas.dispatchEvent(
        new KeyboardEvent("keydown", { key: "", code: "Space", bubbles: true, cancelable: true }),
      ),
    );
    expect(canvas.dataset.tool).toBe("hand");
    await act(async () =>
      window.dispatchEvent(new KeyboardEvent("keyup", { key: "", code: "Space" })),
    );
    expect(canvas.dataset.tool).toBe("select");
    const home = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="map-screen"]')].find(
      (screen) => screen.textContent?.includes("Home"),
    )!;
    await act(async () => home.click());
    const inspector = document.querySelector('[aria-label="Screen details"]')!;
    expect(inspector.textContent).toContain("Continue to");
    expect(inspector.textContent).toContain("Ignores reply body");
    expect(inspector.textContent).toContain("Visual baselines compare chrome only");
    expect(inspector.textContent).not.toContain("Arrive from");
    const connection = [...inspector.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Open cart"),
    )!;
    await act(async () => connection.click());
    expect(inspector.textContent).toContain("Arrive from");
    expect(inspector.textContent).not.toContain("Continue to");
    expect(inspector.textContent).not.toContain("Record test");
  });

  it("switches retained captures and their source runs without changing the screen", async () => {
    await render({
      get: async () => ({
        ...overview,
        screens: [
          {
            ...overview.screens[0]!,
            variantCount: 2,
            variants: [
              { id: "new", screenshotUri: "relay-evidence://new", sourceRunId: "new-run" },
              { id: "old", screenshotUri: "relay-evidence://old", sourceRunId: "old-run" },
            ],
          },
          overview.screens[1]!,
        ],
      }),
    });
    await act(async () => button("Home").click());
    const picker = document.querySelector<HTMLButtonElement>("#map-screen-capture")!;
    expect(picker.textContent).toContain("Latest");
    await act(async () => picker.click());
    const previous = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(
      (item) => item.textContent?.includes("Capture 1") && !item.textContent?.includes("Latest"),
    );
    await act(async () => previous?.click());
    expect(document.querySelector('a[href="/runs/old-run"]')).not.toBeNull();
    expect(document.querySelector('[aria-label="Screen details"] h3')?.textContent).toBe("Home");
  });

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
    expect(button("Screen 29 → Cart")).toBeDefined();
    const input = document.querySelector<HTMLInputElement>("#map-path-search")!;
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(input, "missing");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(document.body.textContent).toContain("No matching paths");
    await act(async () => button("Clear search").click());
    expect(button("Screen 29 → Cart")).toBeDefined();
  });

  it("focuses a screen into its Tests and failure evidence, with repair gated", async () => {
    await render();
    const cart = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Cart"),
    );
    await act(async () => cart?.click());
    expect(document.body.textContent).toContain("Used in tests");
    expect(document.body.textContent).toContain("No saved test includes this screen.");
    expect(document.body.textContent).toContain("Recent failures");
    expect(document.querySelector('a[href="/runs/run-1"]')).not.toBeNull();
    expect(document.body.textContent).toContain("map change to review");
    const developerMode = button("1 map change to review");
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
    await act(async () => button("1 map change to review").click());
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
    (candidate) =>
      candidate.textContent?.trim() === label || candidate.getAttribute("aria-label") === label,
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

it("prepares screen refresh with canonical target fields and waits for a visible preview", async () => {
  const prepared: unknown[] = [];
  await render(
    {
      get: async () => overview,
      prepareRefresh: async (input) => {
        prepared.push(input);
        return {
          token: "preview",
          screenshotUri: "relay-evidence://capture",
          expiresAt: Date.now() + 300000,
        };
      },
      applyRefresh: async () => overview,
    },
    {
      connect: async () => ({ targets: [] }),
      presentTargets: async () => [
        {
          kind: "device",
          platform: "android",
          targetId: "emulator-1",
          name: "Phone",
          detail: "Android",
        },
      ],
    } as unknown as RecordingProductService,
  );
  const click = async (text: string) => {
    await act(async () => {
      [...document.querySelectorAll("button")]
        .find((button) => button.textContent?.trim() === text)!
        .click();
    });
  };
  await act(async () =>
    [...document.querySelectorAll<HTMLButtonElement>('[data-slot="map-screen"]')]
      .find((screen) => screen.textContent?.includes("Home"))!
      .click(),
  );
  await act(async () =>
    document.querySelector<HTMLButtonElement>('button[aria-label="Update screen"]')!.click(),
  );
  for (let i = 0; i < 5; i++)
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  expect(document.body.textContent).toContain("does not accept a visual baseline");
  expect(document.body.textContent).not.toContain("Capture screen");
  await click("Preview appearance");
  for (let i = 0; i < 5; i++)
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));
  expect(prepared).toEqual([
    {
      appMapId: "shop",
      screenId: "home",
      expectedRevision: 4,
      target: { kind: "device", platform: "android", targetId: "emulator-1" },
    },
  ]);
  expect(
    [...document.querySelectorAll("button")].find(
      (button) => button.textContent === "Update screen",
    )!.disabled,
  ).toBe(true);
});

it("opens every captured screen in a directly linked gallery and focuses the chosen screen on the map", async () => {
  const { history } = await render(undefined, undefined, "/apps/shop/map?view=screens");
  expect(document.querySelector('[data-slot="map-screen"]')).toBeNull();
  expect(document.querySelector('[aria-label="Map screens"]')).not.toBeNull();
  expect(document.querySelectorAll('button[aria-label^="Preview"]')).toHaveLength(
    overview.screens.length,
  );
  await act(async () => button("Preview Home").click());
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Home");
  expect(history.location.search).toContain("view=screens");
  await act(async () => button("Open in map").click());
  expect(document.querySelector('[data-slot="map-screen"]')).not.toBeNull();
  expect(history.location.search).not.toContain("view=screens");
  expect(document.querySelector('[aria-label="Map screens"]')).toBeNull();
});

it("opens a path screen preview without redundant caption text", async () => {
  await render(undefined, undefined, "/apps/shop/map?view=paths");
  await act(async () => button("Preview Home").click());
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain("Home");
  expect(dialog?.textContent).not.toContain("Captured screen");
  expect(document.querySelector('[data-slot="map-canvas"]')).toBeNull();
  await act(async () => button("Open in map").click());
  expect(document.querySelector('[data-slot="map-canvas"]')).not.toBeNull();
});
