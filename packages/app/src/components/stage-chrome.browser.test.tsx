import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import { createSingleFlightAction } from "../lib/single-flight-action";
import { StageRecordingControls } from "./stage-chrome";

test("ordinary stage copy starts a Test rather than exposing Map path terminology", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <StageRecordingControls
        stageView="live"
        recording={false}
        recordingGroup=""
        setRecordingGroup={() => undefined}
        startNextRecordingGroup={() => undefined}
        selectedLeaseId="lease"
        busyCapture={false}
        frameCount={0}
        onToggleRecording={() => undefined}
        onCaptureScreenshot={() => undefined}
        onCopyScreenshot={() => undefined}
        onClearFrames={() => undefined}
      />
    ),
    root,
  );

  expect(root.querySelector("[aria-label='Record test']")?.textContent).toContain("Record test");
  expect(root.textContent).not.toContain("Record path");
  dispose();
  root.remove();
});

test("recording presents checkpoint evidence as the one supporting action", () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const checkpoint = vi.fn();
  const dispose = render(
    () => (
      <StageRecordingControls
        stageView="live"
        recording
        recordingGroup="Settings"
        setRecordingGroup={() => undefined}
        startNextRecordingGroup={() => undefined}
        selectedLeaseId="lease"
        busyCapture={false}
        frameCount={0}
        onToggleRecording={() => undefined}
        onCaptureScreenshot={checkpoint}
        onCopyScreenshot={() => undefined}
        onClearFrames={() => undefined}
      />
    ),
    root,
  );

  const button = root.querySelector<HTMLButtonElement>("[aria-label='Add checkpoint']");
  expect(button?.textContent).toContain("Checkpoint");
  button?.click();
  expect(checkpoint).toHaveBeenCalledOnce();
  expect(root.querySelector("[aria-label='Save screenshot to the map']")).toBeNull();
  dispose();
  root.remove();
});

test("checkpoint control disables immediately and drops a rapid second activation", async () => {
  document.body.replaceChildren();
  const root = document.createElement("div");
  document.body.append(root);
  const [busy, setBusy] = createSignal(false);
  let release!: () => void;
  const pending = new Promise<void>((resolve) => (release = resolve));
  const checkpoint = vi.fn(async () => pending);
  const guarded = createSingleFlightAction({ action: checkpoint, onBusyChange: setBusy });
  const dispose = render(
    () => (
      <StageRecordingControls
        stageView="live"
        recording
        recordingGroup="Settings"
        setRecordingGroup={() => undefined}
        startNextRecordingGroup={() => undefined}
        selectedLeaseId="lease"
        busyCapture={busy()}
        frameCount={0}
        onToggleRecording={() => undefined}
        onCaptureScreenshot={() => void guarded()}
        onCopyScreenshot={() => undefined}
        onClearFrames={() => undefined}
      />
    ),
    root,
  );

  const button = root.querySelector<HTMLButtonElement>("[aria-label='Add checkpoint']")!;
  button.click();
  button.click();
  expect(button.disabled).toBe(true);
  expect(button.getAttribute("aria-busy")).toBe("true");
  expect(checkpoint).toHaveBeenCalledOnce();
  release();
  await pending;
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(button.disabled).toBe(false);
  dispose();
  root.remove();
});
