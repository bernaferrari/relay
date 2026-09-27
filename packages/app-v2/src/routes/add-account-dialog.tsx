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
import { useState, type FormEvent } from "react";
import { SiteIcon, siteHost } from "../components/site-icon";
import type { ProductBrowserTarget } from "../data/app-resources-product-service";
import { websiteAddress } from "./new-test-quick-start";

const ANOTHER_WEBSITE = "";

/**
 * Add account: choose the website, sign in once in a real browser window,
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
  const { appResourcesService, browserSpacesService } = useRouteContext({ from: "__root__" });
  const [step, setStep] = useState<"website" | "sign-in">("website");
  const [chosen, setChosen] = useState<string>(websites[0]?.id ?? ANOTHER_WEBSITE);
  const [address, setAddress] = useState("");
  const [targetId, setTargetId] = useState<string>();
  const [name, setName] = useState("");
  const typed = websiteAddress(address);
  const chosenWebsite = websites.find((website) => website.id === chosen);
  const host =
    siteHost(chosenWebsite?.startUrl ?? (typed || undefined)) ?? chosenWebsite?.name ?? "";

  const openBrowser = useMutation({
    mutationFn: async () => {
      let id = chosenWebsite?.id;
      if (!id) {
        if (!typed) throw new Error("Enter a website address, like app.example.com.");
        // A login must outlive the window, so this browser keeps its profile.
        const created = await browserSpacesService.createSpace({
          name: siteHost(typed) ?? typed,
          startUrl: typed,
          profileRetention: "retain",
        });
        id = created.id;
      }
      if (appResourcesService.openBrowserAccountForSignIn) {
        await appResourcesService.openBrowserAccountForSignIn({ targetId: id });
      } else {
        await browserSpacesService.openSpace({ spaceId: id, presentation: "external" });
      }
      return id;
    },
    onSuccess: (id) => {
      setTargetId(id);
      setStep("sign-in");
    },
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!appResourcesService.saveBrowserAccount) {
        throw new Error("Saving accounts is unavailable in this Relay connection.");
      }
      if (!targetId) throw new Error("Open the website and sign in first.");
      return appResourcesService.saveBrowserAccount({ targetId, name: name.trim() });
    },
    onSuccess: () => onSaved(),
  });
  const pending = openBrowser.isPending || save.isPending;

  function submitWebsite(event: FormEvent) {
    event.preventDefault();
    if (!chosenWebsite && !typed) return;
    openBrowser.mutate();
  }
  function submitName(event: FormEvent) {
    event.preventDefault();
    if (name.trim()) save.mutate();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent showCloseButton={false} className="overflow-auto">
        {step === "website" ? (
          <form onSubmit={submitWebsite} className="grid gap-4" aria-label="Choose website">
            <DialogTitle>Add account</DialogTitle>
            <DialogDescription>
              Choose the website. Relay opens it in a browser window so you can sign in.
            </DialogDescription>
            <div className="grid gap-2" role="radiogroup" aria-label="Website">
              {websites.map((website) => (
                <WebsiteChoice
                  key={website.id}
                  url={website.startUrl}
                  title={siteHost(website.startUrl) ?? website.name}
                  detail={siteHost(website.startUrl) ? website.name : undefined}
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
          <form onSubmit={submitName} className="grid gap-4" aria-label="Save account">
            <DialogTitle>Sign in to {host}</DialogTitle>
            <DialogDescription>
              Sign in in the browser window that just opened. When you see your account, name it and
              save. Passwords and cookies stay on Relay.
            </DialogDescription>
            <Field>
              <FieldLabel htmlFor="account-name">Account name</FieldLabel>
              <Input
                id="account-name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
                placeholder="For example, Staging admin"
                autoComplete="off"
                autoFocus
              />
            </Field>
            {save.error ? (
              <FieldError>
                {save.error instanceof Error
                  ? save.error.message
                  : "Relay could not save this account."}
              </FieldError>
            ) : null}
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => openBrowser.mutate()}
              >
                {openBrowser.isPending ? "Opening…" : "Open window again"}
              </Button>
              <Button type="submit" disabled={pending || !name.trim()}>
                {save.isPending ? "Saving…" : "Save account"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
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
