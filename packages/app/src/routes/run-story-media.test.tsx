import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
import { RunStoryView } from "./run-story";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps pending frames neutral and never labels a previous Run's pixels as the current Run", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient();
  const first = new Blob(["first"]);
  const second = new Blob(["second"]);
  let finish!: (value: Blob) => void;
  const deferred = new Promise<Blob>((resolve) => {
    finish = resolve;
  });
  const loadFirst = vi.fn(async () => first);
  const loadSecond = vi.fn(() => deferred);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) =>
    blob === first ? "blob:first" : "blob:second",
  );
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const view = (runId: string, loadFrame: (path: string) => Promise<Blob>) => (
    <QueryClientProvider client={client}>
      <RunStoryView
        runId={runId}
        title="Settings"
        status="passed"
        meta={[]}
        loadFrame={loadFrame}
        steps={[
          {
            id: "step",
            title: "Open Settings",
            state: "passed",
            actions: [
              {
                id: "shot",
                kind: "screenshot",
                label: "Settings screenshot",
                state: "passed",
                framePath: "frames/001.png",
              },
            ],
          },
        ]}
      />
    </QueryClientProvider>
  );
  try {
    await act(async () => root.render(view("first", loadFirst)));
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.querySelector("img")?.src).toBe("blob:first");
    });
    await act(async () => root.render(view("second", loadSecond)));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[aria-label="Loading recorded screen"]')).not.toBeNull();
    expect(host.textContent).not.toContain("No screen yet");
    expect(host.textContent).not.toContain("Loading recorded screen");
    await act(async () => finish(second));
    await vi.waitFor(async () => {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(host.querySelector("img")?.src).toBe("blob:second");
    });
    expect(host.querySelector('[aria-label="Loading recorded screen"]')).toBeNull();
    expect(revoke).toHaveBeenCalledWith("blob:first");
  } finally {
    await act(async () => root.unmount());
    client.clear();
    host.remove();
    vi.restoreAllMocks();
  }
});
