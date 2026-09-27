import { useState } from "react";
import type { ProductMapScreen } from "@relay/product/map-exploration";
import { Input } from "@relay/ui-react/components/input";
import { Dialog, DialogTrigger } from "@relay/ui-react/components/dialog";
import { MapPreviewDialogContent } from "./map-preview-dialog-content";
import { MapScreenPreview } from "./map-screen-preview";
import { EmptyState } from "./product-patterns";

export function MapScreensPanel({
  screens,
  loadScreenshot,
  onOpenScreen,
}: {
  screens: readonly ProductMapScreen[];
  onOpenScreen(id: string): void;
  loadScreenshot?: (uri: string) => Promise<Blob>;
}) {
  const [search, setSearch] = useState("");
  const matches = screens.filter((screen) =>
    screen.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <section className="min-h-0 flex-1 overflow-auto bg-card" aria-label="Map screens">
      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Screens</h2>
            <span className="text-xs tabular-nums text-muted-foreground" role="status">
              {search ? `${matches.length} of ${screens.length}` : screens.length}
            </span>
          </div>
          <Input
            type="search"
            className="w-full sm:w-72"
            aria-label="Search screens"
            placeholder="Find a screen…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </header>
        {matches.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,220px),1fr))] gap-6">
            {matches.map((screen) => (
              <article key={screen.id} className="min-w-0">
                <Dialog>
                  <DialogTrigger
                    className="group/map-screen block w-full rounded-xl bg-[color-mix(in_oklch,var(--card)_96%,var(--foreground)_4%)] p-4 text-center transition-[background-color,box-shadow] duration-150 ease-out hover:bg-[color-mix(in_oklch,var(--card)_93%,var(--foreground)_7%)] focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
                    aria-label={`Preview ${screen.title}`}
                  >
                    <div className="h-80">
                      <MapScreenPreview
                        uri={screen.screenshotUri}
                        load={loadScreenshot}
                        title={screen.title}
                        interactive
                        thumbnail
                      />
                    </div>
                    <div className="mt-4 space-y-1 px-1 pb-1 text-center">
                      <h3 className="truncate text-sm font-medium" title={screen.title}>
                        {screen.title}
                      </h3>
                    </div>
                  </DialogTrigger>
                  <MapPreviewDialogContent
                    title={screen.title}
                    uri={screen.screenshotUri}
                    load={loadScreenshot}
                    onOpenMap={() => onOpenScreen(screen.id)}
                  />
                </Dialog>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={screens.length ? "No matching screens" : "No screens yet"}
            detail={
              screens.length
                ? "Try another screen name."
                : "Record a Test to add screens to this Map."
            }
          />
        )}
      </div>
    </section>
  );
}
