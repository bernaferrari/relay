import type { ProductMapPath } from "@relay/product/map-exploration";
import { ArrowRight, ChevronRight } from "lucide-react";
import { libraryRowSurface } from "./library-row-styles";

/** Repeated observations share a display row; inspection always uses an exact path id. */
export function MapPathActionGroup({
  paths,
  onInspect,
}: {
  paths: readonly ProductMapPath[];
  onInspect(id: string): void;
}) {
  const path = paths[0]!;
  const testCount = new Set(paths.flatMap((item) => item.coveringTests.map((test) => test.id)))
    .size;
  const coverage = testCount ? `${testCount} ${testCount === 1 ? "test" : "tests"}` : "No tests";
  const rowClassName = `${libraryRowSurface} flex min-h-12 w-full items-center gap-3 rounded-md px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring`;
  const content = (
    <>
      <span className="grid min-w-0 flex-1 gap-1 sm:grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)] sm:items-center sm:gap-3">
        <span className="text-sm leading-5">{path.label}</span>
        <ArrowRight className="hidden size-4 text-muted-foreground sm:block" aria-hidden="true" />
        <span className="text-xs leading-5 text-muted-foreground">{path.toTitle ?? "Finish"}</span>
      </span>
      <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
        {paths.length > 1 ? `${paths.length} paths · ` : ""}
        {coverage}
      </span>
    </>
  );
  if (paths.length === 1)
    return (
      <button
        type="button"
        aria-label={`${path.fromTitle} → ${path.toTitle ?? "Finish"}: ${path.label}`}
        onClick={() => onInspect(path.id)}
        className={rowClassName}
      >
        {content}
      </button>
    );
  return (
    <details className="group/path rounded-md">
      <summary
        className={`${rowClassName} cursor-pointer list-none [&::-webkit-details-marker]:hidden`}
      >
        {content}
        <ChevronRight
          className="size-3.5 shrink-0 text-muted-foreground group-open/path:rotate-90"
          aria-hidden="true"
        />
      </summary>
      <ul className="ml-3 border-l border-border/60 py-1 pl-3">
        {paths.map((recorded, index) => {
          const name =
            recorded.coveringTests.map((test) => test.name).join(" · ") ||
            `Recorded path ${index + 1}`;
          return (
            <li key={recorded.id}>
              <button
                type="button"
                aria-label={`Inspect ${recorded.label} · ${name}`}
                className="flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                onClick={() => onInspect(recorded.id)}
              >
                <span className="min-w-0 flex-1 break-words">{name}</span>
                <ChevronRight
                  className="size-3.5 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </button>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
