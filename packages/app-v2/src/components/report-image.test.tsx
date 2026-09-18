import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { ReportImage } from "./report-image";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
