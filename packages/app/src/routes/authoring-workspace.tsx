import { workspacePreviewSurface } from "../components/workspace-surfaces";
import type { ReactNode } from "react";

/** Keep the app anchored while setup, steps, and editing change beside it. */
export function AuthoringWorkspace({
  stage,
  tools,
  inspector,
  mobileOrder = "preview-first",
}: {
  stage: ReactNode;
  tools: ReactNode;
  inspector?: ReactNode;
  mobileOrder?: "preview-first" | "setup-first";
}) {
  const setupFirst = mobileOrder === "setup-first";
  const preview = (
    <div
      className={`${workspacePreviewSurface} order-2 ${setupFirst ? "@max-[640px]:h-96" : "@max-[640px]:order-1"}`}
    >
      {stage}
    </div>
  );
  const controls = (
    <div
      className={`order-1 flex min-h-0 min-w-0 flex-col gap-3 ${setupFirst ? "" : "@max-[640px]:order-2"}`}
    >
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
  );
  return (
    <div className="@container flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div
        className={`grid h-full min-h-0 min-w-0 flex-1 grid-cols-[minmax(260px,22rem)_minmax(0,1fr)] gap-3 p-3 @max-[760px]:grid-cols-[minmax(260px,18rem)_minmax(0,1fr)] @max-[640px]:grid-cols-1 @max-[640px]:shrink-0 ${setupFirst ? "@max-[640px]:h-auto @max-[640px]:flex-none @max-[640px]:grid-rows-[auto_auto]" : "@max-[640px]:min-h-115 @max-[640px]:grid-rows-[minmax(260px,1fr)_minmax(160px,.6fr)]"}`}
      >
        {controls}
        {preview}
      </div>
    </div>
  );
}
