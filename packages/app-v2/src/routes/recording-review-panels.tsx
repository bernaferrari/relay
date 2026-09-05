/** @jsxImportSource react */
import type { AuthoringRawOptimizationProposalResponse } from "@relay/protocol";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Button } from "@relay/ui-react/components/button";
import { Image as ImageIcon, MoreHorizontal, Sparkles, Target } from "lucide-react";
import { EmptyState } from "../components/product-patterns";
import {
  captureSummary,
  formatDuration,
  proofLabel,
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
    <section className="min-w-0 self-start rounded-xl border border-border bg-card p-4 text-card-foreground shadow-sm" aria-labelledby="recording-evidence-title">
      <div className="flex flex-wrap items-center justify-between gap-3.5">
        <div>
          <p className="relay-section-label">Evidence</p>
          <h2 id="recording-evidence-title">Selected moment</h2>
        </div>
        <ImageIcon className="w-[17px] text-muted-foreground" aria-hidden="true" />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-0.5 rounded-md bg-muted p-0.5" aria-label="Evidence moment">
        <button
          type="button"
          aria-pressed={evidenceRole === "entrance"}
          onClick={() => onEvidenceRoleChange("entrance")}
          className="min-h-9 rounded-[calc(var(--radius-md)-2px)] text-xs font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          Before
        </button>
        <button
          type="button"
          aria-pressed={evidenceRole === "exit"}
          onClick={() => onEvidenceRoleChange("exit")}
          className="min-h-9 rounded-[calc(var(--radius-md)-2px)] text-xs font-medium text-muted-foreground aria-pressed:bg-card aria-pressed:text-foreground aria-pressed:shadow-sm"
        >
          After
        </button>
      </div>
      <div className="mt-2.5 grid aspect-[4/5] place-items-center overflow-hidden rounded-lg border border-border bg-[radial-gradient(circle_at_50%_20%,color-mix(in_srgb,white_7%,transparent),transparent_42%),oklch(0.19_0.008_255)]">
        {previewUrl ? (
          <img src={previewUrl} alt={`${evidenceRole} evidence for ${action?.intent}`} />
        ) : (
          <div className="grid max-w-[22ch] justify-items-center gap-2 p-6 text-center text-[oklch(0.8_0.008_255)]">
            <Target aria-hidden="true" />
            <strong className="text-[13px] text-[oklch(0.94_0.005_255)]">{action ? "No visual frame for this moment" : "Select an action"}</strong>
            <span className="text-[11px] leading-normal">
              {action
                ? "The captured proof is still listed below."
                : "Its before and after proof will appear here."}
            </span>
          </div>
        )}
      </div>
      {action ? (
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Proof</dt>
            <dd className="mt-0.5 truncate text-[11px] text-foreground">{action.proofStatus ? proofLabel(action.proofStatus) : "Review"}</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Evidence</dt>
            <dd className="mt-0.5 truncate text-[11px] text-foreground">{action.evidenceCount ?? action.evidenceIds?.length ?? 0} items</dd>
          </div>
          <div>
            <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">Duration</dt>
            <dd className="mt-0.5 truncate text-[11px] text-foreground">{formatDuration(action.durationMs ?? 0)}</dd>
          </div>
        </dl>
      ) : null}
    </section>
  );
}

export function RecordingActionsPanel({
  actions,
  selectedActionIds,
  optimization,
  canOptimize,
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
  onOptimize(): void;
  onSelect(actionId: string): void;
  onToggle(actionId: string, checked: boolean): void;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm" aria-labelledby="recording-actions-title">
      <div className="flex min-h-[72px] flex-wrap items-center justify-between gap-3.5 border-b border-border px-4 py-3">
        <div>
          <p className="relay-section-label">Journey</p>
          <h2 id="recording-actions-title">{recordedMomentCount(actions.length)}</h2>
        </div>
        <div className="flex items-center justify-end gap-2">
          <span className="whitespace-nowrap text-[11px] text-muted-foreground">{captureSummary(actions)}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={onOptimize}
            disabled={!canOptimize || optimization.isFetching}
          >
            <Sparkles aria-hidden="true" />
            {optimization.isFetching ? "Checking…" : "Find cleanup"}
          </Button>
        </div>
      </div>

      {optimization.suggestions.length ? (
        <div className="grid gap-1.5 border-b border-border bg-muted p-3" aria-label="Cleanup suggestions">
          <div className="grid gap-0.5">
            <strong className="text-xs">{optimization.suggestions.length} review-only suggestions</strong>
            <span className="text-[11px] text-muted-foreground">Relay will never apply these automatically.</span>
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
      ) : optimization.isFetched ? (
        <p className="relay-recording-suggestions-empty" role="status">
          No safe cleanup suggestions for this revision.
        </p>
      ) : null}

      {actions.length ? (
        <ScrollArea className="relay-review-actions-scroll">
          <ol className="relay-review-steps" aria-label="Recorded actions">
            {actions.map((step, index) => {
              const copy = reviewActionCopy(step);
              const ordinal = actions
                .slice(0, index + 1)
                .filter((candidate) => reviewActionCopy(candidate).kind !== "pause").length;
              const selected = selectedActionIds.includes(step.id);
              return (
                <li
                  className={`relay-review-step relay-review-step--${copy.kind}${selected ? " relay-review-step--selected" : ""}`}
                  key={step.id}
                >
                  <Checkbox
                    checked={selected}
                    onCheckedChange={(checked) => onToggle(step.id, checked)}
                    aria-label={`Select ${copy.title}`}
                  />
                  <span className="relay-review-step-number" aria-hidden="true">
                    {copy.kind === "pause" ? <MoreHorizontal /> : ordinal}
                  </span>
                  <button
                    type="button"
                    className="relay-review-step-copy"
                    onClick={() => onSelect(step.id)}
                  >
                    <strong>{copy.title}</strong>
                    <p>{copy.detail}</p>
                  </button>
                </li>
              );
            })}
          </ol>
        </ScrollArea>
      ) : (
        <EmptyState
          title="No recorded moments are available"
          detail="Return to recording and interact with the app before saving this Test."
        />
      )}
    </section>
  );
}
