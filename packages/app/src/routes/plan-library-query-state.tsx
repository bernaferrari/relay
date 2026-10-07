/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { CircleX } from "lucide-react";
import { PageLoading } from "./recording-shared";

export function PlanLibraryQueryState({
  state,
  retrying,
  onRetry,
}: {
  state: "loading" | "error" | null;
  retrying: boolean;
  onRetry(): void;
}) {
  if (state === "loading") return <PageLoading label="Loading plans…" />;
  if (state !== "error") return null;
  return (
    <div
      role="alert"
      className="mt-4 flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 px-3 py-2 text-sm"
    >
      <CircleX className="size-4 text-destructive" aria-hidden="true" />
      <span className="flex-1">Couldn’t load saved Plans.</span>
      <Button size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
        {retrying ? "Loading…" : "Try again"}
      </Button>
    </div>
  );
}
