/** @jsxImportSource react */
import { useEffect, useState } from "react";
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
  moveBrowserTile,
  parseBrowserTiles,
  type BrowserTile,
} from "../data/browser-workspace";
import {
  PAIRED_CONFIGURATION_STORAGE_KEY,
  parsePairedConfigurationWorkspace,
} from "../data/paired-configuration";
import { BrowserWorkspaceGrip } from "./browser-workspace-grip";
import { BrowserWorkspaceGrid } from "./browser-workspace-grid";
import { BrowserWorkspacePicker } from "./browser-workspace-picker";
import { BrowserWorkspaceTile } from "./browser-workspace-tile";
import { errorMessage } from "./recording-shared";

export function BrowserWorkspacePage({ paired = false }: { paired?: boolean }) {
  const { browserSpacesService, platform } = useRouteContext({ from: "__root__" });
  const [tiles, setTiles] = useState<BrowserTile[]>();
  const [picker, setPicker] = useState(false);
  const [over, setOver] = useState<string>();
  const [announcement, setAnnouncement] = useState("");
  const [focused, setFocused] = useState<string>();
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
      const next = paired
        ? pairedBrowserTiles(parsePairedConfigurationWorkspace(raw))
        : parseBrowserTiles(raw);
      if (!disposed) setTiles(next);
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
  async function save(next: BrowserTile[]) {
    setSaving(true);
    setIssue(undefined);
    try {
      await platform.storage.set(BROWSER_WORKSPACE_KEY, JSON.stringify(next));
      setTiles(next);
    } catch (error) {
      setIssue("Couldn’t save this workspace. Free up browser storage and try again.");
      throw error;
    } finally {
      setSaving(false);
    }
  }
  function move(sourceId: string, targetId: string) {
    if (!tiles || saving || sourceId === targetId) return;
    const next = moveBrowserTile(tiles, sourceId, targetId);
    void save(next)
      .then(() =>
        setAnnouncement(
          `${next.find((tile) => tile.id === sourceId)?.name} moved to position ${next.findIndex((tile) => tile.id === sourceId) + 1}.`,
        ),
      )
      .catch(() => undefined);
  }
  const count = tiles?.length ?? 0;
  return (
    <section
      className="flex h-full min-h-0 min-w-0 flex-col overflow-auto px-4 py-4"
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
          {focused ? (
            <Button variant="outline" onClick={() => setFocused(undefined)}>
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
        <BrowserWorkspaceGrid count={count} focused={Boolean(focused)}>
          {tiles?.map((tile, index) => (
            <BrowserWorkspaceTile
              key={tile.id}
              className={`${count === 3 && index === 0 && !focused ? "min-[761px]:row-span-2" : ""} ${over === tile.id ? "ring-2 ring-primary" : ""}`}
              grip={
                <BrowserWorkspaceGrip
                  name={tile.name}
                  disabled={saving || Boolean(focused) || count < 2}
                  onHover={setOver}
                  onDrop={(targetId) => move(tile.id, targetId)}
                  onMove={(offset) => {
                    const target = tiles[Math.max(0, Math.min(count - 1, index + offset))];
                    if (target) move(tile.id, target.id);
                  }}
                />
              }
              tile={tile}
              focused={focused === tile.id}
              hidden={Boolean(focused && focused !== tile.id)}
              onFocus={() => setFocused((current) => (current === tile.id ? undefined : tile.id))}
              onRemove={() => {
                if (saving) return;
                void save(tiles.filter((current) => current.id !== tile.id))
                  .then(() => {
                    if (focused === tile.id) setFocused(undefined);
                  })
                  .catch(() => undefined);
              }}
            />
          ))}
        </BrowserWorkspaceGrid>
      ) : null}
      {picker ? (
        <BrowserWorkspacePicker
          spaces={spaces.data ?? []}
          used={(tiles ?? []).map((tile) => tile.browserId)}
          onClose={() => setPicker(false)}
          onAdd={async (tile) => {
            await save(admitBrowserTile(tiles ?? [], tile));
            setFocused(undefined);
          }}
        />
      ) : null}
    </section>
  );
}
