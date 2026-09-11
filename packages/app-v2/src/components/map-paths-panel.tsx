import { useState } from "react";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { ArrowRight, ChevronRight, Route, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MapScreenPreview } from "./map-screen-preview";
import { EmptyState } from "./product-patterns";

export function MapPathsPanel({
  appId,
  paths,
  screens,
  loadScreenshot,
  onInspect,
}: {
  appId: string;
  paths: readonly ProductMapPath[];
  screens: readonly ProductMapScreen[];
  loadScreenshot?: (uri: string) => Promise<Blob>;
  onInspect(id: string): void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matches = paths.filter((path) =>
    [path.label, path.fromTitle, path.toTitle, ...path.coveringTests.map((test) => test.name)]
      .join(" ")
      .toLocaleLowerCase()
      .includes(query),
  );
  const groups = new Map<string, ProductMapPath[]>();
  for (const path of matches) {
    const group = groups.get(path.fromScreenId) ?? [];
    group.push(path);
    groups.set(path.fromScreenId, group);
  }
  const screenById = new Map(screens.map((screen) => [screen.id, screen]));
  return (
    <section className="min-h-0 flex-1 overflow-auto bg-card" aria-labelledby="paths-title">
      <div className="mx-auto max-w-5xl px-6 py-8 sm:px-8">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h2 id="paths-title" className="text-xl font-semibold tracking-tight">
              Paths
            </h2>
            <span className="text-xs tabular-nums text-muted-foreground" role="status">
              {query ? `${matches.length} of ${paths.length}` : paths.length}
            </span>
          </div>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link to="/tests/new" search={{ app: appId, view: "path" }} />}
          >
            <Route className="size-3.5" /> Create test from path
          </Button>
        </header>
        <div className="relative mb-6 max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="map-path-search"
            type="search"
            aria-label="Search paths"
            placeholder="Find a screen, action, or test…"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        {matches.length === 0 ? (
          <EmptyState
            title={query ? "No matching paths" : "No paths recorded yet"}
            detail={
              query
                ? "Try another screen, action, or test name."
                : "Record a test to capture connections between screens."
            }
            action={
              query ? (
                <Button variant="outline" onClick={() => setSearch("")}>
                  Clear search
                </Button>
              ) : undefined
            }
          />
        ) : null}
        <div className="space-y-6">
          {[...groups].map(([screenId, connections]) => {
            const screen = screenById.get(screenId);
            return (
              <section
                key={screenId}
                className="overflow-hidden rounded-xl border border-border"
                aria-label={`Paths from ${connections[0]!.fromTitle}`}
              >
                <header className="flex items-center gap-3 border-b border-border bg-muted/30 px-4 py-3">
                  <div aria-hidden="true" className="h-10 w-9 shrink-0">
                    <MapScreenPreview
                      uri={screen?.screenshotUri}
                      load={loadScreenshot}
                      title={screen?.title ?? ""}
                      thumbnail
                    />
                  </div>
                  <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                    {connections[0]!.fromTitle}
                  </h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {connections.length} {connections.length === 1 ? "path" : "paths"}
                  </span>
                </header>
                <ul className="divide-y divide-border">
                  {connections.map((path) => (
                    <li key={path.id}>
                      <button
                        type="button"
                        aria-label={`${path.fromTitle} → ${path.toTitle ?? "Finish"}`}
                        onClick={() => onInspect(path.id)}
                        className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto_auto]"
                      >
                        <span className="min-w-0 text-sm font-medium">{path.label}</span>
                        <span className="col-start-1 flex min-w-0 items-center gap-2 text-xs text-muted-foreground sm:col-auto">
                          <ArrowRight className="size-3.5 shrink-0" />
                          <span className="truncate">{path.toTitle ?? "Finish"}</span>
                        </span>
                        <span className="hidden text-xs tabular-nums text-muted-foreground sm:block">
                          {path.coveringTests.length
                            ? `${path.coveringTests.length} ${path.coveringTests.length === 1 ? "test" : "tests"}`
                            : "No tests"}
                        </span>
                        <ChevronRight className="col-start-2 row-start-1 size-3.5 text-muted-foreground sm:col-auto sm:row-auto" />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
