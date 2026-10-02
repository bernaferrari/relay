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
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-[minmax(260px,22rem)_minmax(0,1fr)] gap-3 p-3 max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(10rem,.6fr)_minmax(20rem,1fr)] max-[760px]:overflow-y-auto">
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
      <div className="min-h-0 min-w-0 overflow-hidden rounded-xl bg-background/40">{stage}</div>
    </div>
  );
}
