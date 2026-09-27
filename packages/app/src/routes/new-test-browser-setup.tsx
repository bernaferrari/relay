import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { ChevronRight, Globe } from "lucide-react";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";
export function BrowserSetup({
  browsers,
  browserUrl,
  newBrowserOpen,
  pending,
  checking,
  error,
  onBrowserUrlChange,
  onToggleNewBrowser,
  onStart,
  onCheckAgain,
}: {
  browsers: readonly { id: string; name: string; startUrl: string }[];
  browserUrl: string;
  newBrowserOpen: boolean;
  pending: boolean;
  checking: boolean;
  error: unknown;
  onBrowserUrlChange(value: string): void;
  onToggleNewBrowser(): void;
  onStart(spaceId?: string): void;
  onCheckAgain(): void;
}) {
  return (
    <div className="grid flex-1 place-items-center px-4 py-8">
      <div className="grid w-full max-w-md gap-5">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold tracking-tight">
            {browsers.length ? "Choose a browser" : "Start a browser to record"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {browsers.length
              ? "Open one of your browsers, or start a new one."
              : "Enter a website. The live view will open here."}
          </p>
        </div>
        {browsers.length ? (
          <ul className="overflow-hidden rounded-xl border border-border bg-background">
            {browsers.map((space) => (
              <li key={space.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                  disabled={pending}
                  onClick={() => onStart(space.id)}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Globe className="size-4" aria-hidden="true" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {space.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {websiteHost(space.startUrl)}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {browsers.length && !newBrowserOpen ? (
          <button
            type="button"
            className="justify-self-start text-sm font-medium text-foreground underline-offset-4 hover:underline"
            onClick={onToggleNewBrowser}
          >
            New website
          </button>
        ) : (
          <div className="grid gap-2">
            {browsers.length ? (
              <Label htmlFor="record-browser-url">New website</Label>
            ) : (
              <Label htmlFor="record-browser-url">Website</Label>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="record-browser-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                placeholder="https://app.example.com"
                value={browserUrl}
                onChange={(event) => onBrowserUrlChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (!pending && normalizeWebsite(browserUrl)) onStart();
                }}
              />
              <Button
                type="button"
                className="sm:w-auto"
                disabled={!normalizeWebsite(browserUrl) || pending}
                onClick={() => onStart()}
              >
                {pending ? "Starting…" : "Start a browser"}
              </Button>
            </div>
          </div>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {friendlyBrowserError(error)}
          </p>
        ) : null}
        <button
          type="button"
          className="justify-self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          disabled={checking}
          onClick={onCheckAgain}
        >
          {checking ? "Checking for devices…" : "Refresh devices"}
        </button>
      </div>
    </div>
  );
}

export async function startManagedBrowser(
  service: BrowserSpacesProductService,
  spaceId: string | undefined,
  browserUrl: string,
): Promise<string> {
  const open =
    typeof service.openSpace === "function" ? service.openSpace.bind(service) : undefined;
  const create =
    typeof service.createSpace === "function" ? service.createSpace.bind(service) : undefined;
  if (spaceId) {
    if (open) return (await open(spaceId)).targetId;
    return spaceId;
  }
  if (!create) throw new TypeError("Relay could not start a browser in this host.");
  const startUrl = normalizeWebsite(browserUrl);
  const created = await create({
    name: websiteName(startUrl),
    startUrl,
    profileRetention: "ephemeral",
  });
  if (open) return (await open(created.id)).targetId;
  return created.id;
}

function friendlyBrowserError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/is not a function|cannot read|undefined/iu.test(message)) {
    return "Relay could not open that browser. Try again, or start a new one.";
  }
  if (message.trim()) return message;
  return "Relay could not start a browser.";
}

export function websiteHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return url.toString();
  } catch {
    return "";
  }
}

export function websiteName(url: string): string {
  try {
    return new URL(url).hostname || "Browser";
  } catch {
    return "Browser";
  }
}
