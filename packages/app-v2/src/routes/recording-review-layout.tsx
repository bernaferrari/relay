import type { ReactNode } from "react";

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
    <div
      className={`relative grid min-h-0 flex-1 gap-3 p-3 ${inspector ? "grid-cols-[220px_minmax(0,1fr)_300px] max-[1200px]:grid-cols-[200px_minmax(0,1fr)]" : "grid-cols-[minmax(180px,260px)_minmax(0,1fr)]"}`}
    >
      <div className="min-h-0 min-w-0 overflow-y-auto">{outline}</div>
      <div className="min-h-0 min-w-0">{stage}</div>
      {inspector ? (
        <div className="min-h-0 min-w-0 overflow-y-auto max-[1200px]:absolute max-[1200px]:inset-y-0 max-[1200px]:right-0 max-[1200px]:z-10 max-[1200px]:w-[300px] max-[1200px]:rounded-xl max-[1200px]:bg-card max-[1200px]:shadow-xl">
          {inspector}
        </div>
      ) : null}
    </div>
  );
}
