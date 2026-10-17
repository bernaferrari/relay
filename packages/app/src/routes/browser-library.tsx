/** @jsxImportSource react */
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQueries } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import type {
  ProductBrowserAuthFixture,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";
import type { SetupContinuation } from "../data/setup-continuation";
import { websiteName } from "./new-test-browser-setup";
import { PersonAvatar, browserHost, browserLabel, tintFor } from "./browsers-side-by-side";

/** Saved sign-ins per browser, keyed by browser id. */
export function useBrowserAccounts(
  spaces: readonly ProductBrowserSpace[],
): Record<string, readonly ProductBrowserAuthFixture[]> {
  const { browserSpacesService } = useRouteContext({ from: "__root__" });
  const queries = useQueries({
    queries: spaces.map((space) => ({
      queryKey: ["browser-spaces", space.id, "accounts"],
      queryFn: () => browserSpacesService.listAuthenticationFixtures(space.id),
      staleTime: 10_000,
    })),
  });
  return Object.fromEntries(spaces.map((space, index) => [space.id, queries[index]?.data ?? []]));
}

/** One browser, one identity: the newest sign-in that is still valid. */
function signedInAs(accounts: readonly ProductBrowserAuthFixture[] | undefined) {
  return [...(accounts ?? [])]
    .filter((account) => !account.revokedAt)
    .sort((a, b) => b.createdAt - a.createdAt)[0]?.name;
}

export function BrowserCards({
  spaces,
  allSpaces,
  accountsByBrowser,
  returnTo,
  onNewBrowser,
  children,
}: {
  children?: ReactNode;
  spaces: readonly ProductBrowserSpace[];
  allSpaces: readonly ProductBrowserSpace[];
  accountsByBrowser: Record<string, readonly ProductBrowserAuthFixture[]>;
  returnTo?: string;
  onNewBrowser?: () => void;
}) {
  return (
    <ul
      className="m-0 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
      aria-label="Browsers"
    >
      {spaces.map((space) => {
        const name = signedInAs(accountsByBrowser[space.id]);
        const site = browserHost(space.startUrl);
        return (
          <li key={space.id}>
            <Link
              data-slot="device-row"
              className="group grid h-full gap-4 rounded-xl border border-border bg-card p-4 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              to="/environments/$profileId"
              params={{ profileId: space.id }}
              search={returnTo ? { returnTo } : undefined}
            >
              <span className="flex min-w-0 items-center gap-3">
                <span
                  aria-hidden="true"
                  className={`grid size-10 shrink-0 place-items-center rounded-lg text-sm font-semibold ${tintFor(site)}`}
                >
                  {site
                    .replace(/^www\./u, "")
                    .charAt(0)
                    .toUpperCase() || "?"}
                </span>
                <span className="grid min-w-0 flex-1">
                  <strong className="truncate text-sm font-medium">
                    {browserLabel(space, allSpaces)}
                  </strong>
                  <small className="truncate text-xs text-muted-foreground">
                    {site}
                    {space.environment?.locale ? ` · ${space.environment.locale}` : ""}
                  </small>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                  aria-hidden="true"
                />
              </span>
              <span className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
                <PersonAvatar name={name ?? "Signed out"} size="sm" />
                {name ? (
                  <span className="truncate">
                    Signed in as <span className="font-medium text-foreground">{name}</span>
                  </span>
                ) : (
                  "Signed out"
                )}
              </span>
            </Link>
          </li>
        );
      })}
      {children}
      {onNewBrowser ? (
        <li>
          <button
            type="button"
            onClick={onNewBrowser}
            className="flex h-full min-h-28 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
          >
            <Plus className="size-4" aria-hidden="true" /> New browser
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** Ask only for the website, then open the browser so people can sign in right away. */
export function NewBrowserDialog({
  open,
  onOpenChange,
  continuation,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  continuation?: SetupContinuation;
}) {
  const { browserSpacesService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const [startUrl, setStartUrl] = useState("");
  const create = useMutation({
    mutationFn: () => {
      const address = /^[a-z][a-z\d+.-]*:\/\//iu.test(startUrl.trim())
        ? startUrl.trim()
        : `https://${startUrl.trim()}`;
      return browserSpacesService.createSpace({
        name: websiteName(address),
        startUrl: address,
        profileRetention: "retain",
      });
    },
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      onOpenChange(false);
      if (continuation?.kind === "run-setup") {
        await navigate({
          to: "/tests/$testId",
          params: { testId: continuation.testId },
          search: { setup: "run" },
        });
      } else if (continuation) {
        await navigate({
          to: "/tests/new",
          search: {
            ...(continuation.kind === "record-test" && continuation.appId
              ? { app: continuation.appId }
              : {}),
            target: space.id,
          },
        });
      } else {
        // Straight into the browser: sign in there now, save the sign-in later.
        const session = await browserSpacesService.openSpace(space.id).catch(() => undefined);
        await (session
          ? navigate({ to: "/devices/$deviceId", params: { deviceId: session.targetId } })
          : navigate({ to: "/environments/$profileId", params: { profileId: space.id } }));
      }
    },
  });
  const { reset } = create;
  useEffect(() => {
    if (!open) return;
    setStartUrl("");
    reset();
  }, [open, reset]);

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false}>
        <DialogTitle>New browser</DialogTitle>
        <DialogDescription>
          Relay opens a fresh browser for this website. Sign in there and it remembers.
        </DialogDescription>
        <form onSubmit={submit} className="grid gap-5">
          <Field>
            <FieldLabel htmlFor="space-url">Website</FieldLabel>
            <Input
              id="space-url"
              inputMode="url"
              value={startUrl}
              onChange={(event) => setStartUrl(event.currentTarget.value)}
              placeholder="staging.example.com"
              autoCapitalize="none"
              autoCorrect="off"
              autoFocus
            />
          </Field>
          {create.error ? (
            <FieldError>
              {create.error instanceof Error
                ? create.error.message
                : "Relay could not create this browser."}
            </FieldError>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-2.5">
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (continuation?.kind === "record-test") {
                      void navigate({
                        to: "/tests/new",
                        search: {
                          ...(continuation.appId ? { app: continuation.appId } : {}),
                          ...(continuation.targetId ? { target: continuation.targetId } : {}),
                        },
                      });
                    }
                  }}
                />
              }
            >
              Cancel
            </DialogClose>
            <Button type="submit" variant="default" disabled={!startUrl.trim() || create.isPending}>
              {create.isPending ? "Opening…" : "Open browser"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
