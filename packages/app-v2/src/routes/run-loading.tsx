/** @jsxImportSource react */
import { LoaderCircle } from "lucide-react";

/** Keep the evidence workspace visible while its saved result is being restored. */
export function RunLoading() {
  return (
    <section
      aria-label="Loading run details"
      aria-busy="true"
      className="mt-6 overflow-hidden rounded-xl bg-muted/30"
    >
      <div className="flex items-center gap-3 px-5 py-4" role="status">
        <LoaderCircle
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground motion-safe:animate-spin"
        />
        <p className="text-sm text-muted-foreground">Loading steps and captures…</p>
      </div>
      <div
        aria-hidden="true"
        className="grid min-h-[360px] grid-cols-1 gap-px bg-border/40 md:grid-cols-[minmax(0,1fr)_320px]"
      >
        <div className="flex items-center justify-center bg-background/80 p-8">
          <div className="h-64 w-32 rounded-xl bg-muted/70 ring-1 ring-inset ring-border/50" />
        </div>
        <div className="space-y-6 bg-background/80 p-6">
          <div className="h-3 w-20 rounded bg-muted" />
          {[
            ["72", "w-[72%]"],
            ["88", "w-[88%]"],
            ["60", "w-[60%]"],
            ["80", "w-[80%]"],
          ].map(([key, widthClass]) => (
            <div key={key} className="flex items-center gap-3">
              <div className="size-5 shrink-0 rounded-full bg-muted" />
              <div className={`h-3 rounded bg-muted ${widthClass}`} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
