/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { reviewAndroidTalkBack } from "@relay/protocol";
import { TalkBackIssueList, TalkBackModeSelect } from "./talkback-review-panel";

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
    expect(host.textContent).toContain("TalkBack is not turned on");
    expect(host.textContent).toContain("TalkBack has no name for this icon.");
    expect(host.textContent).toContain("Unnamed, Button");
  });
});
