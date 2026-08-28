import type { AppMap } from "@relay/protocol";
import { toast } from "../context/toast";
import { humanError } from "./human-error";

/** Save the first screen for the active Test without requiring the Map canvas
 * to be mounted. The caller supplies canonical capture and refresh operations. */
export async function captureTestStartScreen(input: {
  appMapId?: string;
  capture: (appMapId: string, options: { title: string }) => Promise<{ appMap: AppMap } | null>;
  refresh: () => Promise<unknown>;
}): Promise<void> {
  if (!input.appMapId) return;
  try {
    const captured = await input.capture(input.appMapId, { title: "Start" });
    if (!captured) throw new Error("Relay could not capture the current screen");
    await input.refresh();
    toast("Starting screen saved · record what you do next", "success");
  } catch (error) {
    toast(humanError(error, "Could not save the start screen"), "warning");
  }
}
