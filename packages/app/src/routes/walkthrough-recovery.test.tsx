import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createRootRoute,
  createRouter,
  createMemoryHistory,
  RouterProvider,
} from "@tanstack/react-router";
import { afterEach, expect, it, vi } from "vitest";
import { WalkthroughRecovery } from "./walkthrough-recovery";
import type { PlayerManifestProjection, RunProductService } from "../data/run-product-service";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
const manifest = {
  captures: [
    { variantId: "member", runId: "member-run", capturedAt: 1 },
    { variantId: "admin", runId: "admin-run", capturedAt: 9 },
  ],
} as unknown as PlayerManifestProjection;
async function mount(variantId: string, service: RunProductService) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const route = createRootRoute({
    component: () => (
      <QueryClientProvider client={queryClient}>
        <WalkthroughRecovery manifest={manifest} variantId={variantId} runService={service} />
      </QueryClientProvider>
    ),
  });
  const router = createRouter({
    routeTree: route,
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await act(async () => {
    await router.load();
    root.render(<RouterProvider router={router} />);
  });
  return host;
}
async function click(host: HTMLElement, label: string) {
  const button = [...host.querySelectorAll("button")].find(
    (button) => button.textContent === label,
  )!;
  await act(async () => {
    button.click();
    await new Promise((resolve) => setTimeout(resolve, 5));
  });
}
it("loads only the chosen configuration and opens setup without starting a run", async () => {
  const service = {
    getReport: vi.fn().mockResolvedValue({
      runId: "member-run",
      targetName: "Member browser",
      executionContext: { buildId: "build-1" },
    }),
    replay: vi.fn(),
    getReplayJob: vi.fn(),
  } as unknown as RunProductService;
  const host = await mount("member", service);
  expect(service.getReport).not.toHaveBeenCalled();
  await click(host, "Set up another run");
  for (let index = 0; index < 20 && !document.querySelector('[role="dialog"]'); index++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(service.getReport).toHaveBeenCalledWith("member-run");
  expect(service.replay).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Member browser");
  expect(
    (document.querySelector('input[value="same-configuration"]') as HTMLInputElement).checked,
  ).toBe(true);
});
it("does not offer another account's setup when this configuration has no captures", async () => {
  const service = {
    getReport: vi.fn(),
    replay: vi.fn(),
    getReplayJob: vi.fn(),
  } as unknown as RunProductService;
  const host = await mount("signed-out", service);
  expect(host.querySelector("button")).toBeNull();
  expect(service.getReport).not.toHaveBeenCalled();
});
it("retries a failed setup read without starting execution", async () => {
  const service = {
    getReport: vi.fn().mockRejectedValue(new Error("offline")),
    replay: vi.fn(),
    getReplayJob: vi.fn(),
  } as unknown as RunProductService;
  const host = await mount("member", service);
  await click(host, "Set up another run");
  for (
    let index = 0;
    index < 20 && !host.textContent?.includes("Could not load the saved setup");
    index++
  ) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
  expect(host.textContent).toContain("Could not load the saved setup");
  await click(host, "Retry run setup");
  expect(service.getReport).toHaveBeenCalledTimes(2);
  expect(service.replay).not.toHaveBeenCalled();
});
