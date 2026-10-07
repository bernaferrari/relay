import { useEffect, useRef, useState } from "react";
import { Button } from "@relay/ui-react/components/button";
import { CircleAlert } from "lucide-react";
import type { AuthoringReview } from "@relay/workflows";
import type { ProductRecordingState } from "../data/recording-product-service";
import { RecordingProblem } from "./recording-shared";
import type { ReviewAction } from "./recording-review-presentation";
import { reviewInspectionRecovery, type DraftSaveAttempt } from "./recording-review-state";
import type { RecordingReviewOperation } from "./recording-review-error";

type FailedAction = NonNullable<NonNullable<AuthoringReview["latestReplay"]>["failedAction"]>;

export function useReviewInstruction(action?: Pick<ReviewAction, "id" | "intent">) {
  const [intent, setIntent] = useState("");
  const previousActionId = useRef<string | undefined>(undefined);
  const edited = useRef(false);
  useEffect(() => {
    const sameAction = previousActionId.current === action?.id;
    // A canonical refresh can acknowledge an earlier save while the editor
    // contains a newer local instruction. Keep that unsaved edit intact.
    setIntent((current) => {
      if (sameAction && edited.current && current !== action?.intent) return current;
      edited.current = false;
      return action?.intent ?? "";
    });
    previousActionId.current = action?.id;
  }, [action?.id, action?.intent]);
  return [
    intent,
    (value: string) => {
      edited.current = true;
      setIntent(value);
    },
  ] as const;
}

export function useReviewStatusRecovery(workflowId: string) {
  const attempt = useRef<DraftSaveAttempt | undefined>(undefined);
  return {
    beginDraftSave(reviewRevision?: number, rename?: DraftSaveAttempt["rename"]) {
      attempt.current =
        reviewRevision === undefined
          ? undefined
          : {
              workflowId,
              reviewRevision,
              ...(rename ? { rename: { ...rename } } : {}),
            };
    },
    clearDraftSave() {
      attempt.current = undefined;
    },
    inspectRecovered(state: ProductRecordingState | undefined) {
      return reviewInspectionRecovery(state, workflowId, attempt.current);
    },
  };
}

export function useReviewSelection(
  actions: readonly ReviewAction[],
  replay: AuthoringReview["latestReplay"],
  onSelection: (update: (current: readonly string[]) => readonly string[]) => void,
  onEvidence: (id: string | undefined) => void,
  onEdit: (editing: boolean) => void,
) {
  const handledFailure = useRef<string>("");
  useEffect(() => {
    const failure = replay?.failedAction;
    const key = failure ? `${replay.id}:${failure.actionId}` : "";
    if (
      failure &&
      key !== handledFailure.current &&
      actions.some((action) => action.id === failure.actionId)
    ) {
      handledFailure.current = key;
      onSelection(() => [failure.actionId]);
      onEvidence(failure.evidence[0]?.id);
      return;
    }
    onSelection((current) =>
      current.some((id) => actions.some((action) => action.id === id))
        ? current
        : actions.length
          ? [actions[0]!.id]
          : [],
    );
  }, [actions, replay, onSelection, onEvidence]);
  return (actionId: string) => {
    onSelection(() => [actionId]);
    onEvidence(
      replay?.failedAction?.actionId === actionId ? replay.failedAction.evidence[0]?.id : undefined,
    );
    onEdit(true);
  };
}

export function RecordingReplayFeedback({
  failure,
  diagnostic,
  canEdit,
  onEdit,
}: {
  failure: FailedAction;
  diagnostic?: string;
  canEdit: boolean;
  onEdit(): void;
}) {
  return (
    <div
      role="alert"
      className="mx-4 flex items-start gap-3 rounded-lg bg-muted/40 px-3 py-2 text-sm"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          Step {failure.ordinal} · {failure.intent}
        </p>
        <p className="text-muted-foreground">{failure.detail}</p>
        {diagnostic ? <ReplayDiagnostic diagnostic={diagnostic} /> : null}
      </div>
      <Button size="sm" variant="outline" disabled={!canEdit} onClick={onEdit}>
        Edit step
      </Button>
    </div>
  );
}

function ReplayDiagnostic({ diagnostic }: { diagnostic: string }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="mt-1 text-xs text-muted-foreground"
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary className="cursor-pointer">Details</summary>
      {open ? (
        <pre className="mt-1 max-h-28 whitespace-pre-wrap break-words">{diagnostic}</pre>
      ) : null}
    </details>
  );
}

export function RecordingReviewProblem({
  review,
  failure,
  error,
  recovery,
  canEdit,
  onEditFailure,
  onRetry,
  retrying,
  recover,
  reviewOperation = "inspect",
}: {
  review?: AuthoringReview;
  failure?: FailedAction;
  error?: unknown;
  recovery?: ProductRecordingState["recovery"];
  canEdit: boolean;
  onEditFailure(actionId: string): void;
  onRetry(): void;
  retrying: boolean;
  recover?: { pending: boolean; onRecover(): void };
  reviewOperation?: RecordingReviewOperation;
}) {
  return (
    <>
      {failure ? (
        <RecordingReplayFeedback
          failure={failure}
          diagnostic={review?.latestReplay?.error}
          canEdit={canEdit}
          onEdit={() => onEditFailure(failure.actionId)}
        />
      ) : null}
      <RecordingProblem
        layout={review ? "compact" : "centered"}
        className={review ? "mx-4" : "m-auto flex-1 w-full !max-w-none !mt-0"}
        error={error}
        recovery={failure ? undefined : recovery}
        onRetry={onRetry}
        retrying={retrying}
        operation="recording"
        reviewOperation={reviewOperation}
        action={
          recover ? (
            <Button size="sm" onClick={recover.onRecover} disabled={recover.pending}>
              {recover.pending ? "Opening saved steps…" : "Review saved steps"}
            </Button>
          ) : undefined
        }
      />
    </>
  );
}
