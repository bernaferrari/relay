import { describe, expect, it } from "vitest";
import { reviewDocumentLocation, testDocumentSurface } from "./test-document-surface";

describe("test document surface", () => {
  it("gives live review the stage even when a historical Run is also in the URL", () => {
    expect(
      testDocumentSurface({
        view: "review",
        run: "run-184",
        recordingId: "workflow-1",
      }),
    ).toEqual({ kind: "review", recordingId: "workflow-1" });
  });

  it("keeps a historical Run when review is not the live surface", () => {
    expect(testDocumentSurface({ run: "run-184" })).toEqual({
      kind: "historical-run",
      runId: "run-184",
    });
    expect(testDocumentSurface({ view: "review" })).toEqual({ kind: "current-test" });
  });

  it("returns the Test document location for recording review", () => {
    expect(reviewDocumentLocation({ kind: "new" })).toEqual({
      to: "/tests/new",
      search: { view: "review" },
    });
    expect(reviewDocumentLocation({ kind: "test", testId: "test-1" })).toEqual({
      to: "/tests/$testId",
      params: { testId: "test-1" },
      search: { view: "review" },
    });
  });
});
