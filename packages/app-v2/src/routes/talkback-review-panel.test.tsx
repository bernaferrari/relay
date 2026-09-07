/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { useRef } from "react";
import { reviewAndroidTalkBack } from "@relay/protocol";
import { TalkBackIssueList, TalkBackModeSelect, TalkBackOverlay } from "./talkback-review-panel";

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
});
