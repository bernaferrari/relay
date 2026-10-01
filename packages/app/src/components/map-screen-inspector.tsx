import { InspectorConnections } from "./map-inspector-connections";
import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { ArrowUpRight, ChevronRight, MoreHorizontal, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MapScreenPreview } from "./map-screen-preview";
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { localeLabel } from "../lib/locale-label";
import { SelectField } from "./filter-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";

export function ScreenInspector({
  loadScreenshot,
  screen: activeScreen,
  paths,
  onSelectScreen,
  onSelectPath,
  onFocusScreen,
  onRename,
  onRefresh,
  onMerge,
  saving,
  onClose,
}: {
  paths: readonly ProductMapPath[];
  onSelectScreen(id: string): void;
  onSelectPath(id: string): void;
  onFocusScreen(): void;
  onRename?: (title: string) => Promise<void>;
  onRefresh?: () => void;
  onMerge?: () => void;
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
  return (
    <aside
      data-slot="map-inspector"
      className="absolute inset-y-0 right-0 z-10 flex w-72 max-w-full flex-col border-l border-border bg-card shadow-lg"
      data-open={Boolean(activeScreen)}
      inert={!activeScreen}
      aria-hidden={!activeScreen}
      aria-label="Screen details"
    >
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-border px-4">
        <h2 className="text-xs font-medium text-muted-foreground">Screen details</h2>
        <div className="ml-auto flex items-center gap-1">
          {onRefresh || onMerge ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="size-11"
                    aria-label="Screen actions"
                  />
                }
              >
                <MoreHorizontal />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onRefresh ? (
                  <DropdownMenuItem className="min-h-11" disabled={saving} onClick={onRefresh}>
                    Update screen capture
                  </DropdownMenuItem>
                ) : null}
                {onMerge ? (
                  <DropdownMenuItem className="min-h-11" disabled={saving} onClick={onMerge}>
                    Merge duplicate screen…
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          <Button
            size="icon-sm"
            variant="ghost"
            className="size-11"
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
                key={`${screen.id}:${screen.title}`}
                aria-label="Screen name"
                defaultValue={screen.title}
                disabled={saving}
                className="field-sizing-content w-full resize-none rounded-md border border-transparent bg-transparent px-1 py-1 text-sm font-medium leading-5 outline-none hover:border-input focus:border-input focus:ring-2 focus:ring-ring"
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
              <div className="space-y-1.5">
                <SelectField
                  id="map-screen-capture"
                  label={`Saved captures (${variants.length})`}
                  className="[&_[data-slot=select-trigger]]:min-h-11"
                  value={selectedCapture?.id ?? ""}
                  options={variants.map((variant, index) => ({
                    value: variant.id,
                    label: `${index === 0 ? "Latest" : `Capture ${variants.length - index}`} · ${variant.locale ? `${localeLabel(variant.locale)} · ` : ""}${
                      variant.capturedAt !== undefined
                        ? new Date(variant.capturedAt).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })
                        : "Date unavailable"
                    }`,
                  }))}
                  onValueChange={(variantId) =>
                    setCaptureSelection({ screenId: screen.id, variantId })
                  }
                />
                <p className="text-xs leading-5 text-muted-foreground">
                  Saved views of the same screen.
                </p>
              </div>
            ) : null}
            {selectedCapture?.sourceRunId ? (
              <Link
                to="/runs/$runId"
                params={{ runId: selectedCapture.sourceRunId }}
                className="inline-flex min-h-11 items-center gap-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
              >
                Open source run <ArrowUpRight className="size-3.5" />
              </Link>
            ) : null}
          </div>
          <section className="space-y-4 border-t border-border pt-4" aria-label="Connected screens">
            <h3 className="text-sm font-medium">Connected screens</h3>
            <InspectorConnections
              key={screen.id}
              screenId={screen.id}
              screenTitle={screen.title}
              paths={paths}
              onSelectScreen={onSelectScreen}
              onSelectPath={onSelectPath}
            />
          </section>
          {screen.ignoreRegionNames?.length ? (
            <details className="group border-t border-border pt-2">
              <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 text-xs font-medium text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                <ChevronRight className="size-3.5 group-open:rotate-90" />
                Screen matching
              </summary>
              <div className="space-y-2 pb-2 text-xs leading-5 text-muted-foreground">
                <p>Ignored content: {screen.ignoreRegionNames.join(", ")}.</p>
                <p>
                  Changes here don’t identify a different screen. Screenshot checks use their saved
                  comparison rules.
                </p>
              </div>
            </details>
          ) : null}
          <section className="space-y-2 border-t border-border pt-4">
            <h3 className="text-xs font-medium">
              Used in {screen.coveringTests.length}{" "}
              {screen.coveringTests.length === 1 ? "test" : "tests"}
            </h3>
            {screen.coveringTests.length ? (
              <ul className="space-y-1">
                {screen.coveringTests.map((test) => (
                  <li key={test.id}>
                    <Link
                      className="flex min-h-11 items-center justify-between gap-2 rounded-md px-2 py-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                      to="/tests/$testId"
                      params={{ testId: test.id }}
                    >
                      <span className="min-w-0 break-words leading-5">{test.name}</span>
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
                      className="flex min-h-11 items-center rounded-md px-2 py-2 text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
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
