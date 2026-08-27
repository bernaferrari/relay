import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import { StageRecordingControls } from "./stage-chrome";

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
