import { Button } from "@relay/ui-react/components/button";
import { useState, type ReactNode } from "react";

/** Keep the screenshot in place; give each editing surface its own scroll area. */
export function RecordingReviewLayout({
  outline,
  stage,
  inspector,
}: {
  outline: ReactNode;
  stage: ReactNode;
  inspector?: ReactNode;
}) {
  return (
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(300px,34%)] gap-3 p-3 max-[760px]:grid-cols-1 max-[760px]:overflow-y-auto">
      <div className="min-h-0 min-w-0 overflow-hidden rounded-xl bg-background/40">{stage}</div>
      {inspector ? (
        <ReviewTools outline={outline} inspector={inspector} />
      ) : (
        <div className="min-h-0 min-w-0 overflow-y-auto">{outline}</div>
      )}
    </div>
  );
}

function ReviewTools({ outline, inspector }: { outline: ReactNode; inspector: ReactNode }) {
  const [tab, setTab] = useState<"steps" | "details">("details");
  return (
    <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex shrink-0 gap-1 border-b border-border p-2" aria-label="Review tools">
        <Button
          size="sm"
          variant={tab === "steps" ? "secondary" : "ghost"}
          aria-pressed={tab === "steps"}
          onClick={() => setTab("steps")}
        >
          Steps
        </Button>
        <Button
          size="sm"
          variant={tab === "details" ? "secondary" : "ghost"}
          aria-pressed={tab === "details"}
          onClick={() => setTab("details")}
        >
          Edit selection
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">{tab === "steps" ? outline : inspector}</div>
    </aside>
  );
}
