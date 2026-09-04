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
    <section className="relay-recording-evidence" aria-labelledby="recording-evidence-title">
      <div className="relay-recording-panel-heading">
        <div>
          <p className="relay-section-label">Evidence</p>
          <h2 id="recording-evidence-title">Selected moment</h2>
        </div>
        <ImageIcon aria-hidden="true" />
      </div>
      <div className="relay-recording-evidence-toggle" aria-label="Evidence moment">
        <button
          type="button"
          aria-pressed={evidenceRole === "entrance"}
          onClick={() => onEvidenceRoleChange("entrance")}
        >
          Before
        </button>
        <button
          type="button"
          aria-pressed={evidenceRole === "exit"}
          onClick={() => onEvidenceRoleChange("exit")}
        >
          After
        </button>
      </div>
      <div className="relay-recording-evidence-frame">
        {previewUrl ? (
          <img src={previewUrl} alt={`${evidenceRole} evidence for ${action?.intent}`} />
        ) : (
          <div className="relay-recording-evidence-empty">
            <Target aria-hidden="true" />
            <strong>{action ? "No visual frame for this moment" : "Select an action"}</strong>
            <span>
              {action
                ? "The captured proof is still listed below."
                : "Its before and after proof will appear here."}
            </span>
          </div>
        )}
      </div>
      {action ? (
        <dl className="relay-recording-evidence-facts">
          <div>
            <dt>Proof</dt>
            <dd>{action.proofStatus ? proofLabel(action.proofStatus) : "Review"}</dd>
          </div>
          <div>
            <dt>Evidence</dt>
            <dd>{action.evidenceCount ?? action.evidenceIds?.length ?? 0} items</dd>
          </div>
          <div>
            <dt>Duration</dt>
            <dd>{formatDuration(action.durationMs ?? 0)}</dd>
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
    <section className="relay-recording-actions" aria-labelledby="recording-actions-title">
      <div className="relay-recording-panel-heading relay-recording-actions-heading">
        <div>
          <p className="relay-section-label">Journey</p>
          <h2 id="recording-actions-title">{recordedMomentCount(actions.length)}</h2>
        </div>
        <div className="relay-recording-heading-actions">
          <span>{captureSummary(actions)}</span>
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
        <div className="relay-recording-suggestions" aria-label="Cleanup suggestions">
          <div>
            <strong>{optimization.suggestions.length} review-only suggestions</strong>
            <span>Relay will never apply these automatically.</span>
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
