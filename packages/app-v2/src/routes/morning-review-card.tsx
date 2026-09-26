/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { ChevronDown, ArrowUpRight } from "lucide-react";
import { settingsQueryKeys } from "../data/settings-product-service";
import { morningAttentionItems } from "./morning-review-attention";

export function MorningReviewCard() {
  const { settingsService } = useRouteContext({ from: "__root__" });
  const apple = useQuery({
    queryKey: settingsQueryKeys.appleSetup,
    queryFn: () => settingsService.appleSetup(),
    staleTime: 30_000,
    retry: false,
  });
  const items = morningAttentionItems({ apple: apple.data });

  return (
    <section
      className="mb-5 overflow-hidden rounded-xl border border-border/60"
      aria-label="Morning review"
    >
      <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">Review your latest results</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Inspect screenshots and findings, then prepare the next run.
          </p>
        </div>
        <Button nativeButton={false} render={<Link to="/accounts" />} size="sm" variant="outline">
          Check Sign-ins <ArrowUpRight aria-hidden="true" className="size-3.5" />
        </Button>
      </div>
      <details className="group border-t border-border/60">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span>
            Setup and operating notes <span className="ml-1 tabular-nums">({items.length})</span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className="size-4 transition-transform group-open:rotate-180 motion-reduce:transition-none"
          />
        </summary>
        <div className="space-y-4 px-4 pb-4 text-sm">
          <p className="max-w-prose text-muted-foreground">
            Confirm marks a finding as a product issue; Reject dismisses it. Looks correct on a
            screenshot makes it the reference for later runs.
          </p>
          <h3 className="text-xs font-medium text-foreground">Needs attention on this Mac</h3>
          <ul className="grid gap-4 sm:grid-cols-2">
            {items.map((item) => (
              <li key={item.id} className="min-w-0">
                <Link
                  className="inline-flex min-h-8 items-center gap-1 text-sm font-medium text-foreground hover:underline"
                  to={item.href}
                >
                  {item.label}
                  <ArrowUpRight
                    aria-hidden="true"
                    className="size-3.5 shrink-0 text-muted-foreground"
                  />
                </Link>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.detail}</p>
              </li>
            ))}
          </ul>
        </div>
      </details>
    </section>
  );
}
