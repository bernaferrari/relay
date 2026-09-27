import type { ReactNode } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";
import { returnDestination } from "../router/return-destination";

/** Shared return navigation; the source owns its URL state, not the destination. */
export function ContextBackLink({
  fallback,
  label: visibleLabel,
}: {
  fallback?: ReactNode;
  label?: string;
}) {
  const search = useLocation({ select: (location) => location.search }) as Record<string, unknown>;
  const destination = returnDestination(search.returnTo);
  if (!destination) return fallback ?? null;
  const { label, ...navigation } = destination;
  return (
    <Link {...navigation} replace className="inline-flex items-center gap-1 hover:text-foreground">
      <ChevronLeft className="size-4" aria-hidden="true" />
      {visibleLabel ?? label}
    </Link>
  );
}
