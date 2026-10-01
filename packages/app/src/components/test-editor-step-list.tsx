/** @jsxImportSource react */
import type { AppMapScenarioTest } from "@relay/protocol";
import type { PlanPlatform } from "@relay/product/test-route-platforms";
import { Button } from "@relay/ui-react/components/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@relay/ui-react/components/dropdown-menu";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { CSSProperties, ReactNode, RefObject } from "react";
import { EmptyState } from "./product-patterns";
import { TestEditorRoutes } from "./test-editor-routes";
import { stepReadinessLabel, type StepEntry } from "./test-editor-step";

function branchLabel(placement: StepEntry["placement"]): string {
  if (placement?.branch === "then") return "Then branch";
  if (placement?.branch === "else") return "Else branch";
  if (placement?.branch === "steps") return "Repeated steps";
  return "Main path";
}

function uniquePlatformBlockNotice(
  blockers: Readonly<Record<string, string>> | undefined,
): string | undefined {
  const reasons = [...new Set(Object.values(blockers ?? {}))];
  if (!reasons.length) return undefined;
  return `Compile fails closed on the recorded route: ${reasons.join("; ")}`;
}

export function TestEditorStepOutline({
  test,
  recordedPlatforms,
  routePlatformBlockers,
  stepPlatformBlockers,
  originEvidenceMissing,
  entries,
  selectedStepId,
  busy,
  draggedStepId,
  onAdd,
  onAddCheckpoint,
  onSelect,
  onMove,
  onDrop,
  selectedEditor,
  showDetails = false,
  headerAside,
}: {
  test: AppMapScenarioTest;
  recordedPlatforms?: readonly PlanPlatform[];
  routePlatformBlockers?: Partial<Record<PlanPlatform, string>>;
  stepPlatformBlockers?: Readonly<Record<string, string>>;
  originEvidenceMissing?: string;
  entries: readonly StepEntry[];
  selectedStepId?: string;
  busy: boolean;
  draggedStepId: RefObject<string | undefined>;
  onAdd(): void;
  onAddCheckpoint(): void;
  onSelect(stepId: string): void;
  onMove(entry: StepEntry, delta: -1 | 1): void;
  onDrop(entry: StepEntry, after: boolean): void;
  selectedEditor?: ReactNode;
  showDetails?: boolean;
  headerAside?: ReactNode;
}) {
  const compileBlockNotice = uniquePlatformBlockNotice(stepPlatformBlockers);
  return (
    <section className="min-w-0" aria-labelledby="test-steps-title">
      <div className="flex min-h-8 items-center justify-between gap-2 pl-3">
        <h2 id="test-steps-title" className="text-sm font-semibold">
          Steps{" "}
          <span className="ml-1.5 rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
            {entries.length}
          </span>
        </h2>
        {headerAside ? <div className="flex items-center gap-1">{headerAside}</div> : null}
      </div>
      {entries.length ? (
        <ol className="mt-3 grid list-none divide-y divide-border p-0">
          {entries.map((entry) => (
            <li key={entry.step.id} style={{ "--step-depth": entry.depth } as CSSProperties}>
              <div
                id={`test-step-${entry.step.id}`}
                className="grid min-h-14 min-w-0 grid-cols-1 items-stretch group bg-transparent transition-colors hover:bg-muted/40 data-[selected=true]:bg-muted/40"
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
                  if (!event.altKey || busy) return;
                  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                    event.preventDefault();
                    onMove(entry, event.key === "ArrowUp" ? -1 : 1);
                  }
                }}
              >
                <button
                  className="grid min-h-14 min-w-0 grid-cols-[20px_minmax(0,1fr)_12px] items-center gap-2.5 border-0 bg-transparent px-3 py-3 text-left text-inherit focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  type="button"
                  onClick={() => onSelect(entry.step.id)}
                  aria-pressed={selectedStepId === entry.step.id}
                >
                  <span className="text-center text-xs tabular-nums text-muted-foreground">
                    {entry.number}
                  </span>
                  <span className="min-w-0">
                    <strong className="block overflow-hidden text-sm font-medium break-words">
                      {entry.step.intent}
                    </strong>
                    <small className="mt-0.5 block overflow-hidden text-xs text-muted-foreground break-words empty:hidden">
                      {entry.placement ? `${branchLabel(entry.placement)} · ` : ""}
                      {stepReadinessLabel(entry.step, {
                        productName: test.name,
                        originEvidenceMissing,
                        platformBlocker: stepPlatformBlockers?.[entry.step.id],
                      })
                        .split(" · ")[0]!
                        .replace(/^Ready$/, "")}
                    </small>
                  </span>
                  <ChevronRight
                    className={`size-3.5 text-muted-foreground ${selectedStepId === entry.step.id ? "rotate-90" : ""}`}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {selectedStepId === entry.step.id ? selectedEditor : null}
            </li>
          ))}
        </ol>
      ) : (
        <EmptyState
          title="This Test has no steps"
          detail="Record this Test again to give Relay steps to repeat."
        />
      )}
      <div className="mt-2 flex flex-wrap items-center gap-1 px-1">
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" disabled={busy} />}>
            <Plus aria-hidden="true" /> Add step <ChevronDown aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onAdd}>Write a step</DropdownMenuItem>
            <DropdownMenuItem onClick={onAddCheckpoint}>Add a check</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {showDetails ? (
        <details className="mt-5 text-sm text-muted-foreground">
          <summary className="cursor-pointer py-2">Platform availability</summary>
          <div className="pt-3">
            <TestEditorRoutes
              test={test}
              recordedPlatforms={recordedPlatforms}
              routePlatformBlockers={routePlatformBlockers}
            />
            {compileBlockNotice ? (
              <p className="mt-2 text-xs leading-snug text-muted-foreground">
                {compileBlockNotice}
              </p>
            ) : null}
          </div>
        </details>
      ) : null}
    </section>
  );
}
