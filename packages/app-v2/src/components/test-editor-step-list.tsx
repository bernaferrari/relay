/** @jsxImportSource react */
import type { AppMapScenarioTest } from "@relay/protocol";
import type { PlanPlatform } from "@relay/product/test-route-platforms";
import { Button } from "@relay/ui-react/components/button";
import { ArrowDown, ArrowUp, ChevronRight, GripVertical } from "lucide-react";
import type { CSSProperties, RefObject } from "react";
import { EmptyState } from "./product-patterns";
import { TestEditorRoutes } from "./test-editor-routes";
import { stepKindLabel, stepReadinessLabel, type StepEntry } from "./test-editor-step";

function branchLabel(placement: StepEntry["placement"]): string {
  if (placement?.branch === "then") return "Then branch";
  if (placement?.branch === "else") return "Else branch";
  if (placement?.branch === "steps") return "Repeated steps";
  return "Main path";
}

export function TestEditorStepOutline({
  test,
  recordedPlatforms,
  entries,
  selectedStepId,
  busy,
  draggedStepId,
  onAdd,
  onSelect,
  onMove,
  onDrop,
}: {
  test: AppMapScenarioTest;
  recordedPlatforms?: readonly PlanPlatform[];
  entries: readonly StepEntry[];
  selectedStepId?: string;
  busy: boolean;
  draggedStepId: RefObject<string | undefined>;
  onAdd(): void;
  onSelect(stepId: string): void;
  onMove(entry: StepEntry, delta: -1 | 1): void;
  onDrop(entry: StepEntry, after: boolean): void;
}) {
  return (
    <section className="min-w-0" aria-labelledby="test-steps-title">
      <div className="flex items-end justify-between gap-5 max-[620px]:items-start max-[620px]:gap-3">
        <div>
          <h2 id="test-steps-title">Steps</h2>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {entries.length === 1 ? "1 step" : `${entries.length} steps`}
          </span>
          <Button size="sm" variant="outline" onClick={onAdd} disabled={busy}>
            Add step
          </Button>
        </div>
      </div>
      {entries.length ? (
        <ol className="mt-4 grid list-none gap-1.5 p-0">
          {entries.map((entry) => (
            <li key={entry.step.id} style={{ "--step-depth": entry.depth } as CSSProperties}>
              <div
                id={`test-step-${entry.step.id}`}
                className="grid min-h-14 min-w-0 grid-cols-[minmax(0,1fr)_36px] items-stretch rounded-lg border border-border bg-card transition-colors hover:border-input hover:bg-muted/40 data-[selected=true]:border-primary/40 data-[selected=true]:bg-primary/5 data-[selected=true]:shadow-[0_0_0_1px_color-mix(in_srgb,var(--primary)_10%,transparent)]"
                data-selected={selectedStepId === entry.step.id}
                draggable={!busy}
                tabIndex={0}
                onDragStart={() => {
                  draggedStepId.current = entry.step.id;
                }}
                onDragEnd={() => {
                  draggedStepId.current = undefined;
                }}
                onDragOver={(event) => {
                  if (draggedStepId.current && entry.siblingIds.includes(draggedStepId.current))
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const bounds = event.currentTarget.getBoundingClientRect();
                  onDrop(entry, event.clientY > bounds.top + bounds.height / 2);
                }}
                onKeyDown={(event) => {
                  if (!event.altKey) return;
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    onMove(entry, event.key === "ArrowUp" ? -1 : 1);
                  }
                }}
              >
                <button
                  className="grid min-h-14 min-w-0 grid-cols-[14px_24px_minmax(0,1fr)_12px] items-center gap-1.5 border-0 bg-transparent p-2 text-left text-inherit"
                  type="button"
                  onClick={() => onSelect(entry.step.id)}
                  aria-pressed={selectedStepId === entry.step.id}
                >
                  <GripVertical
                    className="size-4 cursor-grab text-muted-foreground"
                    aria-hidden="true"
                  />
                  <span className="grid size-7 place-items-center rounded-full border border-border bg-background text-[10px] tabular-nums text-muted-foreground">
                    {entry.number}
                  </span>
                  <span className="min-w-0">
                    <strong className="block overflow-hidden text-xs font-semibold break-words">
                      {entry.step.intent}
                    </strong>
                    <small className="mt-0.5 block overflow-hidden text-[10px] text-muted-foreground break-words">
                      {entry.placement ? `${branchLabel(entry.placement)} · ` : ""}
                      {stepKindLabel(entry.step)} ·{" "}
                      {stepReadinessLabel(entry.step, {
                        unrecordedNative: Boolean(
                          recordedPlatforms?.length &&
                          !recordedPlatforms.includes("android") &&
                          !recordedPlatforms.includes("ios"),
                        ),
                      })}
                    </small>
                  </span>
                  <ChevronRight className="size-3.5 text-muted-foreground" aria-hidden="true" />
                </button>
                <span className="grid grid-cols-1 border-l border-border">
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onMove(entry, -1)}
                    disabled={entry.index === 0 || busy}
                    aria-label={`Move ${entry.step.intent} up`}
                  >
                    <ArrowUp aria-hidden="true" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onMove(entry, 1)}
                    disabled={entry.index === entry.siblingIds.length - 1 || busy}
                    aria-label={`Move ${entry.step.intent} down`}
                  >
                    <ArrowDown aria-hidden="true" />
                  </Button>
                </span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="This Test has no steps"
          detail="Record this Test again to give Relay steps to repeat."
        />
      )}
      <div className="mt-5">
        <TestEditorRoutes test={test} recordedPlatforms={recordedPlatforms} />
      </div>
    </section>
  );
}
