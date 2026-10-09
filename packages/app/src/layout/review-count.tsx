/** @jsxImportSource react */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { createReviewProductService, reviewQueryKeys } from "../data/review-product-service";

/** Screenshots waiting for a person, across every app unless one is given. */
export function useReviewCount(appMapId?: string): number {
  const { platform } = useRouteContext({ from: "__root__" });
  const service = useMemo(() => createReviewProductService(platform), [platform]);
  const inbox = useQuery({
    queryKey: reviewQueryKeys.inbox(14, appMapId),
    queryFn: () => service.inbox(appMapId ? { appMapId } : {}),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  return inbox.data?.entries.reduce((total, entry) => total + entry.items.length, 0) ?? 0;
}

export function formatReviewCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}

/** Screenshots waiting for a person, shown next to the Runs destination. */
export function ReviewCount({ appMapId }: { appMapId?: string }) {
  const count = useReviewCount(appMapId);
  if (!count) return null;
  return (
    <span
      // A standing queue, not an alert: quiet like an inbox count.
      className="ml-auto rounded-full bg-muted-foreground/15 px-1.5 text-xs font-medium text-muted-foreground tabular-nums"
      aria-label={`${count} to review`}
    >
      {formatReviewCount(count)}
    </span>
  );
}
