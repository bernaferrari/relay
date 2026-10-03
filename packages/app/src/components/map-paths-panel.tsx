import { useState } from "react";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Route, Search } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Dialog, DialogTrigger } from "@relay/ui-react/components/dialog";
import { MapPreviewDialogContent } from "./map-preview-dialog-content";
import { MapScreenPreview } from "./map-screen-preview";
import { MapPathActionGroup } from "./map-path-action-group";
import { mapActionGroups } from "./map-path-groups";
import { EmptyState } from "./product-patterns";

export function MapPathsPanel({
  appId,
  paths,
  screens,
  loadScreenshot,
  onInspect,
  onOpenScreen,
}: {
  appId: string;
  paths: readonly ProductMapPath[];
  screens: readonly ProductMapScreen[];
  loadScreenshot?: (uri: string) => Promise<Blob>;
  onInspect(id: string): void;
  onOpenScreen(id: string): void;
}) {
  const [search, setSearch] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const matches = paths.filter((path) =>
    [path.label, path.fromTitle, path.toTitle, ...path.coveringTests.map((test) => test.name)]
      .join("")
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
              {mapActionGroups(matches).length} actions ·{" "}
              {query ? `${matches.length} of ${paths.length}` : paths.length} recorded paths
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
        <div className="space-y-5">
          {[...groups].map(([screenId, connections]) => {
            const screen = screenById.get(screenId);
            const actions = mapActionGroups(connections);
            return (
              <section
                key={screenId}
                className="grid grid-cols-[64px_minmax(0,1fr)] items-start gap-4 rounded-xl bg-[color-mix(in_oklch,var(--card)_96%,var(--foreground)_4%)] p-4 sm:grid-cols-[96px_minmax(0,1fr)] sm:gap-6 sm:p-5"
                aria-label={`Paths from ${connections[0]!.fromTitle}`}
              >
                <Dialog>
                  <DialogTrigger
                    className="group/map-screen h-24 w-16 rounded outline-none sm:w-24"
                    aria-label={`Preview ${connections[0]!.fromTitle}`}
                  >
                    <MapScreenPreview
                      uri={screen?.screenshotUri}
                      load={loadScreenshot}
                      title={screen?.title ?? ""}
                      align="top"
                      interactive
                      thumbnail
                    />
                  </DialogTrigger>
                  <MapPreviewDialogContent
                    title={connections[0]!.fromTitle}
                    uri={screen?.screenshotUri}
                    load={loadScreenshot}
                    onOpenMap={() => onOpenScreen(screenId)}
                  />
                </Dialog>
                <div className="min-w-0">
                  <header className="mb-3 flex min-h-8 items-center gap-3 border-b border-border/40 px-3 pb-3">
                    <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">
                      {connections[0]!.fromTitle}
                    </h3>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {actions.length} {actions.length === 1 ? "action" : "actions"}
                    </span>
                  </header>
                  <ul className="space-y-1">
                    {actions.map((group) => (
                      <li key={group[0]!.id}>
                        <MapPathActionGroup paths={group} onInspect={onInspect} />
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
