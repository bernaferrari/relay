import { expect, test, vi } from "vitest";
import { render } from "solid-js/web";
import type { AppMap } from "@relay/protocol";

const recorderMock = vi.hoisted(() => ({ current: undefined as unknown }));
vi.mock("../context/recorder", () => ({ useRecorder: () => recorderMock.current }));
vi.mock("../context/toast", () => ({ toast: vi.fn() }));
vi.mock("./device-companion-stage", () => ({
  DeviceCompanionStage: () => <div>Device preview</div>,
}));

import { AppMapTestRecordingPanel } from "./app-map-test-recording-panel";

function mapFixture(): AppMap {
  return {
    schemaVersion: 1,
    id: "map",
    organizationId: "org",
    projectId: "project",
    name: "App",
    revision: 1,
    notes: {},
    groups: {},
    screens: {},
    screenVariants: {},
    connections: {},
    caseStacks: {},
    variables: {},
    tests: {},
    combines: {},
    routines: {},
    flows: {},
    runs: {},
    targetResults: {},
    proposals: {},
    activity: {},
    createdAt: 1,
    updatedAt: 1,
  };
}

function recorderFixture(canRetire: boolean) {
  return {
    authoringNeedsAttention: () => true,
    recordingIssue: () => ({ kind: "screen", message: "Recording start could not be proven" }),
    recording: () => false,
    take: () => null,
    arming: () => false,
    canRetireRecordingAttempt: () => canRetire,
    retireRecordingAttempt: vi.fn(async () => true),
    inspectRecording: vi.fn(async () => false),
  };
}

test("offers retirement only for an explicitly retireable unproven recording start", async () => {
  const recorder = recorderFixture(true);
  recorderMock.current = recorder;
  const originalConfirm = globalThis.confirm;
  globalThis.confirm = vi.fn(() => true);
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <AppMapTestRecordingPanel
        appMap={mapFixture()}
        onTestCreated={() => undefined}
        onOpenTargets={() => undefined}
      />
    ),
    root,
  );

  const retire = Array.from(root.querySelectorAll("button")).find(
    (button) => button.textContent?.trim() === "Retire attempt",
  );
  expect(retire).toBeTruthy();
  retire!.click();
  await Promise.resolve();
  expect(globalThis.confirm).toHaveBeenCalledWith(
    "Retire this unproven recording attempt? No proven recording or Test will be deleted.",
  );
  expect(recorder.retireRecordingAttempt).toHaveBeenCalledOnce();

  dispose();
  root.remove();
  globalThis.confirm = originalConfirm;
});

test("keeps retirement hidden for inspectable recording uncertainty", () => {
  recorderMock.current = recorderFixture(false);
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => (
      <AppMapTestRecordingPanel
        appMap={mapFixture()}
        onTestCreated={() => undefined}
        onOpenTargets={() => undefined}
      />
    ),
    root,
  );

  expect(root.textContent).not.toContain("Retire attempt");
  expect(root.textContent).toContain("Inspect recording");
  dispose();
  root.remove();
});
