import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { RunEvidenceExport, RunWalkthroughExport } from "./run-evidence-export";
import type { RunEvidenceExportDocument } from "@relay/product/run-evidence-export";
import { ApiError } from "@relay/client";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("downloads the canonical walkthrough as HTML without changing evidence JSON exports", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  const exporter = vi.fn().mockResolvedValue({
    fileName: "walkthrough.html",
    body: "<!doctype html><title>Saved run</title>",
    digest: "hash",
  });
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:walkthrough");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <RunWalkthroughExport runId="current" exportWalkthrough={exporter} />
        </QueryClientProvider>,
      ),
    );
    expect(host.querySelector("button")?.textContent).toBe("Prepare walkthrough");
    await act(async () => {
      host.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(exporter).toHaveBeenCalledExactlyOnceWith("current");
    expect(create.mock.calls[0]![0]).toBeInstanceOf(Blob);
    expect((create.mock.calls[0]![0] as Blob).type).toBe("text/html");
    expect(host.querySelector("a")?.download).toBe("walkthrough.html");
    expect(host.querySelector("a")?.textContent).toBe("Save walkthrough");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
  }
});

it("explains a timed-out export and lets the user retry the same run", async () => {
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

it("removes a previous walkthrough when a new export refuses changed evidence", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const exporter = vi
    .fn()
    .mockResolvedValueOnce({ fileName: "walkthrough.html", body: "saved", digest: "hash" })
    .mockRejectedValueOnce(new Error("The saved capture changed. Export refused."));
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:previous");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  try {
    await act(async () =>
      root.render(
        <QueryClientProvider client={client}>
          <RunWalkthroughExport runId="current" exportWalkthrough={exporter} />
        </QueryClientProvider>,
      ),
    );
    await act(async () => {
      host.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("a")).not.toBeNull();
    await act(async () => {
      await vi.waitFor(() => expect(host.querySelector("button")?.disabled).toBe(false));
    });
    await act(async () => {
      host.querySelector("button")!.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(host.querySelector("a")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toBe(
      "The saved capture changed. Export refused.",
    );
    expect(revoke).toHaveBeenCalledWith("blob:previous");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
  }
});

it.each([
  [
    new ApiError(403, "You do not have permission to export this run."),
    "You do not have permission to export this run.",
  ],
  [
    new DOMException("The operation was aborted.", "AbortError"),
    "Evidence export was interrupted. Try again.",
  ],
  [new TypeError("Failed to fetch"), "Could not reach Relay. Check the connection and try again."],
  [
    new Error("Relay returned TracePack evidence for a different run."),
    "Relay returned TracePack evidence for a different run.",
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

it("does not expose an old run download when its export completes after navigation", async () => {
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
