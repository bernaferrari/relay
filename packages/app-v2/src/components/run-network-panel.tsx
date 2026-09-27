import { useState } from "react";
import { ChevronRight, Info, Search } from "lucide-react";
import { Input } from "@relay/ui-react/components/input";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@relay/ui-react/components/dialog";
import type { ReportEvidenceItem } from "../data/run-report-model";

function requestLabel(item: ReportEvidenceItem) {
  const match = item.title.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/);
  const address = match?.[2] ?? item.title;
  let host = "",
    path = address;
  if (match) {
    try {
      const url = new URL(address.includes("://") ? address : `https://${address}`);
      host = url.host;
      path = `${url.pathname}${url.search}`;
    } catch {
      /* Keep the retained label when it is not a URL. */
    }
  }
  const [result, timing] = (item.detail ?? "").split(" · ");
  const duration = match ? timing : undefined;
  const status = (match ? result?.replace(/^Status\s+/i, "") : item.detail) || "Unknown";
  const attention =
    Number(status) >= 400 ||
    item.tone === "critical" ||
    item.tone === "warning" ||
    /pending|fail|error|refused|reset|timed.out/i.test(status);
  return { method: match?.[1] ?? "—", address, host, path, status, duration, attention };
}

export function RunNetworkPanel({
  items,
  summary,
}: {
  summary?: string;
  items: readonly ReportEvidenceItem[];
}) {
  const [query, setQuery] = useState("");
  const [attentionOnly, setAttentionOnly] = useState(false);
  const [selected, setSelected] = useState<string>();
  const rows = items.map((item) => ({ item, ...requestLabel(item) }));
  const attentionCount = rows.filter((row) => row.attention).length;
  const filtered = rows.filter(
    (row) =>
      (!attentionOnly || row.attention) &&
      `${row.item.title} ${row.item.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Network requests">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        <div className="relative mr-auto w-full sm:w-72">
          <Search
            className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            className="pl-9"
            aria-label="Filter requests"
            placeholder="Filter requests…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Button
          size="sm"
          variant={attentionOnly ? "secondary" : "ghost"}
          aria-pressed={attentionOnly}
          onClick={() => setAttentionOnly(!attentionOnly)}
        >
          Needs attention{" "}
          <span className="text-xs tabular-nums text-muted-foreground">{attentionCount}</span>
        </Button>
        <span className="text-xs tabular-nums text-muted-foreground">
          {query || attentionOnly ? `${filtered.length} of ${items.length}` : items.length} requests
        </span>
        {summary ? (
          <Dialog>
            <DialogTrigger
              render={
                <Button size="icon-sm" variant="ghost" aria-label="Capture information">
                  <Info aria-hidden="true" />
                </Button>
              }
            />
            <DialogContent>
              <DialogTitle>Network capture</DialogTitle>
              <DialogDescription>{summary}</DialogDescription>
            </DialogContent>
          </Dialog>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="sticky top-0 z-10 grid grid-cols-[4rem_5.5rem_minmax(0,1fr)_1rem] gap-3 border-b border-border bg-card px-5 py-2 text-xs text-muted-foreground"
          aria-hidden="true"
        >
          <span>Method</span>
          <span>Status</span>
          <span>Request</span>
        </div>
        <ul className="divide-y divide-border/50">
          {filtered.map(({ item, method, address, host, path, status, duration, attention }) => (
            <li key={item.id}>
              <button
                type="button"
                aria-label={item.title}
                aria-expanded={selected === item.id}
                onClick={() => setSelected(selected === item.id ? undefined : item.id)}
                className="grid w-full min-w-0 grid-cols-[4rem_5.5rem_minmax(0,1fr)_1rem] items-center gap-3 px-5 py-3 text-left outline-none hover:bg-accent/40 aria-expanded:bg-accent/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="font-mono text-xs text-muted-foreground">{method}</span>
                <span
                  className={`text-xs tabular-nums ${attention ? "text-warning-foreground" : "text-muted-foreground"}`}
                >
                  {status}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm" title={address}>
                    {path}
                  </span>
                  {host ? (
                    <span className="block truncate text-xs text-muted-foreground">{host}</span>
                  ) : null}
                </span>
                <ChevronRight
                  className={`size-3.5 text-muted-foreground ${selected === item.id ? "rotate-90" : ""}`}
                  aria-hidden="true"
                />
              </button>
              {selected === item.id ? (
                <div className="border-t border-border/50 bg-accent/10 px-5 py-4 sm:pl-28">
                  <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
                    <dt className="text-muted-foreground">Address</dt>
                    <dd className="select-text break-all font-mono leading-5">{address}</dd>
                    <dt className="text-muted-foreground">Result</dt>
                    <dd>{status}</dd>
                    {duration ? (
                      <>
                        <dt className="text-muted-foreground">Duration</dt>
                        <dd>{duration}</dd>
                      </>
                    ) : null}
                    {item.meta ? (
                      <>
                        <dt className="text-muted-foreground">Recorded</dt>
                        <dd>{item.meta}</dd>
                      </>
                    ) : null}
                  </dl>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
        {!filtered.length ? (
          <div className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {attentionOnly && !query
                ? "No requests need attention."
                : "No requests match your filter."}
            </p>
            <Button
              className="mt-3"
              size="sm"
              variant="ghost"
              onClick={() => {
                setQuery("");
                setAttentionOnly(false);
              }}
            >
              Show all requests
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
