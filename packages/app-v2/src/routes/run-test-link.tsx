import { Link, useLocation } from "@tanstack/react-router";
import { ChevronLeft } from "lucide-react";

/** Restore the Test's collection context instead of losing it in Results. */
export function RunTestLink({ testId }: { testId: string }) {
  const search = useLocation({ select: (location) => location.search }) as Record<string, unknown>;
  return (
    <Link
      to="/tests/$testId"
      params={{ testId }}
      search={{
        view: "definition",
        ...(typeof search.plan === "string" ? { plan: search.plan } : {}),
        ...(typeof search.planApp === "string" ? { planApp: search.planApp } : {}),
        ...(typeof search.app === "string" ? { app: search.app } : {}),
      }}
      className="inline-flex items-center gap-1 hover:text-foreground"
    >
      <ChevronLeft className="size-4" aria-hidden="true" /> Back to Test
    </Link>
  );
}
