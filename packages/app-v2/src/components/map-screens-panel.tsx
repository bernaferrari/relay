import { useState } from "react";
import type { ProductMapScreen } from "@relay/product/map-exploration";
import { Input } from "@relay/ui-react/components/input";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { MapScreenPreview } from "./map-screen-preview";
import { EmptyState } from "./product-patterns";

export function MapScreensPanel({
  screens,
  loadScreenshot,
}: {
  screens: readonly ProductMapScreen[];
  loadScreenshot?: (uri: string) => Promise<Blob>;
}) {
  const [search, setSearch] = useState("");
  const matches = screens.filter((screen) =>
    screen.title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()),
  );
  return (
    <section className="min-h-0 flex-1 overflow-auto bg-card" aria-label="Captured screens">
      <div className="mx-auto max-w-7xl px-6 py-8 sm:px-8">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-baseline gap-3">
            <h2 className="text-xl font-semibold tracking-tight">Captured screens</h2>
            <span className="text-xs tabular-nums text-muted-foreground" role="status">
              {search ? `${matches.length} of ${screens.length}` : screens.length}
            </span>
          </div>
          <Input
            type="search"
            className="w-full sm:w-72"
            aria-label="Search captured screens"
            placeholder="Find a screen…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </header>
        {matches.length ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-8 md:grid-cols-3 xl:grid-cols-4">
            {matches.map((screen) => (
              <article key={screen.id} className="min-w-0">
                <Dialog>
                  <DialogTrigger
                    className="group block w-full rounded-lg bg-muted/30 p-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring motion-reduce:transition-none"
                    aria-label={`Preview ${screen.title}`}
                  >
                    <div className="h-56 sm:h-72">
                      <MapScreenPreview
                        uri={screen.screenshotUri}
                        load={loadScreenshot}
                        title={screen.title}
                        thumbnail
                      />
                    </div>
                    <div className="mt-4 space-y-1 px-1 pb-1">
                      <h3 className="truncate text-sm font-medium" title={screen.title}>
                        {screen.title}
                      </h3>
                      <p className="text-xs text-muted-foreground">
                        {screen.coveringTests.length}{" "}
                        {screen.coveringTests.length === 1 ? "test" : "tests"}
                        {screen.variantCount > 1 ? ` · ${screen.variantCount} captures` : ""}
                      </p>
                    </div>
                  </DialogTrigger>
                  <DialogContent className="sm:max-w-2xl">
                    <DialogTitle className="pr-8">{screen.title}</DialogTitle>
                    <DialogDescription>Captured screen</DialogDescription>
                    <div className="h-[min(70dvh,760px)] min-h-0">
                      <MapScreenPreview
                        uri={screen.screenshotUri}
                        load={loadScreenshot}
                        title={screen.title}
                      />
                    </div>
                  </DialogContent>
                </Dialog>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState
            title={screens.length ? "No matching screens" : "No captured screens yet"}
            detail={
              screens.length
                ? "Try another screen name."
                : "Record a test to capture your app’s screens."
            }
          />
        )}
      </div>
    </section>
  );
}
