import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { RunThumb } from "./run-thumb";

const download = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => ({ platform: {} }) }));
vi.mock("../data/product-client", () => ({
  productClientForPlatform: async () => ({ client: { download } }),
}));
afterEach(() => vi.restoreAllMocks());

it("recovers a visible thumbnail after a temporary request failure", async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("IntersectionObserver", undefined);
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = vi.fn(() => "blob:thumbnail");
      static revokeObjectURL = vi.fn();
    },
  );
  download
    .mockRejectedValueOnce(new Error("Connection interrupted"))
    .mockResolvedValue({ ok: true, blob: async () => new Blob(["image"], { type: "image/png" }) });
  const client = new QueryClient();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <RunThumb runId="saved-run" label="Saved run" />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
    });
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:thumbnail");
    expect(download).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    vi.unstubAllGlobals();
  }
});

it.each([
  { runId: undefined, title: "Test plan", requests: 0 },
  { runId: "no-capture", title: "No preview available", requests: 1 },
  { runId: "known-missing", available: false, title: "Screenshot missing", requests: 0 },
])(
  "distinguishes $title without retrying a missing capture",
  async ({ runId, available, title, requests }) => {
    vi.stubGlobal("IntersectionObserver", undefined);
    download
      .mockReset()
      .mockRejectedValue(Object.assign(new Error("No screenshot"), { status: 404 }));
    const client = new QueryClient();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <RunThumb runId={runId} label="Run" available={available} />
          </QueryClientProvider>,
        ),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      expect(host.querySelector(`[title="${title}"]`)).not.toBeNull();
      expect(download).toHaveBeenCalledTimes(requests);
    } finally {
      await act(async () => root.unmount());
      client.clear();
      vi.unstubAllGlobals();
    }
  },
);
