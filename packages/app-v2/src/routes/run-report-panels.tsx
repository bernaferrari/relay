/** @jsxImportSource react */
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
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
      className="rounded-xl border border-border bg-card p-5 mt-5"
      role={tabbed ? "tabpanel" : undefined}
      aria-labelledby={tabbed ? "report-tab-timeline" : undefined}
    >
      <header className="flex items-center justify-between gap-3">
        <div>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Timeline
          </p>
          <h2 className="text-base font-semibold">What happened</h2>
        </div>
        <p className="text-sm text-muted-foreground">
          {items.length === 1 ? "1 recorded step" : `${items.length} recorded steps`}
        </p>
      </header>
      <ol className="mt-5 list-none space-y-2 p-0">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={`grid grid-cols-[28px_minmax(0,1fr)_auto] items-start gap-3 rounded-md border border-border p-3`}
          >
            <span
              className="grid size-7 place-items-center rounded-full bg-muted text-xs font-medium"
              aria-hidden="true"
            >
              {index + 1}
            </span>
            <span className="grid min-w-0 gap-1">
              <strong className="text-sm font-medium">{item.title}</strong>
              <small className="text-xs text-muted-foreground">
                {timelineStateLabel(item.state)}
                {item.evidenceCount
                  ? ` · ${item.evidenceCount} ${item.evidenceCount === 1 ? "screenshot" : "screenshots"}`
                  : ""}
              </small>
            </span>
            {item.durationMs !== undefined ? (
              <span className="text-xs text-muted-foreground">
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
    <section className="rounded-xl border border-border bg-card p-4" aria-live="polite">
      <header>
        <div>
          <h3 className="text-base font-semibold">{section.label}</h3>
          <p className="mt-1 text-sm text-muted-foreground">{section.summary}</p>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{section.detail}</p>
      </header>
      {section.items.length ? (
        <ScrollArea className="mt-4 max-h-[420px] overflow-auto">
          <ol className={`list-none space-y-2 p-0`}>
            {section.items.map((item) => (
              <li
                key={item.id}
                className={`grid ${item.media ? "grid-cols-[96px_minmax(0,1fr)]" : "grid-cols-1"} gap-3 rounded-md border border-border p-3`}
              >
                {item.media ? (
                  <span
                    className="relay-evidence-image-frame overflow-hidden rounded-md bg-muted"
                    aria-hidden="true"
                  >
                    <img
                      src={item.media.src}
                      alt=""
                      width={item.media.width}
                      height={item.media.height}
                      loading="lazy"
                      decoding="async"
                    />
                  </span>
                ) : null}
                <span className="grid min-w-0 gap-1">
                  <strong className="text-sm font-medium">{item.title}</strong>
                  {item.detail ? <span>{item.detail}</span> : null}
                </span>
                {item.meta ? (
                  <small className="text-xs text-muted-foreground">{item.meta}</small>
                ) : null}
              </li>
            ))}
          </ol>
        </ScrollArea>
      ) : (
        <div className="grid min-h-[220px] place-items-center gap-2 rounded-xl border border-border bg-card p-4 text-center">
          <p>This evidence was saved, but it does not have a readable preview.</p>
          <span>Audit details remain available below.</span>
        </div>
      )}
    </section>
  );
}
