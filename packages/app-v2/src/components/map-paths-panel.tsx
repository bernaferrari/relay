import { useState } from "react";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { ArrowRight, Route, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MapScreenPreview } from "./map-screen-preview";
import { libraryRowSurface } from "./library-row-styles";
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
        <div className="space-y-10">
          {[...groups].map(([screenId, connections]) => {
            const screen = screenById.get(screenId);
            return (
              <section
                key={screenId}
                className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-6"
                aria-label={`Paths from ${connections[0]!.fromTitle}`}
              >
                <div aria-hidden="true" className="h-24 w-16 sm:h-36 sm:w-24">
                  <MapScreenPreview
                    uri={screen?.screenshotUri}
                    load={loadScreenshot}
                    title={screen?.title ?? ""}
                    align="top"
                    thumbnail
                  />
                </div>
                <div className="min-w-0">
                  <header className="mb-2 flex min-h-8 items-center gap-3 px-3">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-medium">
                      {connections[0]!.fromTitle}
                    </h3>
                    <span className="text-xs tabular-nums text-muted-foreground">
                      {connections.length} {connections.length === 1 ? "path" : "paths"}
                    </span>
                  </header>
                  <ul className="space-y-1">
                    {connections.map((path) => (
                      <li key={path.id}>
                        <button
                          type="button"
                          aria-label={`${path.fromTitle} → ${path.toTitle ?? "Finish"}`}
                          onClick={() => onInspect(path.id)}
                          className={`${libraryRowSurface} grid min-h-14 w-full grid-cols-[16px_minmax(0,1fr)_64px] items-center gap-x-3 gap-y-1 rounded-md px-3 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[minmax(0,1fr)_16px_minmax(0,1fr)_72px]`}
                        >
                          <span className="col-span-2 min-w-0 text-sm font-medium leading-5 sm:col-span-1">
                            {path.label}
                          </span>
                          <ArrowRight
                            className="col-start-1 row-start-2 size-4 text-muted-foreground sm:col-start-2 sm:row-start-1"
                            aria-hidden="true"
                          />
                          <span className="col-start-2 row-start-2 min-w-0 text-xs leading-5 text-muted-foreground sm:col-start-3 sm:row-start-1">
                            {path.toTitle ?? "Finish"}
                          </span>
                          <span className="col-start-3 row-span-2 row-start-1 text-right text-xs tabular-nums text-muted-foreground sm:col-start-4 sm:row-span-1">
                            {path.coveringTests.length
                              ? `${path.coveringTests.length} ${path.coveringTests.length === 1 ? "test" : "tests"}`
                              : "No tests"}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </section>
  );
}
