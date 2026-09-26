/** @jsxImportSource react */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { createReviewProductService, reviewQueryKeys } from "../data/review-product-service";

/** Screenshots waiting for a person, shown next to the Review destination. */
export function ReviewCount() {
  const { platform } = useRouteContext({ from: "__root__" });
  const service = useMemo(() => createReviewProductService(platform), [platform]);
  const inbox = useQuery({
    queryKey: reviewQueryKeys.inbox(),
    queryFn: () => service.inbox(),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: false,
  });
  const count = inbox.data?.entries.reduce((total, entry) => total + entry.items.length, 0) ?? 0;
  if (!count) return null;
  return (
    <span
      className="ml-auto rounded-full bg-brand px-1.5 text-xs font-semibold text-brand-foreground tabular-nums"
      aria-label={`${count} to review`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
