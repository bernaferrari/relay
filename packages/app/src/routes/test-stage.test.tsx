/** @jsxImportSource react */
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { StageModeContext, TestStage, type StageMode } from "./test-stage";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

function button(label: string) {
  const match = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

it("shows the screenshot, and the live app only while staging new steps", async () => {
  const start = vi.fn();
  let enterStaging!: () => void;
  function Harness({ ready }: { ready: boolean }) {
    const [mode, setMode] = useState<StageMode>("recorded");
    enterStaging = () => setMode("live");
    return (
      <StageModeContext.Provider
        value={{ mode, setMode, recording: { start, ready, pending: false } }}
      >
        <TestStage recorded={<p>Recorded screenshot</p>} live={<p>Live app</p>} />
      </StageModeContext.Provider>
    );
  }
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root!.render(<Harness ready={false} />));
  // No mode switch: the stage simply shows the screenshot.
  expect(host.textContent).toContain("Recorded screenshot");
  expect(host.textContent).not.toContain("Live app");
  expect(host.querySelector('[role="group"]')).toBeNull();

  await act(async () => enterStaging());
  expect(host.textContent).toContain("Live app");
  expect(host.textContent).toContain("Get the app to where the new steps start.");
  expect(host.textContent).toContain("Opening the app…");
  expect(button("Start recording").disabled).toBe(true);

  await act(async () => root!.render(<Harness ready />));
  expect(button("Start recording").disabled).toBe(false);
  await act(async () => button("Start recording").click());
  expect(start).toHaveBeenCalledOnce();

  await act(async () => button("Cancel").click());
  expect(host.textContent).not.toContain("Live app");
  expect(host.textContent).toContain("Recorded screenshot");
});
