import { useState } from "react";
import { Input } from "@relay/ui-react/components/input";

/** Request evidence uses the full workspace; URLs remain inspectable without widening rows. */
export function RunNetworkPanel({
  items,
  summary,
}: {
  summary?: string;
  items: readonly { id: string; title: string; detail?: string }[];
}) {
  const [query, setQuery] = useState("");
  const filtered = items.filter((item) =>
    `${item.title} ${item.detail ?? ""}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" aria-label="Network requests">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 py-3">
        <p className="text-sm text-muted-foreground tabular-nums">
          {filtered.length} of {items.length} requests
        </p>
        <Input
          className="w-full sm:w-72"
          aria-label="Filter requests"
          placeholder="Filter by URL, method or status…"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-5 pb-5">
        {summary ? (
          <details className="mb-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer">About this capture</summary>
            <p className="mt-2 max-w-prose leading-5">{summary}</p>
          </details>
        ) : null}
        <table className="w-full table-fixed text-left text-sm">
          <thead className="sticky top-0 bg-card text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="w-20 py-3 font-medium">Method</th>
              <th className="py-3 font-medium">Request</th>
              <th className="w-24 py-3 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((item) => {
              const match = item.title.match(/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(.+)$/);
              const address = match?.[2] ?? item.title;
              return (
                <tr key={item.id} className="hover:bg-accent/30">
                  <td className="py-3 pr-3 align-top font-mono text-xs text-muted-foreground">
                    {match?.[1] ?? "—"}{" "}
                  </td>
                  <td className="py-3 pr-4">
                    <details className="min-w-0">
                      <summary
                        className="cursor-pointer truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        title={address}
                      >
                        {address}
                      </summary>
                      <p className="mt-2 break-all font-mono text-xs leading-5 text-muted-foreground">
                        {address}
                      </p>
                    </details>
                  </td>
                  <td className="py-3 text-right align-top font-mono text-xs tabular-nums">
                    {item.detail?.replace(/^Status\s+/i, "") ?? "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!filtered.length ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No requests match your filter.
          </p>
        ) : null}
      </div>
    </section>
  );
}
