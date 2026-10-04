/** @jsxImportSource react */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Check, Globe } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { SiteIcon, siteHost } from "../components/site-icon";
import type { ProductBrowserTarget } from "../data/app-resources-product-service";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";
import { websiteAddress } from "./new-test-quick-start";
import { AccountSignInPreview, type AccountSignInSession } from "./account-sign-in-preview";

const ANOTHER_WEBSITE = "";

/**
 * Add account: choose the website, sign in inside Relay,
 * then save that login under a name tests can run as.
 */
export function AddAccountDialog({
  websites,
  onClose,
  onSaved,
}: {
  websites: readonly ProductBrowserTarget[];
  onClose(): void;
  onSaved(): void | Promise<void>;
}) {
  const { appResourcesService, browserSpacesService, productService, platform } = useRouteContext({
    from: "__root__",
  });
  const choices = useMemo(() => accountWebsites(websites), [websites]);
  const [step, setStep] = useState<"website" | "sign-in">("website");
  const [chosen, setChosen] = useState<string>(choices[0]?.id ?? ANOTHER_WEBSITE);
  const [address, setAddress] = useState("");
  const [opened, setOpened] = useState<AccountSignInSession>();
  const [previewReady, setPreviewReady] = useState(false);
  const [needsReopen, setNeedsReopen] = useState(false);
  const [name, setName] = useState("");
  const typed = websiteAddress(address);
  const chosenWebsite = choices.find((website) => website.id === chosen);
  const host =
    siteHost(chosenWebsite?.startUrl ?? (typed || undefined)) ?? chosenWebsite?.name ?? "";

  const openBrowser = useMutation({
    mutationFn: async () => {
      const startUrl = chosenWebsite?.startUrl ?? typed;
      if (!startUrl) throw new Error("Enter a website address, like app.example.com.");
      if (!productService.previewTarget)
        throw new Error("Inline sign-in is unavailable in this Relay connection.");
      // Each account starts in a new retained profile, isolated from existing logins.
      const created = await browserSpacesService.createSpace({
        name: siteHost(startUrl) ?? startUrl,
        startUrl,
        profileRetention: "retain",
      });
      const session = await browserSpacesService.openSpace({
        spaceId: created.id,
        presentation: "embedded",
      });
      return exactSignInSession(session, created.id);
    },
    onSuccess: (session) => {
      setOpened(session);
      setStep("sign-in");
    },
  });
  const openWindow = useMutation({
    onMutate: () => {
      setNeedsReopen(true);
      setPreviewReady(false);
    },
    mutationFn: async () => {
      if (!opened) throw new Error("Open the website first.");
      const next = exactSignInSession(
        await browserSpacesService.openSpace({
          spaceId: opened.targetId,
          presentation: "external",
        }),
        opened.targetId,
      );
      if (opened.configurationDigest && next.configurationDigest !== opened.configurationDigest) {
        throw new Error("The browser identity changed. Reopen the sign-in browser before saving.");
      }
      return next;
    },
    onSuccess: (session) => {
      setOpened(session);
      setNeedsReopen(false);
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!appResourcesService.saveBrowserAccount) {
        throw new Error("Saving accounts is unavailable in this Relay connection.");
      }
      if (!opened || !previewReady || needsReopen)
        throw new Error("Finish signing in before saving this account.");
      return appResourcesService.saveBrowserAccount({
        targetId: opened.targetId,
        name: name.trim(),
      });
    },
    onSuccess: () => onSaved(),
  });
  const pending = openBrowser.isPending || openWindow.isPending || save.isPending;

  function submitWebsite(event: FormEvent) {
    event.preventDefault();
    if (!chosenWebsite && !typed) return;
    openBrowser.mutate();
  }
  function submitName(event: FormEvent) {
    event.preventDefault();
    if (name.trim() && previewReady && !needsReopen && !pending) save.mutate();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent
        showCloseButton={false}
        className={
          step === "sign-in"
            ? "flex h-[90dvh] w-[min(90vw,1200px)] max-w-[calc(100%-2rem)] flex-col gap-3 overflow-hidden sm:max-w-none"
            : "max-h-[85dvh] overflow-auto"
        }
      >
        {step === "website" ? (
          <form onSubmit={submitWebsite} className="grid gap-4" aria-label="Choose website">
            <DialogTitle>Add account</DialogTitle>
            <DialogDescription>Choose a website to sign in to.</DialogDescription>
            <div className="grid gap-2" role="radiogroup" aria-label="Website">
              {choices.map((website) => (
                <WebsiteChoice
                  key={website.id}
                  url={website.startUrl}
                  title={siteHost(website.startUrl) ?? website.name}
                  detail={website.startUrl}
                  selected={chosen === website.id}
                  disabled={pending}
                  onSelect={() => setChosen(website.id)}
                />
              ))}
              <WebsiteChoice
                title="Another website"
                selected={chosen === ANOTHER_WEBSITE}
                disabled={pending}
                onSelect={() => setChosen(ANOTHER_WEBSITE)}
              />
            </div>
            {chosen === ANOTHER_WEBSITE ? (
              <Field>
                <FieldLabel htmlFor="account-website">Website address</FieldLabel>
                <Input
                  id="account-website"
                  value={address}
                  onChange={(event) => setAddress(event.currentTarget.value)}
                  placeholder="app.example.com"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  autoComplete="url"
                  autoFocus
                />
              </Field>
            ) : null}
            {openBrowser.error ? (
              <FieldError>
                {openBrowser.error instanceof Error
                  ? openBrowser.error.message
                  : "Relay could not open that website."}
              </FieldError>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending || (!chosenWebsite && !typed)}>
                {openBrowser.isPending ? "Opening…" : "Open to sign in"}
              </Button>
            </div>
          </form>
        ) : (
          <>
            <div className="shrink-0">
              <DialogTitle>Sign in to {host}</DialogTitle>
              <DialogDescription>
                Sign in below, then save this account for your tests.
              </DialogDescription>
            </div>
            {opened ? (
              <AccountSignInPreview
                opened={opened}
                service={productService}
                storage={platform.storage}
                disabled={pending || needsReopen}
                onReady={setPreviewReady}
              />
            ) : null}
            {openWindow.error ? (
              <FieldError>
                {openWindow.error instanceof Error
                  ? openWindow.error.message
                  : "Relay could not open the browser window."}
              </FieldError>
            ) : null}
            <form
              onSubmit={submitName}
              className="flex shrink-0 flex-wrap items-end gap-3 border-t pt-3"
              aria-label="Save account"
            >
              <Field className="min-w-48 flex-1 sm:w-auto">
                <FieldLabel htmlFor="account-name">Account name</FieldLabel>
                <Input
                  id="account-name"
                  value={name}
                  onChange={(event) => setName(event.currentTarget.value)}
                  placeholder="For example, Staging admin"
                  autoComplete="off"
                />
              </Field>
              {save.error ? (
                <FieldError>
                  {save.error instanceof Error
                    ? save.error.message
                    : "Relay could not save this account."}
                </FieldError>
              ) : null}
              <div className="ml-auto flex items-center justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  disabled={pending || (!previewReady && !needsReopen)}
                  onClick={() => openWindow.mutate()}
                >
                  Open browser window
                </Button>
                <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={pending || needsReopen || !name.trim() || !previewReady}
                >
                  {save.isPending ? "Saving…" : "Save account"}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function exactSignInSession(
  session: Awaited<ReturnType<BrowserSpacesProductService["openSpace"]>>,
  targetId: string,
): AccountSignInSession {
  if (
    !session.sessionId ||
    session.targetId !== targetId ||
    session.authenticationFixtureId ||
    session.signedOut
  ) {
    throw new Error("Relay could not attach to the sign-in browser. Try opening it again.");
  }
  return { ...session, sessionId: session.sessionId };
}

/** A website is an origin, not every retained browser that has visited it. */
function accountWebsites(websites: readonly ProductBrowserTarget[]): ProductBrowserTarget[] {
  const origins = new Map<string, ProductBrowserTarget>();
  for (const website of websites) {
    if (!website.startUrl) continue;
    try {
      const url = new URL(website.startUrl);
      if (url.protocol !== "http:" && url.protocol !== "https:") continue;
      const existing = origins.get(url.origin);
      if (!existing || website.startUrl.length < existing.startUrl!.length)
        origins.set(url.origin, website);
    } catch {
      /* Invalid catalog addresses are not sign-in choices. */
    }
  }
  return [...origins.values()];
}

function WebsiteChoice({
  url,
  title,
  detail,
  selected,
  disabled,
  onSelect,
}: {
  url?: string;
  title: string;
  detail?: string;
  selected: boolean;
  disabled: boolean;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={`flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring ${
        selected ? "border-brand bg-brand-soft" : "border-border hover:bg-muted/50"
      }`}
    >
      {url ? (
        <SiteIcon url={url} className="size-5 shrink-0" />
      ) : (
        <Globe className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      )}
      <span className="grid min-w-0 flex-1">
        <span className="truncate text-sm font-medium">{title}</span>
        {detail ? <span className="truncate text-xs text-muted-foreground">{detail}</span> : null}
      </span>
      {selected ? <Check className="size-4 shrink-0 text-brand" aria-hidden="true" /> : null}
    </button>
  );
}
