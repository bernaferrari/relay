import { ReportImage } from "./report-image";
import { CheckCircle2, CircleAlert, ImageOff } from "lucide-react";
import type { ProductRunReportOverview } from "../data/run-report-model";

/** A result in the test workspace. The separate report owns diagnostics. */
export function EmbeddedRunResult({ report }: { report: ProductRunReportOverview }) {
  const passed = report.outcome === "passed";
  const mismatch = /expect-screen:/iu.test(
    [report.cause, ...report.timeline.map((step) => step.log)].join(" "),
  );
  const title = passed
    ? "Test passed"
    : mismatch
      ? "Screen didn’t match"
      : report.outcome === "cancelled"
        ? "Run cancelled"
        : "Run couldn’t finish";
  const detail = mismatch
    ? "Relay couldn’t recognize the taught screen in this capture. Compare it with the recorded screen before running again."
    : passed
      ? undefined
      : "Open the full report to inspect where the run stopped.";
  const frame = report.evidence
    .find((section) => section.id === "screenshot")
    ?.items.filter((item) => item.media)
    .at(-1);
  const Icon = passed ? CheckCircle2 : CircleAlert;
  return (
    <section className="flex h-full min-h-0 flex-col gap-4 p-4" aria-label="Run result">
      <header className="flex shrink-0 items-start gap-2.5">
        <Icon
          className={`mt-0.5 size-4 shrink-0 ${passed ? "text-muted-foreground" : "text-foreground"}`}
        />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-medium">{title}</h2>
          {detail ? (
            <p className="mt-1 max-w-prose text-xs leading-5 text-muted-foreground">{detail}</p>
          ) : null}
        </div>
        {report.durationMs !== undefined ? (
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {Math.round(report.durationMs / 1000)}s
          </span>
        ) : null}
      </header>
      {frame?.media ? (
        <figure className="flex min-h-0 flex-1 flex-col gap-2">
          <ReportImage
            media={frame.media}
            alt="Screen captured during this run"
            className="min-h-0 flex-1 rounded-md object-contain"
          />
        </figure>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
          <ImageOff className="size-5" aria-hidden="true" />
          <p className="text-sm">No screenshot was saved for this run.</p>
        </div>
      )}
    </section>
  );
}
