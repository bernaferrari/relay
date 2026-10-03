import type { ProductRecordingDraft } from "@relay/product/recording-journey";
import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import { libraryRowSurface } from "../components/library-row-styles";
import { relativeTime } from "./test-library-presentation";

export function RecordingDraftList({ drafts }: { drafts: readonly ProductRecordingDraft[] }) {
  if (!drafts.length) return null;
  return (
    <ul
      className="m-0 grid list-none divide-y divide-border p-0"
      aria-label="Saved recording drafts"
    >
      {drafts.map((draft) => (
        <li key={draft.workflowId} className={libraryRowSurface}>
          <Link
            to="/recordings/$recordingId/review"
            params={{ recordingId: draft.workflowId }}
            className="flex min-h-16 items-center gap-4 px-3 py-3 focus-visible:outline-2 focus-visible:outline-ring"
          >
            <span className="grid min-w-0 flex-1 gap-0.5">
              <span className="text-sm text-foreground text-pretty">{draft.name}</span>
              <span className="text-xs text-muted-foreground">
                {draft.stepCount} {draft.stepCount === 1 ? "step" : "steps"} ·{" "}
                {relativeTime(draft.updatedAt)}
              </span>
            </span>
            <span className="text-sm text-muted-foreground">Review steps</span>
            <ChevronRight className="size-4 text-muted-foreground" aria-hidden="true" />
          </Link>
        </li>
      ))}
    </ul>
  );
}
