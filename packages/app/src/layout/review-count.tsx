/** @jsxImportSource react */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { createReviewProductService, reviewQueryKeys } from "../data/review-product-service";

/**
 * Screenshots waiting for a person, across every app unless one is given.
 * Passing runs accept their first screenshots, so this counts only what
 * changed, failed, or belongs to a Plan that asked for human review.
 */
export function useReviewCount(appMapId?: string): number {
  const { platform } = useRouteContext({ from: "__root__" });
  const service = useMemo(() => createReviewProductService(platform), [platform]);
  const count = useQuery({
    queryKey: reviewQueryKeys.count(appMapId),
    queryFn: () => service.pendingCount(appMapId ? { appMapId } : {}),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  return count.data ?? 0;
}

export function formatReviewCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

export function reviewCountLabel(count: number): string {
  return `${count} ${count === 1 ? "screenshot" : "screenshots"} to review`;
}

/** Screenshots waiting for a person, shown next to the Runs destination. */
export function ReviewCount({ appMapId }: { appMapId?: string }) {
  const count = useReviewCount(appMapId);
  if (!count) return null;
  const label = reviewCountLabel(count);
  return (
    <span
      // A standing queue, not an alert: quiet like an inbox count.
      className="ml-auto rounded-full bg-muted-foreground/15 px-1.5 text-xs font-medium text-muted-foreground tabular-nums"
      title={label}
    >
      <span aria-hidden="true">{formatReviewCount(count)}</span>
      {/* Read as part of the link: "Runs, 50 screenshots to review". */}
      <span className="sr-only">, {label}</span>
    </span>
  );
}
