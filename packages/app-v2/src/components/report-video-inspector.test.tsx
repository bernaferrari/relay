import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { ReportVideoInspector } from "./report-video-inspector";

const roots: ReturnType<typeof createRoot>[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) root.unmount();
  document.body.replaceChildren();
});

describe("ReportVideoInspector", () => {
  it("seeks a diagnostic event after metadata is available", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <ReportVideoInspector
          video={{
            kind: "video",
            mime: "video/mp4",
            clock: {},
            load: async () => new Blob(["video"]),
          }}
          diagnostics={[{ id: "d1", title: "Tap failed", videoTimeMs: 2_500 }]}
        />,
      );
    });
    const video = host.querySelector("video") as HTMLVideoElement;
    Object.defineProperty(video, "readyState", { value: 1, configurable: true });
    await act(async () =>
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true })),
    );
    expect(video.currentTime).toBe(2.5);
  });

  it("shows a recoverable message when the saved media fails", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <ReportVideoInspector
          video={{
            kind: "video",
            mime: "video/mp4",
            clock: {},
            load: async () => {
              throw new Error("offline");
            },
          }}
        />,
      );
    });
    await act(async () => host.querySelector("video")?.dispatchEvent(new Event("error")));
    expect(host.textContent).toContain("Recorded video could not be loaded");
  });

  it("ignores a deferred load that resolves after unmount", async () => {
    let resolve!: (value: Blob) => void;
    const load = () => new Promise<Blob>((done) => (resolve = done));
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(
        <ReportVideoInspector video={{ kind: "video", mime: "video/mp4", clock: {}, load }} />,
      );
    });
    await act(async () => root.unmount());
    await act(async () => resolve(new Blob(["late"])));
    expect(document.body.textContent).toBe("");
  });
});
