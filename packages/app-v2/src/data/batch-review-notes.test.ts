import { describe, expect, it } from "vitest";
import { appendBatchReviewNote, notesForCase, parseBatchReviewNotes } from "./batch-review-notes";

describe("batch review notes", () => {
  it("appends a trimmed note and keeps it bound to the case", () => {
    const notes = appendBatchReviewNote([], {
      caseId: "login-ios",
      text: "  Reproduced on Firefox  ",
      at: 10,
      actorId: "human:qa",
    });
    expect(notesForCase(notes, "login-ios")).toEqual([
      {
        caseId: "login-ios",
        text: "Reproduced on Firefox",
        at: 10,
        actorId: "human:qa",
      },
    ]);
    expect(notesForCase(notes, "other")).toEqual([]);
    expect(appendBatchReviewNote(notes, { ...notes[0]!, text: "   " })).toEqual(notes);
  });

  it("restores saved notes and ignores malformed rows", () => {
    expect(
      parseBatchReviewNotes(
        JSON.stringify([
          { caseId: "login-ios", text: "Need HAR", at: 1, actorId: "human:qa" },
          { caseId: "x" },
        ]),
      ),
    ).toEqual([{ caseId: "login-ios", text: "Need HAR", at: 1, actorId: "human:qa" }]);
    expect(parseBatchReviewNotes(null)).toEqual([]);
  });
});
