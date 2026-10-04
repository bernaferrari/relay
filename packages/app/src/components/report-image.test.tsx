import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ReportImage } from "./report-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it.each(["blob:http://127.0.0.1:3001/cached-screenshot", "/direct-screenshot.png"])(
  "displays a directly available screenshot without a missing-loader warning or extra requests (%s)",
  async (src) => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("No image requests"));
    const createUrl = vi.spyOn(URL, "createObjectURL");
    const revokeUrl = vi.spyOn(URL, "revokeObjectURL");
    try {
      await act(async () =>
        root.render(
          <QueryClientProvider client={client}>
            <ReportImage media={{ kind: "image", src }} alt="Already loaded checkpoint" />
          </QueryClientProvider>,
        ),
      );
      await act(async () => {
        await client.invalidateQueries({ queryKey: ["report-image", src] });
      });
      expect(host.querySelector("img")?.getAttribute("src")).toBe(src);
      expect(host.textContent).not.toContain("Loading screenshot");
      expect(
        errors.mock.calls.some((call) => String(call[0]).includes("No queryFn was passed")),
      ).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
      expect(createUrl).not.toHaveBeenCalled();
      expect(revokeUrl).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      client.clear();
      errors.mockRestore();
      fetch.mockRestore();
      createUrl.mockRestore();
      revokeUrl.mockRestore();
    }
  },
);

it("retries a failed screenshot without navigating away from the report", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const load = vi
    .fn()
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue(new Blob(["image"]));
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:recovered-image");
  const revokeUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const settle = async () => {
    for (let i = 0; i < 5; i++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
  };
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ReportImage
            media={{ kind: "image", src: "failed-frame", load }}
            alt="Selected checkpoint"
          />
        </QueryClientProvider>,
      ),
    );
    await settle();
    expect(host.textContent).toContain("Screenshot couldn’t load.");
    expect(host.querySelector("button")?.textContent).toBe("Retry screenshot");
    await act(async () => host.querySelector("button")!.click());
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:recovered-image");
    expect(host.textContent).not.toContain("couldn’t load");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    createUrl.mockRestore();
    revokeUrl.mockRestore();
  }
});

it("recovers a browser image error and clears it when choosing another screenshot", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const client = new QueryClient();
  const render = (src: string) =>
    act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ReportImage media={{ kind: "image", src }} alt="Checkpoint" />
        </QueryClientProvider>,
      ),
    );
  try {
    await render("/first.png");
    const failedImage = host.querySelector("img")!;
    await act(async () => failedImage.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("Screenshot couldn’t load.");
    await act(async () => host.querySelector("button")!.click());
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/first.png");
    expect(host.querySelector("img")).not.toBe(failedImage);
    await act(async () => host.querySelector("img")!.dispatchEvent(new Event("error")));
    await render("/second.png");
    expect(host.textContent).not.toContain("couldn’t load");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/second.png");
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

it("does not display a late screenshot response after selection changes", async () => {
  const host = document.createElement("div");
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let resolveFirst!: (value: Blob) => void;
  const load = () =>
    new Promise<Blob>((resolve) => {
      resolveFirst = resolve;
    });
  const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:stale");
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ReportImage media={{ kind: "image", src: "first", load }} alt="First" />
        </QueryClientProvider>,
      ),
    );
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <ReportImage media={{ kind: "image", src: "/second.png" }} alt="Second" />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      resolveFirst(new Blob(["old-image"]));
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(host.querySelector("img")?.getAttribute("src")).toBe("/second.png");
    expect(createUrl).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    createUrl.mockRestore();
  }
});
