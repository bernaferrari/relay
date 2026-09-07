import { RecordingActionIcon } from "./recording-action-icon";
/** @jsxImportSource react */
import type { AuthoringRawOptimizationProposalResponse } from "@relay/protocol";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Button } from "@relay/ui-react/components/button";
import { MoreHorizontal, Sparkles, Target } from "lucide-react";
import { EmptyState } from "../components/product-patterns";
import {
  recordedMomentCount,
  reviewActionCopy,
  type ReviewAction,
} from "./recording-review-presentation";

type OptimizationSuggestion = NonNullable<
  AuthoringRawOptimizationProposalResponse["proposal"]
>["suggestions"][number];

export function RecordingEvidencePanel({
  action,
  evidenceRole,
  previewUrl,
  onEvidenceRoleChange,
}: {
  action?: ReviewAction;
  evidenceRole: "entrance" | "exit";
  previewUrl: string | null;
  onEvidenceRoleChange(role: "entrance" | "exit"): void;
}) {
  return (
    <section
      className="grid h-full min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)] self-start p-3 text-card-foreground"
      aria-labelledby="recording-evidence-title"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="recording-evidence-title" className="flex items-center gap-2 text-sm font-medium">
          {action ? (
            <>
              <RecordingActionIcon action={action} />
              {reviewActionCopy(action).title}
            </>
          ) : (
            "Step preview"
          )}
        </h2>
        <div
          className="inline-flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5"
          aria-label="Evidence moment"
        >
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-pressed={evidenceRole === "entrance"}
            onClick={() => onEvidenceRoleChange("entrance")}
            className="text-xs text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            Before
          </Button>
          <Button
            size="sm"
            variant="ghost"
            type="button"
            aria-pressed={evidenceRole === "exit"}
            onClick={() => onEvidenceRoleChange("exit")}
            className="text-xs text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
          >
            After
          </Button>
        </div>
      </div>
      <div className="mt-3 flex min-h-0 items-center justify-center overflow-hidden rounded-lg bg-background/40 p-2">
        {previewUrl ? (
          <img
            className="h-full max-h-full max-w-full rounded-md object-contain"
            src={previewUrl}
            alt={`${evidenceRole} evidence for ${action?.intent}`}
          />
        ) : (
          <div className="grid max-w-[22ch] justify-items-center gap-2 p-6 text-center text-muted-foreground">
            <Target aria-hidden="true" />
            <strong className="text-[13px] text-foreground">
              {action ? "No visual frame for this moment" : "Select an action"}
            </strong>
            <span className="text-[11px] leading-normal">
              {action
                ? "Choose another step or switch between Before and After."
                : "Its before and after frames will appear here."}
            </span>
          </div>
        )}
      </div>
    </section>
  );
}

export function RecordingActionsPanel({
  actions,
  selectedActionIds,
  optimization,
  canOptimize,
  editing,
  onOptimize,
  onSelect,
  onToggle,
}: {
  actions: readonly ReviewAction[];
  selectedActionIds: readonly string[];
  optimization: {
    isFetching: boolean;
    isFetched: boolean;
    suggestions: readonly OptimizationSuggestion[];
  };
  canOptimize: boolean;
  editing: boolean;
  onOptimize(): void;
  onSelect(actionId: string): void;
  onToggle(actionId: string, checked: boolean): void;
}) {
  let actionOrdinal = 0;
  return (
    <section
      className="min-w-0 overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
      aria-labelledby="recording-actions-title"
    >
      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-3.5 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2 id="recording-actions-title">{recordedMomentCount(actions.length)}</h2>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onOptimize}
              disabled={!canOptimize || optimization.isFetching}
            >
              <Sparkles aria-hidden="true" />
              {optimization.isFetching ? "Checking…" : "Find cleanup"}
            </Button>
          ) : null}
        </div>
      </div>

      {editing && optimization.suggestions.length ? (
        <div
          className="grid gap-1.5 border-b border-border bg-muted p-3"
          aria-label="Cleanup suggestions"
        >
          <div className="grid gap-0.5">
            <strong className="text-xs">
              {optimization.suggestions.length} review-only suggestions
            </strong>
            <span className="text-[11px] text-muted-foreground">
              Relay will never apply these automatically.
            </span>
          </div>
          {optimization.suggestions.map((suggestion) => (
            <button
              type="button"
              key={suggestion.rawEventId}
              onClick={() => onSelect(suggestion.actionId)}
            >
              <Sparkles aria-hidden="true" />
              <span>{suggestion.reason}</span>
            </button>
          ))}
        </div>
      ) : editing && optimization.isFetched ? (
        <p className="border-b border-border p-3 text-[11px] text-muted-foreground" role="status">
          No safe cleanup suggestions for this revision.
        </p>
      ) : null}

      {actions.length ? (
        <ScrollArea className="max-h-[min(62vh,700px)]">
          <ol className="px-4" aria-label="Recorded actions">
            {actions.map((step) => {
              const copy = reviewActionCopy(step);
              const ordinal = copy.kind === "pause" ? actionOrdinal : ++actionOrdinal;
              const selected = selectedActionIds.includes(step.id);
              return (
                <li
                  className={`relay-review-step grid min-h-[52px] grid-cols-[auto_28px_minmax(0,1fr)] items-center gap-2 border-t border-border py-2 ${selected ? "bg-muted/60" : ""}`}
                  key={step.id}
                >
                  {editing ? (
                    <Checkbox
                      checked={selected}
                      onCheckedChange={(checked) => onToggle(step.id, checked)}
                      aria-label={`Select ${copy.title}`}
                    />
                  ) : (
                    <span />
                  )}
                  <span
                    className="grid size-7 place-items-center rounded-full border border-border bg-muted text-foreground shadow-sm"
                    aria-hidden="true"
                  >
                    {copy.kind === "pause" ? <MoreHorizontal /> : ordinal}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => onSelect(step.id)}
                  >
                    <span className="flex items-center gap-2">
                      <RecordingActionIcon action={step} />
                      <strong className="text-sm font-medium">{copy.title}</strong>
                    </span>
                    {step.proofStatus === "unresolved" ? (
                      <p className="text-xs text-muted-foreground">Needs review</p>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      ) : (
        <EmptyState
          title="No steps yet"
          detail="Go back to recording and interact with the app before saving this Test."
        />
      )}
    </section>
  );
}
