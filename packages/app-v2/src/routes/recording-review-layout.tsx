import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import type { ReactNode } from "react";

/** Keep the preview stable while the outline and selected step scroll independently. */
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
      <aside className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        <div
          className={
            inspector ? "min-h-24 flex-1 overflow-hidden" : "min-h-0 flex-1 overflow-hidden"
          }
        >
          {outline}
        </div>
        {inspector ? (
          <ScrollArea className="max-h-[55%] shrink-0 border-t border-border/60">
            {inspector}
          </ScrollArea>
        ) : null}
      </aside>
    </div>
  );
}
