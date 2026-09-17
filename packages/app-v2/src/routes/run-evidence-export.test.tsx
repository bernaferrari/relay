import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { RunEvidenceExport } from "./run-evidence-export";
import type { RunEvidenceExportDocument } from "@relay/product/run-evidence-export";

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
