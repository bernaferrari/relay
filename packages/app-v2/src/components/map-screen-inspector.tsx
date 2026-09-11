import { isRoutineReturn } from "./map-edges";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, X, RefreshCw } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MapScreenPreview } from "./map-screen-preview";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { localeLabel } from "../lib/locale-label";

export function ScreenInspector({
  loadScreenshot,
  screen: activeScreen,
  paths,
  onSelectScreen,
  onFocusScreen,
  onRename,
  onRefresh,
  saving,
  onClose,
}: {
  paths: readonly ProductMapPath[];
  onSelectScreen(id: string): void;
  onFocusScreen(): void;
  onRename?: (title: string) => Promise<void>;
  onRefresh?: () => void;
  saving: boolean;
  loadScreenshot?: (uri: string) => Promise<Blob>;
  screen: ProductMapScreen | undefined;
  onClose(): void;
}) {
  const [captureSelection, setCaptureSelection] = useState<{
    screenId: string;
    variantId: string;
  }>();
  const [retainedScreen, setRetainedScreen] = useState(activeScreen);
  if (activeScreen && activeScreen !== retainedScreen) setRetainedScreen(activeScreen);
  const screen = activeScreen ?? retainedScreen;
  if (!screen) return null;
  const variants = screen.variants ?? [];
  const selectedCapture =
    variants.find(
      (variant) =>
        captureSelection?.screenId === screen.id && variant.id === captureSelection.variantId,
    ) ?? variants[0];
  const incoming = paths.filter(
    (path) => path.toScreenId === screen.id && path.fromScreenId !== screen.id,
  );
  const outgoing = paths.filter((path) => path.fromScreenId === screen.id);
  return (
    <aside
      className="relay-map-inspector absolute inset-y-0 right-0 z-10 flex w-72 max-w-full flex-col border-l border-border bg-card shadow-lg"
      data-open={Boolean(activeScreen)}
      inert={!activeScreen}
      aria-hidden={!activeScreen}
      aria-label="Screen details"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-xs font-medium text-muted-foreground">Screen</h2>
        <div className="ml-auto flex items-center gap-1">
          {onRefresh ? (
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Update capture"
              title="Update capture"
              onClick={onRefresh}
            >
              <RefreshCw />
            </Button>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            aria-label="Close screen details"
            onClick={onClose}
          >
            <X />
          </Button>
        </div>
      </header>
      <ScrollArea
        className="min-h-0 flex-1"
        viewportProps={{ "aria-label": "Screen information", className: "overscroll-auto" }}
      >
        <div className="space-y-4 px-4 py-4">
          <div className="space-y-2">
            {onRename ? (
              <textarea
                rows={1}
                style={{ fieldSizing: "content" }}
                key={`${screen.id}:${screen.title}`}
                aria-label="Screen name"
                defaultValue={screen.title}
                disabled={saving}
                className="w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium leading-5 outline-none hover:border-input focus:border-input focus:ring-2 focus:ring-ring"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                  if (event.key === "Escape") {
                    event.currentTarget.value = screen.title;
                    event.currentTarget.blur();
                  }
                }}
                onBlur={(event) => {
                  const field = event.currentTarget;
                  const title = field.value.trim();
                  if (title && title !== screen.title)
                    void onRename(title).catch(() => {
                      field.value = screen.title;
                    });
                  else field.value = screen.title;
                }}
              />
            ) : (
              <h3 className="text-sm font-medium">{screen.title}</h3>
            )}
            <button
              type="button"
              className="mx-auto block h-48 max-h-[28vh] w-full rounded-md bg-muted/30 py-2 focus-visible:outline-2 focus-visible:outline-ring"
              aria-label={`Focus ${screen.title} on canvas`}
              onClick={onFocusScreen}
            >
              <MapScreenPreview
                uri={selectedCapture?.screenshotUri ?? screen.screenshotUri}
                load={loadScreenshot}
                title={screen.title}
              />
            </button>
            {screen.description ? (
              <p className="text-xs leading-relaxed text-muted-foreground">{screen.description}</p>
            ) : null}
            {variants.length > 1 ? (
              <div className="space-y-2">
                <label htmlFor="map-screen-capture" className="block text-xs font-medium">
                  Capture <span className="text-muted-foreground">· {variants.length}</span>
                </label>
                <select
                  id="map-screen-capture"
                  value={selectedCapture?.id}
                  className="h-9 w-full rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-2 focus-visible:outline-ring"
                  onChange={(event) =>
                    setCaptureSelection({ screenId: screen.id, variantId: event.target.value })
                  }
                >
                  {variants.map((variant, index) => (
                    <option key={variant.id} value={variant.id}>
                      {variant.locale ? `${localeLabel(variant.locale)} · ` : ""}
                      {variant.capturedAt !== undefined
                        ? new Date(variant.capturedAt).toLocaleString(undefined, {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })
                        : `Capture ${variants.length - index}`}
                      {index === 0 ? " · Latest" : ""}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            {selectedCapture?.sourceRunId ? (
              <Link
                to="/runs/$runId"
                params={{ runId: selectedCapture.sourceRunId }}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                Open source run <ArrowUpRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <section className="space-y-4 border-t border-border pt-4" aria-label="Connected screens">
            <Connections
              title="Arrive from"
              paths={incoming.filter((path) => !isRoutineReturn(path))}
              outgoing={false}
              onSelect={onSelectScreen}
            />
            <Connections
              title="Continue to"
              paths={outgoing.filter((path) => !isRoutineReturn(path))}
              outgoing
              onSelect={onSelectScreen}
            />
            <Connections
              title="Return to"
              paths={outgoing.filter(isRoutineReturn)}
              outgoing
              onSelect={onSelectScreen}
            />
            {!incoming.length && !outgoing.length ? (
              <p className="text-xs text-muted-foreground">No recorded connections yet.</p>
            ) : null}
          </section>
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-xs font-medium">
              Used in tests{" "}
              <span className="ml-1 text-muted-foreground">{screen.coveringTests.length}</span>
            </h3>
            {screen.coveringTests.length ? (
              <ul className="space-y-1">
                {screen.coveringTests.map((test) => (
                  <li key={test.id}>
                    <Link
                      className="flex items-center justify-between gap-2 rounded-md px-2 py-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                      to="/tests/$testId"
                      params={{ testId: test.id }}
                    >
                      <span className="min-w-0 truncate">{test.name}</span>
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">No saved test includes this screen.</p>
            )}
          </section>

          {screen.recentFailures.length ? (
            <section className="space-y-2 border-t border-border pt-4">
              <h3 className="text-xs font-medium">Recent failures</h3>
              <ul className="space-y-1">
                {screen.recentFailures.map((failure) => (
                  <li key={failure.id}>
                    <Link
                      className="block rounded-md px-2 py-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                      to="/runs/$runId"
                      params={{ runId: failure.runId }}
                    >
                      {failure.outcome.replaceAll("-", " ")}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </ScrollArea>
    </aside>
  );
}

function Connections({
  title,
  paths,
  outgoing,
  onSelect,
}: {
  title: string;
  paths: readonly ProductMapPath[];
  outgoing: boolean;
  onSelect(id: string): void;
}) {
  if (!paths.length) return null;
  const Icon = outgoing ? ArrowUpRight : ArrowDownLeft;
  return (
    <div className="space-y-1">
      <h3 className="flex items-center gap-2 pb-1 text-[11px] font-medium text-muted-foreground">
        <Icon className="size-3.5 text-muted-foreground" />
        {title}
      </h3>
      {paths.map((path) => {
        const id = outgoing ? path.toScreenId : path.fromScreenId;
        const name = outgoing ? (path.toTitle ?? "Finish") : path.fromTitle;
        const content = (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{name}</span>
              {!isRoutineReturn(path) && path.label !== name ? (
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
                  {path.label}
                </span>
              ) : null}
            </span>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
          </>
        );
        return id ? (
          <button
            key={path.id}
            type="button"
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
            onClick={() => onSelect(id)}
          >
            {content}
          </button>
        ) : (
          <div key={path.id} className="px-2 py-2 text-xs">
            {content}
          </div>
        );
      })}
    </div>
  );
}
