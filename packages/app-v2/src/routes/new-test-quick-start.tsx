/** @jsxImportSource react */
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { ArrowRight, Globe, LoaderCircle, Smartphone } from "lucide-react";
import type { ProductBrowserSpace } from "../data/browser-spaces-product-service";

/** "grok.com", "https://staging.example.com/login" → a full https URL, or "" when unusable. */
export function websiteAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname.includes("."))
      return url.hostname === "localhost" ? url.toString() : "";
    return url.toString();
  } catch {
    return "";
  }
}

export function websiteHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value;
  }
}

/** Websites people tested before, newest first, one per host. */
export function recentWebsites(spaces: readonly ProductBrowserSpace[], limit = 6): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const space of [...spaces].sort((left, right) => right.updatedAt - left.updatedAt)) {
    const host = websiteHost(space.startUrl);
    if (!host || seen.has(host) || /^(127\.0\.0\.1|localhost)(:|$)/.test(host)) continue;
    seen.add(host);
    result.push(space.startUrl);
    if (result.length >= limit) break;
  }
  return result;
}

/**
 * The first thing a new Test asks: what to test. A website address is enough;
 * Relay opens a browser there, files the Test under that site, and starts
 * recording. Devices stay one click away.
 */
export function NewTestQuickStart({
  recent,
  progress,
  error,
  onStart,
  onUseDevice,
  manualAction,
}: {
  recent: readonly string[];
  /** What Relay is doing right now ("Opening grok.com…"), while starting. */
  progress?: string;
  error?: string;
  onStart(url: string): void;
  onUseDevice(): void;
  manualAction?: ReactNode;
}) {
  const [value, setValue] = useState("");
  const address = websiteAddress(value);
  const busy = Boolean(progress);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (address && !busy) onStart(address);
  }
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12">
      <div className="grid w-full max-w-xl gap-8">
        <div className="grid gap-2 text-center">
          <h1 className="text-3xl leading-9 font-semibold tracking-tight">
            What do you want to test?
          </h1>
          <p className="text-muted-foreground">
            Enter a website. Relay opens it, and every click and keystroke becomes a step.
          </p>
        </div>
        <form className="grid gap-3" onSubmit={submit} aria-label="Start a test">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Globe
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                aria-label="Website address"
                className="h-11 pl-9 text-base"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="url"
                autoFocus
                placeholder="grok.com or https://staging.example.com"
                value={value}
                disabled={busy}
                onChange={(event) => setValue(event.currentTarget.value)}
              />
            </div>
            <Button type="submit" size="lg" className="h-11" disabled={!address || busy}>
              {busy ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : (
                <ArrowRight aria-hidden="true" />
              )}
              {busy ? "Starting" : "Start"}
            </Button>
          </div>
          <p className="min-h-5 text-sm text-muted-foreground" role="status">
            {progress ?? (value && !address ? "Enter a website address, like grok.com." : "")}
          </p>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
        </form>
        {recent.length ? (
          <div className="grid gap-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Recent
            </p>
            <div className="flex flex-wrap gap-2">
              {recent.map((url) => (
                <Button
                  key={url}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => onStart(url)}
                >
                  <Globe aria-hidden="true" /> {websiteHost(url)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-4 text-center">
          {manualAction}
          <Button type="button" variant="ghost" size="sm" onClick={onUseDevice} disabled={busy}>
            <Smartphone aria-hidden="true" /> Test a phone or tablet instead
          </Button>
        </div>
      </div>
    </div>
  );
}
