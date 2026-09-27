import { describe, expect, it } from "vitest";
import {
  controlsForAuthoringEvidence,
  pickRecordingEvidenceControl,
  projectRecordingEvidenceControls,
} from "./recording-evidence-target";

const nodes = [
  {
    identifier: "com.app:id/language",
    label: "Language",
    role: "button",
    rect: { x: 40, y: 200, width: 280, height: 56 },
  },
  {
    label: "Preferred language",
    role: "button",
    rect: { x: 48, y: 280, width: 240, height: 48 },
  },
  {
    text: "English",
    rect: { x: 48, y: 360, width: 120, height: 24 },
  },
  {
    label: "Hidden",
    visibleToUser: false,
    rect: { x: 0, y: 0, width: 400, height: 800 },
  },
];

describe("recording evidence target pick", () => {
  it("projects only visible labeled controls and prefers a stable identifier", () => {
    const controls = projectRecordingEvidenceControls(nodes);
    expect(controls.map((control) => control.target)).toEqual([
      { text: "English" },
      { label: "Preferred language" },
      { identifier: "com.app:id/language" },
    ]);
    expect(controls.find((control) => control.target.identifier)?.why).toContain(
      "stable identifier",
    );
  });

  it("picks the smallest control under a screenshot point", () => {
    const controls = projectRecordingEvidenceControls(nodes);
    const picked = pickRecordingEvidenceControl(controls, { x: 80, y: 300 });
    expect(picked?.target).toEqual({ label: "Preferred language" });
    expect(picked?.why).toContain("visible name");
  });

  it("does not invent a target when the click misses every control", () => {
    const controls = projectRecordingEvidenceControls(nodes);
    expect(pickRecordingEvidenceControl(controls, { x: 10, y: 10 })).toBeUndefined();
  });

  it("binds pickable controls to the observation that owns the screenshot", () => {
    expect(
      controlsForAuthoringEvidence(
        {
          observations: [
            {
              evidenceIds: ["other"],
              nodes: [{ label: "Wrong", rect: { x: 0, y: 0, width: 10, height: 10 } }],
            },
            { evidenceIds: ["shot-1"], nodes },
          ],
        },
        "shot-1",
      ).map((control) => control.name),
    ).toEqual(["English", "Preferred language", "Language"]);
  });
});

it("picks a uniquely identified parent before a translated text child", () => {
  const controls = projectRecordingEvidenceControls([
    { identifier: "app:id/settings", rect: { x: 0, y: 0, width: 300, height: 60 } },
    { text: "設定", rect: { x: 10, y: 10, width: 60, height: 24 } },
  ]);
  expect(pickRecordingEvidenceControl(controls, { x: 20, y: 20 })?.target).toEqual({
    identifier: "app:id/settings",
  });
});

it("does not offer repeated resource IDs as unique bindings", () => {
  const controls = projectRecordingEvidenceControls([
    {
      identifier: "android:id/title",
      label: "Internet",
      rect: { x: 0, y: 0, width: 300, height: 60 },
    },
    {
      identifier: "android:id/title",
      label: "Bluetooth",
      rect: { x: 0, y: 70, width: 300, height: 60 },
    },
  ]);
  expect(controls.map((c) => c.target)).toEqual([{ label: "Internet" }, { label: "Bluetooth" }]);
});
