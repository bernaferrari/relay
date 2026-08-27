import assert from "node:assert/strict";
import test from "node:test";
import type { AppMap } from "@relay/protocol";
import type { useRecorder } from "../context/recorder.js";
import type { useServer } from "../context/server.js";
import { createStudioBlankMapActions } from "./studio-blank-map-actions.js";

const blankMap = { id: "new-map", name: "My map", revision: 0 } as AppMap;

test("Record test bootstraps the hidden App Map and starts authoring in Test", async () => {
  const events: string[] = [];
  let creating = false;
  let openedMapId: string | undefined;
  const actions = createStudioBlankMapActions({
    server: {
      selectedLeaseId: () => "lease-1",
      controlIssue: () => null,
      appMaps: () => [],
      createAppMap: async () => {
        events.push("create-map");
        return blankMap;
      },
      refreshAppMaps: async () => {
        events.push("refresh-maps");
      },
      runAction: async () => undefined,
    } as unknown as ReturnType<typeof useServer>,
    recorder: {
      enterRecordMode: async () => {
        assert.equal(openedMapId, blankMap.id);
        events.push("record");
        return true;
      },
      recording: () => true,
      authoringNeedsAttention: () => false,
    } as unknown as ReturnType<typeof useRecorder>,
    creating: () => creating,
    setCreating: (value) => (creating = typeof value === "function" ? value(creating) : value),
    targetReady: () => true,
    openDevicePicker: () => events.push("choose-target"),
    openWorkspace: (mapId, mode) => {
      openedMapId = mapId;
      events.push(`open-${mode}`);
    },
    clearWorkspace: () => events.push("clear"),
  });

  await actions.record();

  assert.deepEqual(events, ["create-map", "refresh-maps", "open-test", "record"]);
  assert.equal(creating, false);
});

test("an uncertain first recording keeps its new App Map for canonical recovery", async () => {
  const events: string[] = [];
  const actions = createStudioBlankMapActions({
    server: {
      selectedLeaseId: () => "lease-1",
      controlIssue: () => null,
      appMaps: () => [],
      createAppMap: async () => blankMap,
      refreshAppMaps: async () => events.push("refresh"),
      runAction: async (id: string) => events.push(id),
    } as unknown as ReturnType<typeof useServer>,
    recorder: {
      enterRecordMode: async () => false,
      recording: () => false,
      authoringNeedsAttention: () => true,
    } as unknown as ReturnType<typeof useRecorder>,
    creating: () => false,
    setCreating: () => undefined,
    targetReady: () => true,
    openDevicePicker: () => undefined,
    openWorkspace: (_mapId, mode) => events.push(`open-${mode}`),
    clearWorkspace: () => events.push("clear"),
  });

  await actions.record();

  assert.deepEqual(events, ["refresh", "open-test"]);
});
