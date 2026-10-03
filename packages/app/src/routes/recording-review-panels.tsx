import { RecordingActionIcon } from "./recording-action-icon";
/** @jsxImportSource react */
import type {
  AuthoringFullPageCapture,
  AuthoringRawOptimizationProposalResponse,
} from "@relay/protocol";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Button } from "@relay/ui-react/components/button";
import { ScreenshotMomentSwitch } from "../components/screenshot-moment-switch";
import { useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import {
  pickRecordingEvidenceControl,
  imagePointFromClick,
  type RecordingEvidenceControl,
} from "../data/recording-evidence-target";
import { MoreHorizontal, Sparkles, Target, ScanLine } from "lucide-react";
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
  stepNumber,
  evidenceRole,
  previewUrl,
  onEvidenceRoleChange,
  onEvidenceSelect,
  fullPage,
  controls = [],
  exactMoment = true,
  loading = false,
}: {
  exactMoment?: boolean;
  loading?: boolean;
  controls?: readonly RecordingEvidenceControl[];
  action?: ReviewAction;
  stepNumber?: number;
  evidenceRole: "entrance" | "exit";
  previewUrl: string | null;
  onEvidenceRoleChange(role: "entrance" | "exit"): void;
  onEvidenceSelect?(evidenceId: string): void;
  fullPage?: AuthoringFullPageCapture;
}) {
  const [showElements, setShowElements] = useState(false);
  const [hovered, setHovered] = useState<RecordingEvidenceControl>();
  const [imageSize, setImageSize] = useState({ width: 1, height: 1 });
  const stage = useRef<HTMLDivElement>(null);
  const [captureHeight, setCaptureHeight] = useState(0);
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    const measure = () => {
      const style = getComputedStyle(element);
      setCaptureHeight(
        Math.max(
          0,
          element.clientHeight -
            parseFloat(style.paddingTop || "0") -
            parseFloat(style.paddingBottom || "0"),
        ),
      );
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  return (
    <section
      className={`grid h-full min-h-0 min-w-0 ${fullPage ? "grid-rows-[auto_auto_minmax(0,1fr)]" : "grid-rows-[auto_minmax(0,1fr)]"} self-start p-3 text-card-foreground`}
      aria-labelledby="recording-evidence-title"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="recording-evidence-title" className="flex items-center gap-2 text-sm font-medium">
          {action ? (
            <>
              {stepNumber ? (
                <span className="text-muted-foreground">Step {stepNumber} ·</span>
              ) : null}
              {reviewActionCopy(action).title}
            </>
          ) : (
            "Step preview"
          )}
        </h2>
        <div className="inline-flex shrink-0 items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            aria-label="Elements"
            aria-pressed={showElements}
            title="Show captured accessibility elements"
            onClick={() => setShowElements(!showElements)}
          >
            <ScanLine className="size-4" />
          </Button>
          <ScreenshotMomentSwitch
            label="Evidence moment"
            value={evidenceRole}
            items={[
              { value: "entrance", label: "Before" },
              { value: "exit", label: "After" },
            ]}
            onChange={onEvidenceRoleChange}
          />
        </div>
      </div>
      {fullPage ? (
        <div className="mt-2 grid gap-2 rounded-md border border-border bg-muted/40 p-2 text-xs">
          <div className="flex items-center justify-between gap-2">
            <strong>Full page · {fullPage.status === "completed" ? "complete" : "partial"}</strong>
          </div>
          <p className="text-muted-foreground">{fullPage.message}</p>
          <div className="flex flex-wrap gap-1">
            {fullPage.frames.map((frame) => (
              <Button
                key={frame.evidenceId}
                size="sm"
                variant="outline"
                onClick={() => onEvidenceSelect?.(frame.evidenceId)}
              >
                Part {frame.index + 1}
              </Button>
            ))}
            {fullPage.diagnosticFrames.map((frame) => (
              <Button
                key={frame.evidenceId}
                size="sm"
                variant="ghost"
                disabled
                title="Rejected diagnostic frame"
              >
                Diagnostic part {frame.index + 1}
              </Button>
            ))}
          </div>
          {fullPage.status === "stopped" ? (
            <details className="text-muted-foreground">
              <summary>Why this is partial</summary>
              <p className="mt-1">{fullPage.message}</p>
            </details>
          ) : null}
        </div>
      ) : null}
      <div
        ref={stage}
        className="mt-3 flex min-h-0 items-start justify-center overflow-hidden rounded-lg bg-background/40 p-2"
        style={{ "--capture-height": `${captureHeight}px` } as CSSProperties}
      >
        {loading ? (
          <div
            role="status"
            aria-label="Loading screenshot"
            className="pointer-events-none aspect-[9/19.5] h-full max-w-full rounded-2xl bg-muted/30 ring-1 ring-border/40"
          />
        ) : previewUrl ? (
          <div
            className="relative max-h-full max-w-full"
            onPointerLeave={() => setHovered(undefined)}
            onPointerMove={(event) => {
              const img = event.currentTarget.querySelector("img");
              if (!img) return;
              const point = imagePointFromClick(event, img);
              setHovered(point ? pickRecordingEvidenceControl(controls, point) : undefined);
            }}
          >
            <img
              className="block h-auto max-h-(--capture-height) w-auto max-w-full rounded-md object-contain"
              src={previewUrl}
              alt={
                exactMoment
                  ? `${evidenceRole === "entrance" ? "Before" : "After"} the step: ${action?.intent}`
                  : `Screenshot for step: ${action?.intent}`
              }
              onLoad={(event) => {
                setImageSize({
                  width: event.currentTarget.naturalWidth,
                  height: event.currentTarget.naturalHeight,
                });
                setHovered(undefined);
              }}
            />
            {(showElements ? controls : hovered ? [hovered] : []).map((control) => (
              <div
                key={control.id}
                className="pointer-events-none absolute left-(--box-left) top-(--box-top) h-(--box-height) w-(--box-width) rounded-sm border border-info bg-info/5"
                style={
                  {
                    "--box-left": `${(control.rect.x / imageSize.width) * 100}%`,
                    "--box-top": `${(control.rect.y / imageSize.height) * 100}%`,
                    "--box-width": `${(control.rect.width / imageSize.width) * 100}%`,
                    "--box-height": `${(control.rect.height / imageSize.height) * 100}%`,
                  } as CSSProperties
                }
              >
                {hovered?.id === control.id ? (
                  <span className="absolute bottom-full start-0 mb-1 flex max-w-64 items-center gap-2 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
                    <span className="truncate">{control.name}</span>
                    <code className="text-xs text-muted-foreground">{control.role}</code>
                  </span>
                ) : null}
              </div>
            ))}
            {showElements && !controls.length ? (
              <span className="absolute inset-x-2 bottom-2 rounded-md bg-popover p-2 text-center text-xs text-muted-foreground">
                No accessibility elements were captured with this screenshot.
              </span>
            ) : null}
          </div>
        ) : (
          <div className="grid max-w-[22ch] justify-items-center gap-2 p-6 text-center text-muted-foreground">
            <Target aria-hidden="true" />
            <strong className="text-sm text-foreground">
              {action ? "No screenshot" : "Select a step"}
            </strong>
            <span className="text-xs leading-normal">
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
  selecting = false,
  onSelectionModeChange,
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
  selecting?: boolean;
  onSelectionModeChange?(active: boolean): void;
  onOptimize(): void;
  onSelect(actionId: string): void;
  onToggle(actionId: string, checked: boolean): void;
}) {
  let actionOrdinal = 0;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden text-card-foreground"
      aria-labelledby="recording-actions-title"
    >
      <div className="flex min-h-12 min-w-0 flex-wrap items-center justify-between gap-3.5 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h2
            id="recording-actions-title"
            className="flex items-center gap-2 text-sm font-medium"
            aria-label={recordedMomentCount(actions.length)}
          >
            Steps
            <span className="rounded-md bg-muted px-1.5 py-0.5 text-xs font-normal text-muted-foreground">
              {actions.length}
            </span>
          </h2>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              aria-pressed={selecting}
              onClick={() => onSelectionModeChange?.(!selecting)}
            >
              {selecting ? "Done selecting" : "Select steps"}
            </Button>
          ) : null}
          {editing ? (
            <Button
              size="sm"
              variant="ghost"
              title="Review suggestions for simplifying the recorded steps"
              onClick={onOptimize}
              disabled={!canOptimize || optimization.isFetching}
            >
              <Sparkles aria-hidden="true" />
              {optimization.isFetching ? "Checking…" : "Suggest improvements"}
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
              {optimization.suggestions.length} suggested improvements
            </strong>
            <span className="text-xs text-muted-foreground">
              Select a suggestion to inspect its step.
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
        <p className="border-b border-border p-3 text-xs text-muted-foreground" role="status">
          No improvements suggested for these steps.
        </p>
      ) : null}

      {actions.length ? (
        <ScrollArea className="min-h-0 flex-1">
          <ol className="px-4" aria-label="Recorded actions">
            {actions.map((step) => {
              const copy = reviewActionCopy(step);
              const ordinal = copy.kind === "pause" ? actionOrdinal : ++actionOrdinal;
              const selected = selectedActionIds.includes(step.id);
              return (
                <li
                  className={`grid min-h-13 grid-cols-[auto_28px_minmax(0,1fr)] items-center gap-2 border-t border-border py-2 ${selected ? "bg-muted/60" : ""}`}
                  key={step.id}
                >
                  {selecting ? (
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
                      <p className="text-xs text-muted-foreground">Needs setup</p>
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
          detail="Start a new recording and interact with the app to add steps."
        />
      )}
    </section>
  );
}
