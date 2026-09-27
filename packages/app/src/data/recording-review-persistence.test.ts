import { describe, expect, it } from "vitest";
import { reviewPersistence, reviewVerificationLabel } from "./recording-review-persistence";

describe("recording review persistence", () => {
  it("treats a name change as metadata after the recording is verified", () => {
    expect(
      reviewPersistence({
        nameSaveState: "dirty",
        nameChanged: true,
        canApprove: true,
        replayRequired: false,
        replayOutcome: "passed",
        transitionPending: false,
        leavePending: false,
        failed: false,
      }),
    ).toMatchObject({
      kind: "name-only",
      label: "Name updated — recorded steps are unchanged",
    });
  });

  it("keeps a locally saved name change as metadata, not an unsaved executable edit", () => {
    expect(
      reviewPersistence({
        nameSaveState: "saved",
        nameChanged: true,
        canApprove: true,
        replayRequired: false,
        replayOutcome: "passed",
        transitionPending: false,
        leavePending: false,
        failed: false,
      }),
    ).toMatchObject({
      kind: "name-only",
      editorState: "saved",
    });
  });

  it("reports Saving while the local name write is in progress", () => {
    expect(
      reviewPersistence({
        nameSaveState: "saving",
        nameChanged: true,
        canApprove: true,
        replayRequired: false,
        replayOutcome: "passed",
        transitionPending: false,
        leavePending: false,
        failed: false,
      }),
    ).toMatchObject({ kind: "saving", editorState: "saving" });
  });

  it("keeps verification separate from the save state", () => {
    expect(reviewVerificationLabel("verified")).toBe("Verified on the selected configuration");
    expect(reviewVerificationLabel("changed-since-verified")).toBe("Changed since last run");
    expect(reviewVerificationLabel("saving")).toBeUndefined();
    expect(reviewVerificationLabel("saved")).toBeUndefined();
  });

  it("does not treat a verified recording as unsaved just because the name is local", () => {
    expect(
      reviewPersistence({
        nameSaveState: "saved",
        nameChanged: false,
        canApprove: true,
        replayRequired: false,
        replayOutcome: "passed",
        transitionPending: false,
        leavePending: false,
        failed: false,
      }).kind,
    ).toBe("verified");
  });

  it("separates a later edit from the last passing replay", () => {
    expect(
      reviewPersistence({
        nameSaveState: "saved",
        canApprove: false,
        replayRequired: true,
        replayOutcome: "passed",
        transitionPending: false,
        leavePending: false,
        failed: false,
      }).kind,
    ).toBe("changed-since-verified");
  });

  it("keeps an unverified recording as ready for review, not a second save model", () => {
    expect(
      reviewPersistence({
        nameSaveState: "saved",
        canApprove: false,
        replayRequired: true,
        replayOutcome: "failed",
        transitionPending: false,
        leavePending: false,
        failed: false,
      }),
    ).toMatchObject({
      kind: "ready-for-review",
      label: "Ready for review",
    });
  });
});
