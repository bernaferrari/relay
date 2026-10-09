/** @jsxImportSource react */
import type { AppMapObservedScreen } from "@relay/protocol";
import { Link } from "@tanstack/react-router";
import { MapScreenPreview } from "./map-screen-preview";

/**
 * Screens runs reached that the map does not know yet. They are evidence,
 * not map entries: nothing here changes what saved Tests run.
 */
export function MapNewScreensTray({
  screens,
  frameUri,
  loadScreenshot,
}: {
  screens: readonly AppMapObservedScreen[];
  frameUri(runId: string, file: string): string;
  loadScreenshot?: (uri: string) => Promise<Blob>;
}) {
  const fresh = screens
    .filter((screen) => screen.status === "new")
    .sort((left, right) => (right.lastSeenAt ?? 0) - (left.lastSeenAt ?? 0));
  if (!fresh.length) return null;
  return (
    <section
      aria-label="New screens from runs"
      className="shrink-0 border-b border-border bg-muted/20 px-4 py-3"
    >
      <h2 className="text-xs font-medium text-muted-foreground">
        New from runs · {fresh.length} {fresh.length === 1 ? "screen" : "screens"} the map does not
        know yet
      </h2>
      <ul className="mt-2 flex list-none gap-3 overflow-x-auto p-0 pb-1">
        {fresh.map((screen) => (
          <li key={screen.key} className="w-28 shrink-0">
            <Link
              to="/runs/$runId"
              params={{ runId: screen.lastRunId ?? screen.frame?.runId ?? "" }}
              className="grid gap-1 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
            >
              <div className="h-40 overflow-hidden rounded-md border border-border bg-background">
                <MapScreenPreview
                  thumbnail
                  align="top"
                  title={screen.title}
                  {...(screen.frame
                    ? { uri: frameUri(screen.frame.runId, screen.frame.file) }
                    : {})}
                  {...(loadScreenshot ? { load: loadScreenshot } : {})}
                />
              </div>
              <span className="truncate text-xs font-medium">{screen.title}</span>
              <span className="text-xs text-muted-foreground">
                Seen in {screen.runCount} {screen.runCount === 1 ? "run" : "runs"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
