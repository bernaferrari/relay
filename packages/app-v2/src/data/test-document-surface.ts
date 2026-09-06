import { useQuery } from "@tanstack/react-query";
import type { Platform } from "../platform/types";
import { recordingQueryKeys } from "./recording-queries";
import { readWorkflowPointer } from "./workflow-pointer";

export type TestDocumentSurface =
  | { kind: "review"; recordingId: string }
  | { kind: "historical-run"; runId: string }
  | { kind: "current-test" };

/** Live review owns the stage. A historical Run is a separate selection. */
export function testDocumentSurface(input: {
  view?: unknown;
  run?: unknown;
  recordingId?: string;
}): TestDocumentSurface {
  const recordingId = input.recordingId?.trim();
  if (input.view === "review" && recordingId) {
    return { kind: "review", recordingId };
  }
  const runId = typeof input.run === "string" ? input.run.trim() : "";
  return runId ? { kind: "historical-run", runId } : { kind: "current-test" };
}

export function reviewDocumentLocation(
  destination: { kind: "new" } | { kind: "test"; testId: string },
):
  | { to: "/tests/new"; search: { view: "review" } }
  | { to: "/tests/$testId"; params: { testId: string }; search: { view: "review" } } {
  if (destination.kind === "test") {
    return {
      to: "/tests/$testId",
      params: { testId: destination.testId },
      search: { view: "review" },
    };
  }
  return { to: "/tests/new", search: { view: "review" } };
}

export function useTestDocumentReview(platform: Platform, view: unknown): string | undefined {
  const pointer = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => (await readWorkflowPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const surface = testDocumentSurface({
    view,
    recordingId: pointer.data ?? undefined,
  });
  return surface.kind === "review" ? surface.recordingId : undefined;
}
