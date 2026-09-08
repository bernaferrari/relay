import type { ProductMapPath, ProductMapScreen } from "@relay/product/map-exploration";
import { Button } from "@relay/ui-react/components/button";
import { X, LocateFixed } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { MapScreenPreview } from "./map-screen-preview";
export function ScreenInspector({
  appId,
  loadScreenshot,
  screen,
  paths,
  onSelectScreen,
  onRename,
  saving,
  onClose,
}: {
  paths: readonly ProductMapPath[];
  onSelectScreen(id: string): void;
  onRename?: (title: string) => Promise<void>;
  saving: boolean;
  appId: string;
  loadScreenshot?: (uri: string) => Promise<Blob>;
  screen: ProductMapScreen | undefined;
  onClose: () => void;
}) {
  if (!screen) return null;
  return (
    <aside
      className="z-10 w-72 shrink-0 overflow-y-auto border-l border-border bg-card p-4 max-[1000px]:absolute max-[1000px]:right-0 max-[1000px]:inset-y-0 max-[1000px]:shadow-lg"
      aria-label="Screen details"
      aria-live="polite"
    >
      {screen ? (
        <>
          <header className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Screen
              </p>
              {onRename ? (
                <input
                  key={`${screen.id}:${screen.title}`}
                  aria-label="Screen name"
                  defaultValue={screen.title}
                  disabled={saving}
                  className="w-full rounded px-1 py-1 text-sm font-medium outline-none hover:bg-muted focus:ring-2 focus:ring-ring"
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
                <h2 className="text-base font-semibold">{screen.title}</h2>
              )}
            </div>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label="Close screen details"
              onClick={onClose}
            >
              <X aria-hidden="true" />
            </Button>
          </header>
          <div className="h-72">
            <MapScreenPreview
              uri={screen.screenshotUri}
              load={loadScreenshot}
              title={screen.title}
            />
          </div>
          {screen.description ? (
            <p className="grid gap-3 text-sm text-muted-foreground">{screen.description}</p>
          ) : null}
          <dl className="my-4 grid grid-cols-2 gap-3 rounded-lg bg-muted p-3 text-xs [&_dt]:text-muted-foreground [&_dd]:mt-1 [&_dd]:text-base [&_dd]:font-medium">
            <div>
              <dt>Saved variants</dt>
              <dd>{screen.variantCount}</dd>
            </div>
            <div>
              <dt>Tests</dt>
              <dd>{screen.coveringTests.length}</dd>
            </div>
          </dl>
          <section className="mb-4 grid gap-2 text-sm [&_h3]:font-medium [&_a]:text-primary [&_a]:underline [&_p]:text-muted-foreground">
            <h3>Tests</h3>
            {screen.coveringTests.length ? (
              <ul>
                {screen.coveringTests.map((test) => (
                  <li key={test.id}>
                    <Link to="/tests/$testId" params={{ testId: test.id }}>
                      {test.name}
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No saved Test covers this screen yet.</p>
            )}
          </section>
          <section className="mb-4 grid gap-2 text-xs" aria-label="Connected screens">
            <h3 className="font-medium">Connections</h3>
            {paths
              .filter((path) => path.fromScreenId === screen.id || path.toScreenId === screen.id)
              .map((path) => {
                const outgoing = path.fromScreenId === screen.id;
                const id = outgoing ? path.toScreenId : path.fromScreenId;
                return id ? (
                  <button
                    key={path.id}
                    type="button"
                    className="rounded-md p-2 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring"
                    onClick={() => onSelectScreen(id)}
                  >
                    <span className="block truncate">
                      {outgoing ? "→" : "←"} {outgoing ? path.toTitle : path.fromTitle}
                    </span>
                    <span className="mt-1 block truncate text-muted-foreground">{path.label}</span>
                  </button>
                ) : null;
              })}
          </section>
          {screen.recentFailures.length ? (
            <section className="mb-4 grid gap-2 text-sm [&_h3]:font-medium [&_a]:text-primary [&_a]:underline [&_p]:text-muted-foreground">
              <h3>Recent failures</h3>
              <ul>
                {screen.recentFailures.map((failure) => (
                  <li key={failure.id}>
                    <Link to="/runs/$runId" params={{ runId: failure.runId }}>
                      {failure.outcome.replaceAll("-", " ")}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <Button
            className="w-full"
            size="sm"
            nativeButton={false}
            render={<Link to="/tests/new" search={{ app: appId }} />}
          >
            Record test
          </Button>
        </>
      ) : (
        <div className="grid gap-3">
          <span aria-hidden="true">
            <LocateFixed />
          </span>
          <h2>Select a screen</h2>
          <p>Choose any screen on the map to inspect its coverage and recent failures.</p>
        </div>
      )}
    </aside>
  );
}
