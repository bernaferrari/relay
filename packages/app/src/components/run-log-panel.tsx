import { Terminal } from "lucide-react";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useMemo, useRef, useState, type CSSProperties } from "react";
import type { ReportEvidenceItem } from "../data/run-report-model";

export function RunLogPanel({ logs }: { logs: readonly ReportEvidenceItem[] }) {
  const [filter, setFilter] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const rows = useMemo(
    () =>
      logs.filter((item) =>
        `${item.title} ${item.detail ?? ""}`
          .toLocaleLowerCase()
          .includes(filter.toLocaleLowerCase()),
      ),
    [logs, filter],
  );
  const virtual = useVirtualizer({
    count: rows.length,
    getScrollElement: () => viewport.current,
    estimateSize: () => 72,
    getItemKey: (index) => rows[index]!.id,
    overscan: 6,
  });
  return (
    <section className="flex min-h-0 flex-1 flex-col p-4" aria-label="Run logs">
      {logs.length ? (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">
            {filter ? `${rows.length} of ${logs.length}` : logs.length}{" "}
            {logs.length === 1 ? "log entry" : "log entries"}
          </span>
          {logs.length ? (
            <input
              aria-label="Filter logs"
              placeholder="Filter logs…"
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                viewport.current?.scrollTo({ top: 0 });
              }}
              className="h-8 rounded-md border border-input bg-transparent px-3 text-sm"
            />
          ) : null}
        </div>
      ) : null}
      {!rows.length ? (
        <div className="flex items-start gap-4 py-6">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-muted/50 text-muted-foreground">
            <Terminal className="size-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-medium">
              {logs.length ? "No matching entries" : "No logs recorded"}
            </h3>
            <p className="max-w-sm text-sm leading-6 text-muted-foreground">
              {logs.length
                ? "Try a different search or clear the filter."
                : "This run saved screenshots and step results, but no device logs."}
            </p>
          </div>
        </div>
      ) : (
        <ScrollArea
          className="min-h-0 flex-1"
          viewportRef={viewport}
          viewportProps={{ "aria-label": "Device log entries", tabIndex: 0 }}
        >
          <div
            role="list"
            className="relative h-(--list-height) w-full"
            style={{ "--list-height": `${virtual.getTotalSize()}px` } as CSSProperties}
          >
            {virtual.getVirtualItems().map((row) => (
              <div
                key={row.key}
                role="listitem"
                aria-posinset={row.index + 1}
                aria-setsize={rows.length}
                data-index={row.index}
                ref={virtual.measureElement}
                className="absolute top-0 left-0 w-full translate-y-(--row-y) border-b border-border/50 py-3 pr-3"
                style={{ "--row-y": `${row.start}px` } as CSSProperties}
              >
                <p className="mb-1 text-xs text-muted-foreground">{rows[row.index]!.meta}</p>
                <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5">
                  {rows[row.index]!.title}
                </pre>
                {rows[row.index]!.detail ? (
                  <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                    {rows[row.index]!.detail}
                  </p>
                ) : null}
              </div>
            ))}
          </div>
        </ScrollArea>
      )}
    </section>
  );
}
