import type { Accessor, Setter } from "solid-js";
import type { AppMap } from "@relay/protocol";
import type { useRecorder } from "../context/recorder";
import type { useServer } from "../context/server";
import { toast } from "../context/toast";
import { humanError } from "./human-error";
import { nextMapTitle } from "./studio-shell-preferences";

export function createStudioBlankMapActions(input: {
  server: ReturnType<typeof useServer>;
  recorder: ReturnType<typeof useRecorder>;
  creating: Accessor<boolean>;
  setCreating: Setter<boolean>;
  targetReady: Accessor<boolean>;
  openDevicePicker: () => void;
  openWorkspace: (mapId: string, mode: "map" | "test") => void;
  clearWorkspace: () => void;
}) {
  const canControl = () =>
    input.targetReady() && Boolean(input.server.selectedLeaseId()) && !input.server.controlIssue();

  async function removeFailedMap(map: AppMap): Promise<void> {
    await input.server.runAction("app-map.remove", { appMapId: map.id }).catch(() => undefined);
    await input.server.refreshAppMaps().catch(() => undefined);
    input.clearWorkspace();
  }

  async function capture(): Promise<void> {
    if (input.creating() || !canControl()) {
      if (!canControl()) input.openDevicePicker();
      return;
    }
    input.setCreating(true);
    let createdMap: AppMap | null = null;
    try {
      createdMap = await input.server.createAppMap(
        crypto.randomUUID(),
        nextMapTitle(input.server.appMaps()),
      );
      const captured = await input.recorder.captureMapScreen(createdMap.id, { title: "Start" });
      if (!captured) throw new Error("Relay could not capture the current screen");
      await input.server.refreshAppMaps();
      input.openWorkspace(captured.appMap.id, "map");
      toast("Starting screen saved · record what you do next", "success");
    } catch (error) {
      if (createdMap) await removeFailedMap(createdMap);
      toast(humanError(error, "Could not save the start screen"), "warning");
    } finally {
      input.setCreating(false);
    }
  }

  async function record(): Promise<void> {
    if (input.creating() || !canControl()) {
      if (!canControl()) input.openDevicePicker();
      return;
    }
    input.setCreating(true);
    let createdMap: AppMap | null = null;
    try {
      createdMap = await input.server.createAppMap(
        crypto.randomUUID(),
        nextMapTitle(input.server.appMaps()),
      );
      await input.server.refreshAppMaps();
      input.openWorkspace(createdMap.id, "test");
      if (!(await input.recorder.enterRecordMode())) {
        throw new Error("Relay could not start recording on the selected target");
      }
      toast("Recording Test · add checkpoints while you use the app", "success");
    } catch (error) {
      if (createdMap && !input.recorder.recording() && !input.recorder.authoringNeedsAttention()) {
        await removeFailedMap(createdMap);
      }
      toast(humanError(error, "Could not record the first Test"), "warning");
    } finally {
      input.setCreating(false);
    }
  }

  return { capture, record };
}
