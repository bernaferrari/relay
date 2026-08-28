import { expect, test } from "vitest";
import { render } from "solid-js/web";
import type { RecordingTake } from "../context/recorder";
import { RecordingReviewEvidence } from "./recording-review-evidence";

const pixel = "data:image/png;base64,iVBORw0KGgo=";

function takeFixture(): RecordingTake {
  return {
    id: "take",
    sessionId: "session",
    revision: 2,
    appMapId: "map",
    platform: "android",
    captureProvenance: { schemaVersion: 1, mode: "control-and-record", origin: "relay-control" },
    startedAt: 1,
    finishedAt: 2,
    group: "",
    state: "review",
    actionIds: ["tap", "checkpoint"],
    stepEvidenceUrls: [pixel],
    steps: [{ kind: "tap", target: { label: "Data controls" } }],
    actions: [
      {
        id: "tap",
        source: "captured",
        label: "Open Data controls",
        steps: [{ kind: "tap", target: { label: "Data controls" } }],
        stepStartIndex: 0,
        entranceEvidenceUrl: pixel,
        exitEvidenceUrl: pixel,
        entranceViewport: { width: 1080, height: 2400 },
        exitViewport: { width: 1080, height: 2400 },
        proof: { source: "replay", status: "verified", outcome: "passed" },
      },
      {
        id: "checkpoint",
        source: "manual",
        label: "Data controls checkpoint",
        steps: [],
        stepStartIndex: 1,
        evidenceUrl: pixel,
        entranceEvidenceUrl: pixel,
        exitEvidenceUrl: pixel,
        proof: { source: "recording", status: "verified" },
      },
    ],
  };
}

test("shows exact before-action-after proof for the selected recording action", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => <RecordingReviewEvidence take={takeFixture()} selectedActionId="tap" />,
    root,
  );

  expect(root.textContent).toContain("Recorded action proof");
  expect(root.textContent).toContain("Before");
  expect(root.textContent).toContain("Action");
  expect(root.textContent).toContain("After");
  expect(root.textContent).toContain("Open Data controls");
  expect(root.textContent).toContain("latest replay");
  expect(root.querySelectorAll("img")).toHaveLength(2);

  dispose();
  root.remove();
});

test("renders a selected checkpoint as the larger evidence decision", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const dispose = render(
    () => <RecordingReviewEvidence take={takeFixture()} selectedActionId="checkpoint" />,
    root,
  );

  expect(root.textContent).toContain("Checkpoint evidence");
  expect(root.textContent).toContain("Data controls checkpoint");
  expect(root.querySelector('[aria-label="Recorded action"]')?.className).toContain("min-h-44");

  dispose();
  root.remove();
});
