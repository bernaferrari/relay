import { useState, type ReactNode } from "react";
import { ImageOff } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import type { CaptureReviewMask } from "@relay/protocol";
import type { ProductRunReportOverview } from "../data/run-report-model";
import type { ReportEvidenceItem } from "../data/run-product-service";
import { EvidenceImageViewer } from "../components/evidence-image-viewer";

export function StepMedia({
  frames,
  unlinked = false,
  fill = false,
  actionBounds,
  beforeFramePath,
  controls,
  masks,
  reviewControlsForFrame,
}: {
  frames: readonly ReportEvidenceItem[];
  unlinked?: boolean;
  fill?: boolean;
  actionBounds?: ProductRunReportOverview["timeline"][number]["actionBounds"];
  beforeFramePath?: string;
  controls?: ReactNode;
  masks?: readonly CaptureReviewMask[];
  reviewControlsForFrame?: (frame: ReportEvidenceItem | undefined) => ReactNode;
}) {
  const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
  const [selected, setSelected] = useState(() => {
    const after = frames.findIndex((item) => item.phase === "after");
    return after >= 0 ? after : beforeFramePath && frames.length > 1 ? 1 : 0;
  });
  const [failed, setFailed] = useState(false);
  const frame = frames[selected] ?? frames[0];
  const reviewControls = reviewControlsForFrame?.(failed ? undefined : frame);
  return (
    <div
      data-slot="evidence-image-frame"
      className={`overflow-hidden bg-transparent ${fill ? "flex min-h-0 flex-1 flex-col" : ""}`}
    >
      <div
        onLoadCapture={(event) => {
          const img = event.target;
          if (img instanceof HTMLImageElement)
            setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
        }}
        className={`relative flex items-center justify-center ${fill ? "min-h-0 flex-1" : "min-h-64"}`}
      >
        {actionBounds && frame?.id === beforeFramePath && imageSize.width > 0 ? (
          <svg
            aria-label="Recorded tap target"
            className="pointer-events-none absolute inset-0 z-10 size-full"
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            <rect
              {...actionBounds}
              className="fill-info/15 stroke-info"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              rx="6"
            />
          </svg>
        ) : null}
        {masks?.length && imageSize.width > 0 ? (
          <svg
            aria-label="Review overlays"
            className="pointer-events-none absolute inset-0 z-10 size-full"
            viewBox={`0 0 ${imageSize.width} ${imageSize.height}`}
            preserveAspectRatio="xMidYMid meet"
          >
            {masks.map((mask, index) => {
              const normalized = mask.width <= 1 && mask.height <= 1 && mask.x <= 1 && mask.y <= 1;
              return (
                <rect
                  key={`${mask.name ?? "mask"}-${index}`}
                  x={normalized ? mask.x * imageSize.width : mask.x}
                  y={normalized ? mask.y * imageSize.height : mask.y}
                  width={normalized ? mask.width * imageSize.width : mask.width}
                  height={normalized ? mask.height * imageSize.height : mask.height}
                  className="fill-warning/20 stroke-warning-foreground"
                  strokeWidth="2"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        ) : null}
        {frame?.media && !failed ? (
          <EvidenceImageViewer
            key={frame.id}
            frame={frame}
            className={
              fill
                ? "h-full w-full object-contain max-[720px]:h-auto max-[720px]:max-h-[65dvh]"
                : undefined
            }
            onError={() => setFailed(true)}
          />
        ) : (
          <div className="max-w-sm py-10 text-center">
            <ImageOff className="mx-auto mb-3 size-6 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm font-medium">
              {failed
                ? "Screenshot unavailable"
                : unlinked
                  ? "No saved screenshots"
                  : controls
                    ? "No capture linked to this step"
                    : "No screenshot for this step"}
            </p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {failed
                ? "The saved image could not be loaded. The step result remains available."
                : unlinked
                  ? "Review the other available evidence below."
                  : controls
                    ? "Other captures are available in this run. View them below."
                    : "This step did not save a screenshot."}
            </p>
            {failed ? (
              <Button size="sm" variant="outline" className="mt-4" onClick={() => setFailed(false)}>
                Retry image
              </Button>
            ) : null}
          </div>
        )}
      </div>
      {reviewControls ? (
        <div className="shrink-0 border-t border-border/40 bg-background/20 px-4 py-4">
          {reviewControls}
        </div>
      ) : null}
      {frames.length > 1 || controls ? (
        <div className="flex min-h-12 shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/50 px-3 py-1.5">
          {controls}
          <div className="flex flex-wrap gap-0.5" aria-label="Step screenshots">
            {frames.length > 1
              ? frames.map((item, index) => (
                  <Button
                    key={item.id}
                    size="sm"
                    variant={index === selected ? "secondary" : "ghost"}
                    aria-label={`Screenshot ${index + 1}: ${item.title}`}
                    aria-pressed={index === selected}
                    onClick={() => {
                      setSelected(index);
                      setFailed(false);
                    }}
                  >
                    {item.phase
                      ? item.phase === "before"
                        ? "Before"
                        : "After"
                      : beforeFramePath
                        ? item.id === beforeFramePath
                          ? "Before"
                          : frames.length === 2
                            ? "After"
                            : `After ${index}`
                        : index + 1}
                  </Button>
                ))
              : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
