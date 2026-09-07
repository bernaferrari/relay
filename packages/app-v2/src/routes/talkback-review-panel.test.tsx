/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useRef, useState } from "react";
import { reviewAndroidTalkBack } from "@relay/protocol";
import type { Platform } from "../platform/types";
import {
  TalkBackIssueList,
  TalkBackModeSelect,
  TalkBackOverlay,
  useTalkBackReview,
} from "./talkback-review-panel";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];

afterEach(async () => {
  await act(async () => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
});

describe("TalkBack review panel", () => {
  it("shows spoken names without implying TalkBack audio is on", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const review = reviewAndroidTalkBack([
      {
        description: "Close",
        role: "android.widget.ImageButton",
        hittable: true,
        rect: { x: 0, y: 0, width: 48, height: 48 },
        index: 0,
      },
      {
        role: "android.widget.ImageButton",
        hittable: true,
        rect: { x: 60, y: 0, width: 48, height: 48 },
        index: 1,
      },
    ]);
    act(() => {
      root.render(
        <div>
          <TalkBackModeSelect mode="always" loading={false} onModeChange={() => undefined} />
          <TalkBackIssueList review={review} inspectable />
        </div>,
      );
    });
    expect(host.textContent).toMatch(/Always show|Accessibility names/);
    expect(host.textContent).toContain("not a TalkBack or VoiceOver proof");
    expect(host.textContent).toContain("TalkBack has no name for this icon.");
    expect(host.textContent).toContain("Unnamed, Button");
  });

  it("paints accessibility names on the live view when always is selected", () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const review = reviewAndroidTalkBack([
      {
        label: "Preferred Language",
        type: "Cell",
        hittable: true,
        rect: { x: 0, y: 20, width: 100, height: 24 },
        index: 0,
      },
    ]);
    const bounds = {
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      top: 0,
      left: 0,
      right: 100,
      bottom: 100,
      toJSON() {
        return this;
      },
    };
    function Harness() {
      const canvasRef = useRef<HTMLCanvasElement>(null);
      return (
        <div
          ref={(node) => {
            if (node) Object.defineProperty(node, "getBoundingClientRect", { value: () => bounds });
          }}
        >
          <canvas
            ref={(node) => {
              canvasRef.current = node;
              if (node) {
                node.width = 100;
                node.height = 100;
                Object.defineProperty(node, "getBoundingClientRect", { value: () => bounds });
              }
            }}
          />
          <TalkBackOverlay canvasRef={canvasRef} items={review.items} mode="always" />
        </div>
      );
    }
    act(() => {
      root.render(<Harness />);
    });
    expect(host.textContent).toContain("Preferred Language");
  });

  it("hides overlay names and issue counts when the observation epoch advances", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    const review = reviewAndroidTalkBack([
      {
        description: "Close",
        role: "android.widget.ImageButton",
        hittable: true,
        rect: { x: 0, y: 0, width: 48, height: 48 },
        index: 0,
      },
      {
        role: "android.widget.ImageButton",
        hittable: true,
        rect: { x: 60, y: 0, width: 48, height: 48 },
        index: 1,
      },
    ]);
    const platform = {
      storage: {
        get: async () => "always",
        set: async () => undefined,
      },
    } as Pick<Platform, "storage"> as Platform;
    let captureCount = 0;
    let releaseSecond: (() => void) | undefined;
    const secondCapture = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    function Harness() {
      const [refreshKey, setRefreshKey] = useState(0);
      const talkBack = useTalkBackReview({
        enabled: true,
        serial: "pixel-1",
        refreshKey,
        platform,
        capture: async () => {
          captureCount += 1;
          if (captureCount > 1) await secondCapture;
          return { inspectable: true, review, targetId: "pixel-1" };
        },
      });
      return (
        <div>
          <button type="button" onClick={() => setRefreshKey((value) => value + 1)}>
            Advance
          </button>
          <TalkBackIssueList
            review={talkBack.inspection.review}
            inspectable={talkBack.inspection.inspectable}
            message={talkBack.issue ?? talkBack.inspection.message}
          />
          <span data-testid="overlay-count">{talkBack.inspection.overlayItems.length}</span>
        </div>
      );
    }
    await act(async () => {
      root.render(<Harness />);
    });
    for (let i = 0; i < 20; i += 1) {
      if (host.querySelector("[data-testid=overlay-count]")?.textContent !== "0") break;
      await act(async () => {
        await Promise.resolve();
      });
    }
    expect(host.textContent).toContain("TalkBack has no name for this icon.");
    expect(host.textContent).toMatch(/1 unlabeled control/);
    expect(host.querySelector("[data-testid=overlay-count]")?.textContent).toBe(
      String(review.items.length),
    );
    await act(async () => {
      host.querySelector("button")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(host.textContent).not.toContain("TalkBack has no name for this icon.");
    expect(host.textContent).not.toMatch(/1 unlabeled control/);
    expect(host.textContent).not.toMatch(/\d+ accessibility names on this screen/);
    expect(host.querySelector("[data-testid=overlay-count]")?.textContent).toBe("0");
    await act(async () => {
      releaseSecond?.();
      await Promise.resolve();
    });
  });
});
