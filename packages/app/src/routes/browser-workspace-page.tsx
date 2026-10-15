/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { Columns2, Plus } from "lucide-react";
import {
  BROWSER_WORKSPACE_KEY,
  BrowserWorkspaceError,
  MAX_BROWSER_TILES,
  admitBrowserTile,
  pairedBrowserTiles,
  type BrowserTile,
} from "../data/browser-workspace";
import {
  PAIRED_CONFIGURATION_STORAGE_KEY,
  parsePairedConfigurationWorkspace,
} from "../data/paired-configuration";
import {
  browserLayoutGeometry,
  defaultBrowserLayout,
  dockBrowser,
  dockBrowserToEdge,
  neighboringBrowser,
  FULL_BROWSER_RECT,
  resizeBrowserSplit,
  reorderBrowserLayout,
  restoreBrowserLayout,
  type BrowserLayout,
} from "../data/browser-workspace-layout";
import { parseBrowserWorkspace } from "../data/browser-workspace-state";
import type { BrowserDockTarget } from "./browser-workspace-header";
import { BrowserWorkspaceGrid } from "./browser-workspace-grid";
import { BrowserWorkspaceLayoutMenu } from "./browser-workspace-layout-menu";
import { BrowserWorkspacePicker } from "./browser-workspace-picker";
import { BrowserWorkspaceDropPreview } from "./browser-workspace-drop-preview";
import { BrowserWorkspaceTile } from "./browser-workspace-tile";
import { useBrowserWorkspaceFocus } from "./browser-workspace-focus";
import { errorMessage } from "./recording-shared";

export function BrowserWorkspacePage({ paired = false }: { paired?: boolean }) {
  const { browserSpacesService, platform } = useRouteContext({ from: "__root__" });
  const [tiles, setTiles] = useState<BrowserTile[]>();
  const [picker, setPicker] = useState(false);
  const [over, setOver] = useState<BrowserDockTarget>();
  const [dragging, setDragging] = useState<string>();
  const previewElement = useRef<HTMLDivElement>(null);
  const previewBefore = useRef<DOMRect | undefined>(undefined);
  const [layout, setLayout] = useState<BrowserLayout>();
  const savedLayout = useRef<BrowserLayout | undefined>(undefined);
  const [announcement, setAnnouncement] = useState("");
  const { focused, focus, prepare, container } = useBrowserWorkspaceFocus();
  const [issue, setIssue] = useState<string>();
  const [saving, setSaving] = useState(false);
  const spaces = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
  });
  const [loadIssue, setLoadIssue] = useState<string>();
  const [loadAttempt, setLoadAttempt] = useState(0);
  useEffect(() => {
    let disposed = false;
    setLoadIssue(undefined);
    void (async () => {
      const raw = await platform.storage.get(
        paired ? PAIRED_CONFIGURATION_STORAGE_KEY : BROWSER_WORKSPACE_KEY,
      );
      const pairedTiles = paired
        ? pairedBrowserTiles(parsePairedConfigurationWorkspace(raw))
        : undefined;
      const next = pairedTiles
        ? { tiles: pairedTiles, layout: defaultBrowserLayout(pairedTiles.map((tile) => tile.id)) }
        : parseBrowserWorkspace(raw);
      if (!disposed) {
        setTiles(next.tiles);
        setLayout(next.layout);
        savedLayout.current = next.layout;
      }
    })().catch((error: unknown) => {
      if (!disposed)
        setLoadIssue(
          error instanceof BrowserWorkspaceError
            ? error.message
            : "Couldn’t load this workspace. Try again.",
        );
    });
    return () => {
      disposed = true;
    };
  }, [paired, platform, loadAttempt]);
  async function save(
    next: BrowserTile[],
    nextLayout = restoreBrowserLayout(
      layout,
      next.map((tile) => tile.id),
    ),
    animate = false,
    optimistic = false,
  ) {
    setSaving(true);
    setIssue(undefined);
    const previousLayout = savedLayout.current;
    const commit = () => {
      prepare(animate);
      setTiles(next);
      setLayout(nextLayout);
    };
    if (optimistic) commit();
    try {
      await platform.storage.set(
        BROWSER_WORKSPACE_KEY,
        JSON.stringify({ version: 2, tiles: next, layout: nextLayout }),
      );
      if (!optimistic) commit();
      savedLayout.current = nextLayout;
    } catch (error) {
      if (optimistic) {
        prepare(true);
        setLayout(previousLayout);
      }
      setIssue("Couldn’t save this workspace. Free up browser storage and try again.");
      throw error;
    } finally {
      setSaving(false);
    }
  }
  function move(sourceId: string, targetId: string) {
    if (!tiles || saving || sourceId === targetId) return;
    const source = tiles.findIndex((tile) => tile.id === sourceId),
      target = tiles.findIndex((tile) => tile.id === targetId);
    if (source < 0 || target < 0) return;
    const next = [...tiles];
    [next[source], next[target]] = [next[target]!, next[source]!];
    void save(
      next,
      layout
        ? reorderBrowserLayout(
            layout,
            tiles.map((tile) => tile.id),
            next.map((tile) => tile.id),
          )
        : defaultBrowserLayout(next.map((tile) => tile.id)),
    )
      .then(() =>
        setAnnouncement(
          `${next.find((tile) => tile.id === sourceId)?.name} moved to position ${next.findIndex((tile) => tile.id === sourceId) + 1}.`,
        ),
      )
      .catch(() => undefined);
  }
  function dock(sourceId: string, target: BrowserDockTarget) {
    if (!layout || !tiles || saving) return;
    const next = target.workspace
      ? dockBrowserToEdge(layout, sourceId, target.side)
      : dockBrowser(layout, sourceId, target.targetId, target.side);
    if (next === layout) return;
    void save(tiles, next, true, true)
      .then(() =>
        setAnnouncement(
          `${tiles.find((tile) => tile.id === sourceId)?.name} moved ${target.side === "top" ? "above" : target.side === "bottom" ? "below" : `to the ${target.side} of`} ${target.workspace ? "the workspace" : tiles.find((tile) => tile.id === target.targetId)?.name}.`,
        ),
      )
      .catch(() => undefined);
  }
  const geometry = browserLayoutGeometry(layout);
  const destination =
    layout && dragging && over
      ? browserLayoutGeometry(
          over.workspace
            ? dockBrowserToEdge(layout, dragging, over.side)
            : dockBrowser(layout, dragging, over.targetId, over.side),
        ).tiles[dragging]
      : undefined;
  const count = tiles?.length ?? 0;
  return (
    <section
      ref={container}
      className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden px-4 py-4"
      aria-label="Browser workspace"
    >
      <header className="mb-4 flex shrink-0 flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Button
            variant="ghost"
            size="sm"
            nativeButton={false}
            render={<Link to="/environments" />}
          >
            Browsers
          </Button>
          <h1 className="text-lg font-semibold">Workspace</h1>
        </div>
        <div className="flex items-center gap-2">
          {count > 1 ? (
            <BrowserWorkspaceLayoutMenu
              ids={tiles!.map((tile) => tile.id)}
              disabled={saving}
              onSelect={(next, animate) => {
                focus(undefined);
                void save(tiles!, next, animate, true).catch(() => undefined);
              }}
            />
          ) : null}
          {focused ? (
            <Button variant="outline" onClick={(event) => focus(undefined, event.detail > 0)}>
              <Columns2 aria-hidden="true" />
              Show all
            </Button>
          ) : null}
          <Button
            onClick={() => setPicker(true)}
            disabled={tiles === undefined || count >= MAX_BROWSER_TILES || saving}
          >
            <Plus aria-hidden="true" />
            Add browser
          </Button>
        </div>
      </header>
      {loadIssue || issue || spaces.error ? (
        <div role="alert" className="mb-4 flex items-center gap-3 text-sm text-destructive">
          {loadIssue ?? issue ?? errorMessage(spaces.error)}
          {loadIssue ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setLoadAttempt((value) => value + 1)}
            >
              Retry
            </Button>
          ) : null}
          {loadIssue ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void save([])
                  .then(() => setLoadIssue(undefined))
                  .catch(() => undefined);
              }}
            >
              Start new workspace
            </Button>
          ) : null}
          {spaces.error ? (
            <Button variant="outline" size="sm" onClick={() => void spaces.refetch()}>
              Reload profiles
            </Button>
          ) : null}
        </div>
      ) : null}
      {tiles === undefined && !loadIssue ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading workspace…
        </p>
      ) : null}
      {tiles && !count ? (
        <div className="grid min-h-80 flex-1 place-content-center justify-items-center gap-3 rounded-xl border border-dashed border-border">
          <Columns2 className="size-8 text-muted-foreground" aria-hidden="true" />
          <h2 className="text-base font-medium">Your browsers, side by side</h2>
          <p className="max-w-sm text-center text-sm text-muted-foreground">
            Open up to four profiles. Sign in as different people and control each browser
            independently.
          </p>
          <Button variant="outline" onClick={() => setPicker(true)}>
            Open first browser
          </Button>
        </div>
      ) : null}
      <span role="status" className="sr-only">
        {announcement}
      </span>
      {count ? (
        <BrowserWorkspaceGrid
          layout={layout}
          focused={Boolean(focused)}
          onResize={(path, ratio, persist) => {
            if (!layout || !tiles || saving) return;
            const next = resizeBrowserSplit(layout, path, ratio);
            prepare(false);
            setLayout(next);
            if (persist) void save(tiles, next).catch(() => setLayout(savedLayout.current));
          }}
        >
          {tiles?.map((tile) => (
            <BrowserWorkspaceTile
              key={tile.id}
              rect={focused ? FULL_BROWSER_RECT : (geometry.tiles[tile.id] ?? FULL_BROWSER_RECT)}
              dragging={dragging === tile.id}
              controls={{
                disabled: saving || Boolean(focused) || count < 2,
                onDrag: (active, cancelled) => {
                  if (!active && cancelled) prepare(true);
                  setDragging(active ? tile.id : undefined);
                },
                onHover: (target) => {
                  if (
                    over?.targetId === target?.targetId &&
                    over?.side === target?.side &&
                    over?.workspace === target?.workspace
                  )
                    return;
                  previewBefore.current = previewElement.current?.getBoundingClientRect();
                  setOver(target);
                },
                onDrop: (target) => dock(tile.id, target),
                onMove: (direction) => {
                  const target = layout && neighboringBrowser(layout, tile.id, direction);
                  if (target) move(tile.id, target);
                },
              }}
              tile={tile}
              focused={focused === tile.id}
              hidden={Boolean(focused && focused !== tile.id)}
              onFocus={(event) =>
                focus(focused === tile.id ? undefined : tile.id, event.detail > 0)
              }
              onRemove={() => {
                if (saving) return;
                void save(tiles.filter((current) => current.id !== tile.id))
                  .then(() => {
                    if (focused === tile.id) focus(undefined);
                  })
                  .catch(() => undefined);
              }}
            />
          ))}
          {destination && over ? (
            <BrowserWorkspaceDropPreview
              elementRef={previewElement}
              before={previewBefore.current}
              rect={destination}
              side={over.side}
              sourceName={tiles?.find((tile) => tile.id === dragging)?.name ?? "Browser"}
              name={
                over.workspace
                  ? "workspace"
                  : (tiles?.find((tile) => tile.id === over.targetId)?.name ?? "browser")
              }
            />
          ) : null}
        </BrowserWorkspaceGrid>
      ) : null}
      {picker ? (
        <BrowserWorkspacePicker
          spaces={spaces.data ?? []}
          used={(tiles ?? []).map((tile) => tile.browserId)}
          onClose={() => setPicker(false)}
          onAdd={async (tile) => {
            await save(admitBrowserTile(tiles ?? [], tile));
            focus(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
