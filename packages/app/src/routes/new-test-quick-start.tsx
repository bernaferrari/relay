/** @jsxImportSource react */
import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { Textarea } from "@relay/ui-react/components/textarea";
import { ArrowRight, Globe, LoaderCircle, Smartphone, Sparkles } from "lucide-react";
import type { ProductBrowserSpace } from "../data/browser-spaces-product-service";
import { SelectField } from "../components/filter-select";

/** Bare public hosts use HTTPS; loopback development sites use HTTP. */
export function websiteAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const explicitProtocol = trimmed.includes("://");
    const url = new URL(explicitProtocol ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    const loopback =
      url.hostname === "localhost" ||
      url.hostname === "[::1]" ||
      /^127(?:\.\d{1,3}){3}$/u.test(url.hostname);
    if (!url.hostname.includes(".") && !loopback) return "";
    if (!explicitProtocol && loopback) url.protocol = "http:";
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

/** A saved login people can record and run as. */
export type WebsiteAccount = { reference: string; name: string; targetId: string };

/**
 * The first thing a new Test asks: what should work. A sentence plus a website
 * is enough; Relay drafts plain-English steps that run without recording.
 * Leaving the description empty records the website instead. Devices stay one
 * click away.
 */
export function NewTestQuickStart({
  onDescribe,
  recent,
  progress,
  error,
  onStart,
  onUseDevice,
  manualAction,
  accountsFor,
  rememberedAccount,
  initialAddress,
  address: controlledAddress,
  initialAccount,
  setupStatus = "ready",
  onRetrySetup,
  onAddressChange,
}: {
  /** Prefilled website, e.g. from "New test as this account". */
  initialAddress?: string;
  address?: string;
  /** Preselected saved login for the prefilled website. */
  initialAccount?: string;
  setupStatus?: "loading" | "unavailable" | "ready";
  onRetrySetup?(): void;
  onAddressChange?(value: string): void;
  recent: readonly string[];
  /** Saved logins that work on this website address. */
  accountsFor?(url: string): readonly WebsiteAccount[];
  /** The login last used for this website, if any. */
  rememberedAccount?(url: string): string | undefined;
  /** What Relay is doing right now ("Opening shop.example.com…"), while starting. */
  progress?: string;
  error?: string;
  onStart(url: string, account?: WebsiteAccount): void;
  /** Draft plain-English steps from a description instead of recording. */
  onDescribe?(goal: string, url: string, account?: WebsiteAccount): void;
  onUseDevice?(): void;
  manualAction?: ReactNode;
}) {
  const [goal, setGoal] = useState("");
  const describing = Boolean(onDescribe && goal.trim());
  const [localValue, setValue] = useState(initialAddress ?? "");
  const value = controlledAddress ?? localValue;
  function changeAddress(value: string) {
    setValue(value);
    onAddressChange?.(value);
  }
  const address = websiteAddress(value);
  const busy = Boolean(progress);
  const accounts = address ? (accountsFor?.(address) ?? []) : [];
  // undefined: not chosen yet (use the remembered one); "": explicitly Guest.
  const [chosen, setChosen] = useState<string>();
  const selectedReference =
    chosen ?? initialAccount ?? (address ? rememberedAccount?.(address) : undefined) ?? "";
  const account = accounts.find((item) => item.reference === selectedReference);
  const missingAccount = Boolean(selectedReference && !account);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!address || busy || setupStatus !== "ready" || missingAccount) return;
    if (describing) onDescribe!(goal.trim(), address, account);
    else onStart(address, account);
  }
  return (
    <div className="grid min-h-0 flex-1 place-items-center overflow-y-auto px-6 py-12">
      <div className="grid w-full max-w-lg gap-6">
        <div className="grid gap-2">
          <h2 className="text-2xl font-semibold tracking-tight">
            {onDescribe ? "What should work?" : "Record a website"}
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {onDescribe
              ? "Describe it in a sentence, or write one step per line. Relay writes the steps and runs them in a real browser."
              : "Open your website here. Your clicks and typing become test steps."}
          </p>
        </div>
        <form className="grid gap-3" onSubmit={submit} aria-label="Start a test">
          {onDescribe ? (
            <>
              <Label htmlFor="new-test-goal">What should work</Label>
              <Textarea
                id="new-test-goal"
                className="min-h-24 text-base"
                autoFocus
                rows={3}
                value={goal}
                disabled={busy}
                placeholder="Creating an API key shows it in the list"
                onChange={(event) => setGoal(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
            </>
          ) : null}
          <Label htmlFor="new-test-website">Website address</Label>
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1">
              <Globe
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                id="new-test-website"
                aria-label="Website address"
                className="h-11 pl-9 text-base"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="url"
                autoFocus={!onDescribe}
                placeholder="example.com"
                value={value}
                disabled={busy}
                onChange={(event) => changeAddress(event.currentTarget.value)}
              />
            </div>
            <Button
              type="submit"
              size="lg"
              className="h-11"
              disabled={!address || busy || setupStatus !== "ready" || missingAccount}
            >
              {busy ? (
                <LoaderCircle
                  className="animate-spin motion-reduce:animate-none"
                  aria-hidden="true"
                />
              ) : describing ? (
                <Sparkles aria-hidden="true" />
              ) : (
                <ArrowRight aria-hidden="true" />
              )}
              {busy ? "Starting…" : describing ? "Create test" : "Start recording"}
            </Button>
          </div>
          {setupStatus === "unavailable" ? (
            <div
              role="alert"
              className="flex flex-wrap items-center gap-2 text-sm text-destructive"
            >
              Saved accounts or browsers could not be loaded. Your login choice has not been
              changed.
              {onRetrySetup ? (
                <Button type="button" variant="outline" size="sm" onClick={onRetrySetup}>
                  Retry setup lookup
                </Button>
              ) : null}
            </div>
          ) : setupStatus === "loading" ? (
            <p role="status" className="text-sm text-muted-foreground">
              Checking saved accounts and browsers…
            </p>
          ) : null}
          {setupStatus === "ready" && missingAccount ? (
            <p role="alert" className="text-sm text-destructive">
              The selected account is unavailable. Choose another account or Guest explicitly.
            </p>
          ) : null}
          {setupStatus === "ready" && (accounts.length || missingAccount) ? (
            <SelectField
              label="Account"
              id="new-test-account"
              value={selectedReference || "guest"}
              options={[
                { value: "guest", label: "Guest · not signed in" },
                ...accounts.map((item) => ({ value: item.reference, label: item.name })),
              ]}
              onValueChange={(value) => setChosen(value === "guest" ? "" : value)}
              placeholder="Choose an account"
              disabled={busy}
            />
          ) : null}
          <p className="min-h-5 text-sm text-muted-foreground" role="status">
            {progress ??
              (value && !address ? "Enter a website address, like shop.example.com." : "")}
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
              Recent websites
            </p>
            <div className="flex flex-wrap gap-2">
              {recent.map((url) => (
                <Button
                  key={url}
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => changeAddress(url)}
                >
                  <Globe aria-hidden="true" /> {websiteHost(url)}
                </Button>
              ))}
            </div>
          </div>
        ) : null}
        {manualAction || onUseDevice ? (
          <div className="flex flex-wrap justify-center gap-2 border-t border-border pt-4 text-center">
            {manualAction}
            {onUseDevice ? (
              <Button type="button" variant="ghost" size="sm" onClick={onUseDevice} disabled={busy}>
                <Smartphone aria-hidden="true" /> Test a phone or tablet instead
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
