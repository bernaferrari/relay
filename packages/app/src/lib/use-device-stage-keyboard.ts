import { onCleanup, type Accessor } from "solid-js";
import { useCommand } from "../context/command";
import { useRecorder } from "../context/recorder";

/** Routes unmodified keys to a focused live device while respecting UI input focus. */
export function useDeviceStageKeyboard(options: {
  controlActive: Accessor<boolean>;
  screenElement: Accessor<HTMLImageElement | undefined>;
}) {
  const command = useCommand();
  const recorder = useRecorder();
  const onDriveKey = (event: KeyboardEvent) => {
    if (!options.controlActive() || command.modalOpen()) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const activeElement = typeof document !== "undefined" ? document.activeElement : null;
    if (!recorder.recording() && activeElement !== options.screenElement()) return;
    if (
      activeElement &&
      (activeElement.tagName === "INPUT" ||
        activeElement.tagName === "TEXTAREA" ||
        (activeElement as HTMLElement).isContentEditable)
    )
      return;
    if (recorder.feedTypeKey(event)) event.preventDefault();
  };
  window.addEventListener("keydown", onDriveKey);
  onCleanup(() => window.removeEventListener("keydown", onDriveKey));
}
