/** @jsxImportSource react */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { RecordingEvidencePanel } from "./recording-review-panels";
import { projectRecordingEvidenceControls } from "../data/recording-evidence-target";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it("fits the recorded image to its local pane on resize without changing captured control coordinates", async () => {
  let resize!: () => void;
  let stage!: HTMLElement;
  let available = 394;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe(element: HTMLElement) {
        stage = element;
        Object.defineProperty(element, "clientHeight", { get: () => available });
        resize();
      }
      disconnect() {}
    },
  );
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const controls = projectRecordingEvidenceControls([
    { label: "Download", index: 0, rect: { x: 108, y: 234, width: 216, height: 468 } },
  ]);
  await act(async () =>
    root!.render(
      <RecordingEvidencePanel
        previewUrl="/recorded-phone.png"
        evidenceRole="exit"
        controls={controls}
        onEvidenceRoleChange={() => {}}
      />,
    ),
  );
  const image = host.querySelector("img")!;
  Object.defineProperties(image, {
    naturalWidth: { value: 1080 },
    naturalHeight: { value: 2340 },
  });
  await act(async () => {
    image.dispatchEvent(new Event("load", { bubbles: true }));
    host.querySelector<HTMLButtonElement>('[aria-label="Elements"]')!.click();
  });
  const control = host.querySelector<HTMLElement>('[style*="--box-left"]')!;
  expect(control.style.getPropertyValue("--box-left")).toBe("10%");
  expect(control.style.getPropertyValue("--box-top")).toBe("10%");
  const before = stage.style.getPropertyValue("--capture-height");
  expect(Number.parseFloat(before)).toBeGreaterThan(300);
  await act(async () => {
    available = 200;
    resize();
  });
  expect(Number.parseFloat(stage.style.getPropertyValue("--capture-height"))).toBeLessThan(201);
  expect(image.getAttribute("src")).toBe("/recorded-phone.png");
  expect(control.style.getPropertyValue("--box-left")).toBe("10%");
  expect(control.style.getPropertyValue("--box-top")).toBe("10%");
});
