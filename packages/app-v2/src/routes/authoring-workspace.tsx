import type { ReactNode } from "react";

/** Keep the app anchored while setup, steps, and editing change beside it. */
export function AuthoringWorkspace({
  stage,
  tools,
  inspector,
}: {
  stage: ReactNode;
  tools: ReactNode;
  inspector?: ReactNode;
}) {
  return (
    <div className="grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(260px,32%)] gap-3 p-3 max-[760px]:grid-cols-1 max-[760px]:grid-rows-[minmax(0,1fr)_minmax(160px,.6fr)]">
      <div className="min-h-0 min-w-0 overflow-hidden rounded-lg bg-background/40">{stage}</div>
      <div className="flex min-h-0 min-w-0 flex-col gap-3">
        <div
          className={`min-h-0 min-w-0 overflow-y-auto ${inspector ? "max-h-[40%] shrink-0" : "flex-1"}`}
        >
          {tools}
        </div>
        {inspector ? (
          <div className="min-h-0 min-w-0 flex-1 overflow-y-auto rounded-lg border border-border">
            {inspector}
          </div>
        ) : null}
      </div>
    </div>
  );
}
