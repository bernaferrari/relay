import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { RunEvidenceExport } from "./run-evidence-export";
import type { RunEvidenceExportDocument } from "@relay/product/run-evidence-export";
import { ApiError } from "@relay/client";

it("explains a timed-out export and lets the user retry the same Run", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const exporter = vi
    .fn()
    .mockRejectedValueOnce(new DOMException("signal timed out", "TimeoutError"))
    .mockResolvedValueOnce({
      fileName: "relay-run-current.json",
      body: "evidence",
      digest: "hash",
    });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:current");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <RunEvidenceExport runId="current" exportEvidence={exporter} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      host.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "Evidence export timed out. Try again.",
    );
    expect(host.textContent).not.toContain("signal timed out");
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector("button")?.textContent).toBe("Try again");
    await act(async () => {
      host.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(exporter.mock.calls).toEqual([["current"], ["current"]]);
    expect(host.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelector("a")?.download).toBe("relay-run-current.json");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
  }
});

it.each([
  [
    new ApiError(403, "You do not have permission to export this Run."),
    "You do not have permission to export this Run.",
  ],
  [
    new DOMException("The operation was aborted.", "AbortError"),
    "Evidence export was interrupted. Try again.",
  ],
  [new TypeError("Failed to fetch"), "Could not reach Relay. Check the connection and try again."],
  [
    new Error("Relay returned TracePack evidence for a different Run."),
    "Relay returned TracePack evidence for a different Run.",
  ],
])("retains an actionable export failure without offering a download", async (failure, message) => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const exporter = vi.fn().mockRejectedValue(failure);
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:unexpected");
  try {
    await act(async () => {
      root.render(
        <QueryClientProvider client={client}>
          <RunEvidenceExport runId="current" exportEvidence={exporter} />
        </QueryClientProvider>,
      );
    });
    await act(async () => {
      host.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector('[role="status"]')?.textContent).toBe(message);
    expect(host.querySelector("a")).toBeNull();
    expect(create).not.toHaveBeenCalled();
    expect(exporter).toHaveBeenCalledExactlyOnceWith("current");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
  }
});

it("does not expose an old Run download when its export completes after navigation", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  let finish!: (value: RunEvidenceExportDocument) => void;
  const exporter = vi.fn((id: string) =>
    id === "old"
      ? new Promise<RunEvidenceExportDocument>((resolve) => {
          finish = resolve;
        })
      : Promise.resolve({ fileName: "new.json", body: "new", digest: "new" }),
  );
  const view = (id: string) => (
    <QueryClientProvider client={client}>
      <RunEvidenceExport runId={id} exportEvidence={exporter} />
    </QueryClientProvider>
  );
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:new");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  try {
    await act(async () => root.render(view("old")));
    await act(async () => host.querySelector("button")!.click());
    await act(async () => root.render(view("new")));
    await act(async () => {
      finish({ fileName: "old.json", body: "old", digest: "old" });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("a")).toBeNull();
    expect(create).not.toHaveBeenCalled();
    await act(async () => {
      host.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("a")?.download).toBe("new.json");
    await act(async () => root.render(view("third")));
    expect(host.querySelector("a")).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:new");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
  }
});
