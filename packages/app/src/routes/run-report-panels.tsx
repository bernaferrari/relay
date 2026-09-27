import { ReportImage } from "../components/report-image";
/** @jsxImportSource react */
import { formatDuration } from "../components/run-report-formatters";
import type { RunProductService } from "../data/run-product-service";

export function ReportTimeline({
  items,
  tabbed,
}: {
  items: Awaited<ReturnType<RunProductService["getReport"]>>["timeline"];
  tabbed: boolean;
}) {
  return (
    <section
      id="report-panel-timeline"
      className="mt-5"
      role={tabbed ? "tabpanel" : undefined}
      aria-labelledby={tabbed ? "report-tab-timeline" : undefined}
    >
      <ol className="list-none p-0">
        {items.map((item, index) => (
          <li
            key={item.id}
            className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 border-b border-border py-3"
          >
            <span className="text-xs tabular-nums text-muted-foreground" aria-hidden="true">
              {index + 1}
            </span>
            <span className="grid min-w-0 gap-0.5">
              <strong className="text-sm font-medium">{item.title}</strong>
              <small className="text-xs text-muted-foreground">
                {timelineStateLabel(item.state)}
                {item.evidenceCount
                  ? ` · ${item.evidenceCount} ${item.evidenceCount === 1 ? "screenshot" : "screenshots"}`
                  : ""}
              </small>
            </span>
            {item.durationMs !== undefined ? (
              <span className="text-xs tabular-nums text-muted-foreground">
                {formatDuration(item.durationMs)}
              </span>
            ) : null}
          </li>
        ))}
      </ol>
    </section>
  );
}

function timelineStateLabel(
  state: Awaited<ReturnType<RunProductService["getReport"]>>["timeline"][number]["state"],
): string {
  if (state === "passed") return "Passed";
  if (state === "failed") return "Failed";
  if (state === "blocked") return "Blocked";
  if (state === "recovered") return "Recovered";
  if (state === "running") return "In progress";
  return "Not reached";
}

export function EvidencePreview({
  section,
}: {
  section: Awaited<ReturnType<RunProductService["getReport"]>>["evidence"][number];
}) {
  return (
    <section aria-live="polite">
      {section.items.length ? (
        <ol className="list-none p-0">
          {section.items.map((item) => (
            <li
              key={item.id}
              className={`grid items-center gap-3 border-b border-border py-3 ${item.media ? "grid-cols-[72px_minmax(0,1fr)]" : ""}`}
            >
              {item.media ? (
                <span
                  data-slot="evidence-image-frame"
                  className="overflow-hidden rounded-md bg-muted"
                  aria-hidden="true"
                >
                  <ReportImage
                    media={item.media}
                    alt=""
                    width={item.media.width}
                    height={item.media.height}
                    loading="lazy"
                    decoding="async"
                  />
                </span>
              ) : null}
              <span className="grid min-w-0 gap-0.5">
                <strong className="text-sm font-medium">{item.title}</strong>
                {item.detail ? (
                  <span className="text-xs text-foreground">{item.detail}</span>
                ) : null}
                {item.meta ? <small className="text-xs text-foreground">{item.meta}</small> : null}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="py-6 text-sm text-muted-foreground">
          This evidence was saved, but it does not have a readable preview.
        </p>
      )}
    </section>
  );
}
