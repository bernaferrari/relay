import { ReportImage } from "./report-image";
/** @jsxImportSource react */
import { Link } from "@tanstack/react-router";
import type { ProductTestStep } from "@relay/product/catalog";
import {
  destIdentityReviewItems,
  isCaptureReviewDestPhase,
  isCaptureReviewLeftoverCaption,
  isCaptureReviewOpenerCaption,
} from "@relay/protocol";
import { SavedRecordingPreview } from "./saved-recording-preview";
import { useState } from "react";
import { ImageOff, Info } from "lucide-react";
import { Button } from "@relay/ui-react/components/button";
import { Popover, PopoverContent, PopoverTrigger } from "@relay/ui-react/components/popover";
import type { ProductRunReportOverview } from "../data/run-product-service";

export function TestStepEvidencePreview({
  step,
  report,
  hasRuns,
  loading,
}: {
  step: Pick<ProductTestStep, "id" | "intent" | "label" | "recordingFrames">;
  report: ProductRunReportOverview | undefined;
  hasRuns: boolean;
  loading: boolean;
}) {
  const allMatches = report?.stepEvidence?.filter((item) => item.testStepId === step.id) ?? [];
  const captures = allMatches.filter((item) => item.evidence.framePaths.length > 0);
  const screenshotItems =
    report?.evidence.find((section) => section.id === "screenshot")?.items ?? [];
  const reviewItems = destIdentityReviewItems(report?.captureReview?.items ?? []);
  const destPhaseItems = reviewItems.filter((item) => isCaptureReviewDestPhase(item.phase));
  const identityItems = destPhaseItems.length ? destPhaseItems : reviewItems;
  const destFramePaths = new Set(
    identityItems.flatMap((item) => (item.framePath ? [item.framePath] : [])),
  );
  const destCaptures = captures.filter((item) =>
    item.evidence.framePaths.some((path) => destFramePaths.has(path)),
  );
  const visibleCaptures = captures.filter((item) =>
    report?.timeline.some((entry) => entry.id === item.traceStepId),
  );
  const intentionalCaptures = visibleCaptures.filter((item) => {
    const title = report?.timeline.find((entry) => entry.id === item.traceStepId)?.title ?? "";
    return title.startsWith("Screenshot ·") || title.startsWith("Capture for review");
  });
  const fallbackCaptures = intentionalCaptures.length
    ? intentionalCaptures
    : visibleCaptures.length
      ? visibleCaptures
      : captures.length
        ? captures
        : allMatches;
  const matches = destCaptures.length
    ? destCaptures
    : preferDestWaitForCaptures(fallbackCaptures, report?.timeline, screenshotItems);
  const [selectedOccurrence, setSelectedOccurrence] = useState(matches[0]?.occurrence ?? 1);
  if (!hasRuns && step.recordingFrames?.length) {
    return (
      <SavedRecordingPreview
        key={step.id}
        frames={step.recordingFrames}
        intent={step.label ?? step.intent}
      />
    );
  }
  const selected = matches.find((item) => item.occurrence === selectedOccurrence) ?? matches[0];
  const timelineItem = selected
    ? report?.timeline.find((item) => item.id === selected.traceStepId)
    : undefined;
  const titleId = `step-evidence-${step.id}`;
  const selectedFramePath = selected
    ? preferredDestWaitForFramePath(selected.evidence.framePaths, screenshotItems)
    : undefined;

  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden p-4"
      aria-labelledby={titleId}
    >
      <header className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5">
        <h3 id={titleId} className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {step.label ?? step.intent}
        </h3>
        {selected ? (
          <Popover>
            <PopoverTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Capture details" />}
            >
              <Info className="size-4" />
            </PopoverTrigger>
            <PopoverContent align="end" side="bottom" className="w-64 space-y-3 p-4">
              <h4 className="text-sm font-medium">Capture details</h4>
              <p className="text-xs leading-5 text-muted-foreground">
                {evidenceSummary(selected.evidence)}
              </p>
              {report ? (
                <Link
                  to="/runs/$runId"
                  params={{ runId: report.runId }}
                  search={{
                    reportView: selected ? "steps" : "captures",
                    ...(timelineItem && report
                      ? { step: String(report.timeline.indexOf(timelineItem)) }
                      : {}),
                  }}
                  className="text-xs underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Inspect in report
                </Link>
              ) : null}
            </PopoverContent>
          </Popover>
        ) : null}
        {selected && matches.length > 1 ? (
          <div className="flex shrink-0 items-center gap-1" aria-label="Step captures">
            <span className="sr-only">Capture</span>
            {matches.map((item, index) => (
              <button
                className={`min-h-8 min-w-8 rounded-md px-2 text-xs ${item.occurrence === selected.occurrence ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/70"}`}
                key={`${item.traceStepId}:${item.occurrence}`}
                type="button"
                onClick={() => setSelectedOccurrence(item.occurrence)}
                aria-label={`Capture ${index + 1}`}
                aria-pressed={item.occurrence === selected.occurrence}
              >
                {index + 1}
              </button>
            ))}
          </div>
        ) : null}
        {selected ? (
          <span
            className={`w-[8ch] shrink-0 text-center text-xs ${timelineItem?.state === "failed" ? "text-destructive" : "text-muted-foreground"}`}
          >
            {timelineItem?.state === "failed"
              ? "Failed"
              : timelineItem?.state === "blocked"
                ? "Blocked"
                : timelineItem?.state === "pending"
                  ? "Blocked"
                  : timelineItem?.state === "passed"
                    ? "Passed"
                    : timelineItem?.state === "running"
                      ? "Running"
                      : timelineItem?.state === "recovered"
                        ? "Recovered"
                        : "Captured"}
          </span>
        ) : null}
        {report ? (
          <Link
            className="inline-flex min-h-8 items-center text-xs font-semibold text-foreground underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
            to="/runs/$runId"
            params={{ runId: report.runId }}
            search={{
              reportView: selected ? "steps" : "captures",
              ...(timelineItem && report
                ? { step: String(report.timeline.indexOf(timelineItem)) }
                : {}),
            }}
          >
            Open report
          </Link>
        ) : null}
      </header>

      {loading ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          Loading the latest result…
        </p>
      ) : null}
      {!loading && !hasRuns ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          Run this test to see its result here.
        </p>
      ) : null}
      {!loading && hasRuns && !report ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          The latest run has not produced a report yet.
        </p>
      ) : null}
      {!loading && report?.stepEvidence && matches.length === 0 ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          The latest run did not save evidence for this step.
        </p>
      ) : null}
      {!loading && report && report.stepEvidence === undefined ? (
        <p className="mt-2 text-xs leading-normal text-muted-foreground">
          This result has no saved link to this step. Open its captures to review them.
        </p>
      ) : null}
      {selected ? (
        <div
          className="mt-3 flex min-h-0 flex-1 flex-col gap-2"
          aria-label={`Evidence for ${step.intent}`}
        >
          {selectedFramePath ? (
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-md bg-muted/20">
              {[selectedFramePath].map((framePath) => {
                const frame = screenshotItems.find((candidate) => candidate.id === framePath);
                return frame?.media ? (
                  <EvidenceImage key={framePath} frame={frame} />
                ) : (
                  <span key={framePath} className="px-3 text-xs text-muted-foreground">
                    Screenshot not retained for <code>{framePath}</code>.
                  </span>
                );
              })}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
              <ImageOff className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No screenshot for this step</p>
              <p className="max-w-xs text-xs leading-5 text-muted-foreground">
                The run saved the result without a screen capture.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function EvidenceImage({
  frame,
}: {
  frame: NonNullable<ProductRunReportOverview["evidence"][number]["items"][number]>;
}) {
  const [failed, setFailed] = useState(false);
  if (!frame.media || failed) {
    return (
      <span className="text-xs text-muted-foreground">
        {failed ? "Saved screenshot could not be loaded." : "Screenshot media is unavailable."}
      </span>
    );
  }
  return (
    <ReportImage
      className="block max-h-full w-full object-contain"
      media={frame.media}
      alt={frame.title}
      width={frame.media.width}
      height={frame.media.height}
      onError={() => setFailed(true)}
    />
  );
}

function evidenceSummary(evidence: {
  framePaths: readonly string[];
  eventSequences: readonly number[];
  artifactKinds: readonly string[];
}): string {
  const parts = [
    countLabel(evidence.framePaths.length, "frame"),
    countLabel(evidence.eventSequences.length, "event"),
    countLabel(evidence.artifactKinds.length, "artifact"),
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No saved evidence references";
}

function countLabel(count: number, label: string): string {
  return count ? `${count} ${label}${count === 1 ? "" : "s"}` : "";
}

/** Dest wait-for frame when leftover Close / Transition executed last-frame
 * captions are also listed. Opener before · Tap cannot fill dest beside those
 * leftovers. Unphased dest-wait (no dest wait-for caption) keeps the last frame. */
function preferredDestWaitForFramePath(
  paths: readonly string[],
  items: readonly { id: string; title?: string }[],
): string | undefined {
  if (!paths.length) return undefined;
  const titled = paths.map((path) => {
    const title = items.find((item) => item.id === path)?.title;
    return {
      path,
      leftover: isCaptureReviewLeftoverCaption(title),
      opener: isCaptureReviewOpenerCaption(title),
    };
  });
  const dest = titled.filter((item) => !item.leftover);
  const leftover = titled.filter((item) => item.leftover);
  if (!(dest.length && leftover.length)) return titled.at(-1)?.path;
  const withoutOpeners = dest.filter((item) => !item.opener);
  return (withoutOpeners.length ? withoutOpeners : dest).at(-1)?.path;
}

function preferDestWaitForCaptures<
  T extends { traceStepId: string; evidence: { framePaths: readonly string[] } },
>(
  captures: readonly T[],
  timeline: readonly { id: string; title?: string }[] | undefined,
  items: readonly { id: string; title?: string }[],
): T[] {
  const leftoverCapture = (item: T) => {
    const title = timeline?.find((entry) => entry.id === item.traceStepId)?.title;
    if (isCaptureReviewLeftoverCaption(title)) return true;
    return (
      item.evidence.framePaths.length > 0 &&
      item.evidence.framePaths.every((path) =>
        isCaptureReviewLeftoverCaption(items.find((frame) => frame.id === path)?.title),
      )
    );
  };
  const openerCapture = (item: T) => {
    const title = timeline?.find((entry) => entry.id === item.traceStepId)?.title;
    if (isCaptureReviewOpenerCaption(title)) return true;
    return (
      item.evidence.framePaths.length > 0 &&
      item.evidence.framePaths.every((path) =>
        isCaptureReviewOpenerCaption(items.find((frame) => frame.id === path)?.title),
      )
    );
  };
  const dest = captures.filter((item) => !leftoverCapture(item));
  const leftover = captures.filter(leftoverCapture);
  if (!(dest.length && leftover.length)) return [...captures];
  const withoutOpeners = dest.filter((item) => !openerCapture(item));
  return withoutOpeners.length ? withoutOpeners : dest;
}
