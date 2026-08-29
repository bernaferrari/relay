import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { expect, test } from "vitest";
import type { BrowserDeviceSemanticOverlay } from "@relay/protocol";
import { BrowserDeviceSemanticOverlay as Overlay } from "./browser-device-semantic-overlay";
import type { Frame } from "../lib/api-types";

const overlay: BrowserDeviceSemanticOverlay = {
  schemaVersion: 1,
  sessionId: "session-1",
  pageId: "page-1",
  sequence: 4,
  visualFingerprint: "frame-4",
  capturedAt: 40,
  truncated: false,
  candidates: [
    {
      id: "candidate-0",
      role: "button",
      label: "Save",
      rect: { x: 100, y: 50, width: 200, height: 48 },
      enabled: true,
      selected: false,
      focused: false,
      locator: { strategy: "role-name", value: "Save", role: "button", exact: true },
      reasoning: 'Role "button" with accessible name "Save".',
    },
  ],
};

const frame: Frame = {
  id: "frame-4",
  capturedAt: 40,
  mime: "image/jpeg",
  base64: "AA==",
  bytes: 1,
  width: 800,
  height: 600,
  visualFingerprint: "frame-4",
  browserDevice: { sessionId: "session-1", pageId: "page-1", sequence: 4 },
  caption: "browser · frame 4",
};

function mount(values: {
  overlay: BrowserDeviceSemanticOverlay | null;
  frame: Frame | null;
  visible?: boolean;
}) {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const [currentOverlay] = createSignal(values.overlay);
  const [currentFrame] = createSignal(values.frame);
  const dispose = render(
    () => (
      <Overlay
        overlay={currentOverlay}
        frame={currentFrame}
        visible={() => values.visible ?? true}
      />
    ),
    root,
  );
  return { root, dispose };
}

test("semantic Browser Device candidates paint only for the exact frame binding", () => {
  const mounted = mount({ overlay, frame });
  expect(mounted.root.querySelectorAll("[data-browser-semantic-candidate]")).toHaveLength(1);
  expect(mounted.root.textContent).toContain("Save");
  expect(
    mounted.root.querySelector("[data-browser-semantic-candidate]")?.getAttribute("title"),
  ).toContain("accessible name");
  mounted.dispose();
  mounted.root.remove();

  const stale = mount({ overlay: { ...overlay, sequence: 3 }, frame });
  expect(stale.root.querySelector("[data-browser-semantic-overlay]")).toBeNull();
  stale.dispose();
  stale.root.remove();
});

test("semantic overlay is inert and can be hidden without changing the page", () => {
  const mounted = mount({ overlay, frame, visible: false });
  expect(mounted.root.querySelector("[data-browser-semantic-overlay]")).toBeNull();
  expect(mounted.root.querySelector("script")).toBeNull();
  expect(mounted.root.querySelector("iframe")).toBeNull();
  mounted.dispose();
  mounted.root.remove();
});
