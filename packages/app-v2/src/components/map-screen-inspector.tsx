import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { ArrowDownLeft, ArrowUpRight, ChevronRight, Scan, X } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { MapScreenPreview } from "./map-screen-preview";

export function ScreenInspector({
  loadScreenshot,
  screen,
  paths,
  onSelectScreen,
  onFocusScreen,
  onRename,
  saving,
  onClose,
}: {
  paths: readonly ProductMapPath[];
  onSelectScreen(id: string): void;
  onFocusScreen(): void;
  onRename?: (title: string) => Promise<void>;
  saving: boolean;
  loadScreenshot?: (uri: string) => Promise<Blob>;
  screen: ProductMapScreen | undefined;
  onClose(): void;
}) {
  const [captureSelection, setCaptureSelection] = useState<{
    screenId: string;
    variantId: string;
  }>();
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
      className="z-10 flex w-72 shrink-0 flex-col border-l border-border bg-card max-[1000px]:absolute max-[1000px]:right-0 max-[1000px]:inset-y-0 max-[1000px]:shadow-lg"
      aria-label="Screen details"
    >
      <header className="flex h-12 shrink-0 items-center justify-between px-4">
        <h2 className="text-xs font-medium">Screen details</h2>
        <Button size="icon-sm" variant="ghost" aria-label="Close screen details" onClick={onClose}>
          <X />
        </Button>
      </header>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 pb-5">
        <div className="space-y-2">
          {onRename ? (
            <input
              key={`${screen.id}:${screen.title}`}
              aria-label="Screen name"
              defaultValue={screen.title}
              disabled={saving}
              className="w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm font-medium outline-none hover:border-input focus:border-input focus:ring-2 focus:ring-ring"
              onKeyDown={(event) => {
                if (event.key === "Enter") event.currentTarget.blur();
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
            className="block h-[min(42vh,360px)] w-full focus-visible:outline-2 focus-visible:outline-ring"
            aria-label={`Focus ${screen.title} on canvas`}
            onClick={onFocusScreen}
          >
            <MapScreenPreview
              uri={selectedCapture?.screenshotUri ?? screen.screenshotUri}
              load={loadScreenshot}
              title={screen.title}
            />
          </button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-muted-foreground"
            onClick={onFocusScreen}
          >
            <Scan />
            Focus on canvas
          </Button>
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
                    {variant.locale ? `${variant.locale} · ` : ""}
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
        <section className="space-y-2" aria-label="Connected screens">
          <Connections
            title="Arrive from"
            paths={incoming}
            outgoing={false}
            onSelect={onSelectScreen}
          />
          <Connections title="Continue to" paths={outgoing} outgoing onSelect={onSelectScreen} />
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
    <div className="space-y-1 pb-3">
      <h3 className="flex items-center gap-2 text-xs font-medium">
        <Icon className="size-3.5 text-muted-foreground" />
        {title}
      </h3>
      {paths.map((path) => {
        const id = outgoing ? path.toScreenId : path.fromScreenId;
        const name = outgoing ? (path.toTitle ?? "Finish") : path.fromTitle;
        const content = (
          <>
            <span className="block truncate font-medium">{name}</span>
            <span className="mt-1 block truncate text-muted-foreground">{path.label}</span>
          </>
        );
        return id ? (
          <button
            key={path.id}
            type="button"
            className="w-full rounded-md px-2 py-2 text-left text-xs hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
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
