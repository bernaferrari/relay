/** @jsxImportSource react */
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";

import { useMutation, useQueries, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, Globe2, Plus, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { readSetupContinuation } from "../data/setup-continuation";
import { usePairedConfigurationWorkspace } from "../data/use-paired-configuration-workspace";
import { PageLoading } from "./recording-shared";
import { BrowserSignInImport } from "./browser-sign-in-import";
import { BrowserWorkspacePage } from "./browser-workspace-page";
import { websiteName } from "./new-test-browser-setup";
import {
  SideBySide,
  PersonAvatar,
  browserHost,
  browserLabel,
  tintFor,
} from "./browsers-side-by-side";

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EnvironmentsPage(): import("react").ReactElement {
  const search = useLocation({ select: (state) => state.search as Record<string, unknown> });
  return search.view === "workspace" || search.view === "paired" ? (
    <BrowserWorkspacePage key={String(search.view)} paired={search.view === "paired"} />
  ) : (
    <BrowserLibraryPage />
  );
}

function BrowserLibraryPage() {
  const { browserSpacesService, queryClient, platform } = useRouteContext({ from: "__root__" });
  const paired = usePairedConfigurationWorkspace(platform);
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const rawReturnTo =
    rawSearch && typeof rawSearch === "object" && "returnTo" in rawSearch
      ? String(rawSearch.returnTo)
      : undefined;
  const continuation = rawReturnTo ? readSetupContinuation(rawReturnTo) : undefined;
  const open =
    rawSearch &&
    typeof rawSearch === "object" &&
    "view" in rawSearch &&
    String(rawSearch.view) === "new";
  function setOpen(next: boolean) {
    void navigate({
      to: "/environments",
      search: (previous) => ({ ...previous, view: next ? "new" : undefined }),
      replace: true,
    });
  }
  const [name, setName] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const spaces = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 10_000,
  });
  const accountQueries = useQueries({
    queries: (spaces.data ?? []).map((space) => ({
      queryKey: ["browser-spaces", space.id, "accounts"],
      queryFn: () => browserSpacesService.listAuthenticationFixtures(space.id),
      staleTime: 10_000,
    })),
  });
  const accountsByBrowser = Object.fromEntries(
    (spaces.data ?? []).map((space, index) => [space.id, accountQueries[index]?.data ?? []]),
  );
  const create = useMutation({
    // Only the website matters up front; the name comes from it and can change later.
    mutationFn: () => {
      const address = /^[a-z][a-z\d+.-]*:\/\//iu.test(startUrl.trim())
        ? startUrl.trim()
        : `https://${startUrl.trim()}`;
      return browserSpacesService.createSpace({
        name: name.trim() || websiteName(address),
        startUrl: address,
        profileRetention: "retain",
      });
    },
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      setOpen(false);
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

  function reset() {
    setName("");
    setStartUrl("");
    create.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <LibraryPage className="max-w-5xl">
      <PageHeader
        title="Browsers"
        description="Browsers Relay opens for you. Sign in once in each; tests reuse those sign-ins."
        actions={
          <>
            <BrowserSignInImport service={browserSpacesService} spaces={spaces.data ?? []} />
            {continuation ? (
              <Button
                variant="ghost"
                nativeButton={false}
                render={
                  continuation.kind === "run-setup" ? (
                    <Link
                      to="/tests/$testId"
                      params={{ testId: continuation.testId }}
                      search={{ setup: "run" }}
                    />
                  ) : (
                    <Link
                      to="/tests/new"
                      search={{
                        ...(continuation.kind === "record-test" && continuation.appId
                          ? { app: continuation.appId }
                          : {}),
                        ...(continuation.kind === "record-test" && continuation.targetId
                          ? { target: continuation.targetId }
                          : {}),
                      }}
                    />
                  )
                }
              >
                {continuation.kind === "run-setup" ? "Back to test" : "Back to recording"}
              </Button>
            ) : null}
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                if (next) reset();
              }}
            >
              <DialogTrigger render={<Button variant="default" />}>
                <Plus aria-hidden="true" /> New browser
              </DialogTrigger>

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
                                  ...(continuation.targetId
                                    ? { target: continuation.targetId }
                                    : {}),
                                },
                              });
                            }
                          }}
                        />
                      }
                    >
                      Cancel
                    </DialogClose>
                    <Button
                      type="submit"
                      variant="default"
                      disabled={!startUrl.trim() || create.isPending}
                    >
                      {create.isPending ? "Opening…" : "Open browser"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {spaces.isPending ? <PageLoading label="Loading browsers…" /> : null}
      {spaces.error ? (
        <RecoveryState
          layout="centered"
          title="Browsers are unavailable"
          detail="Reconnect Relay, then try again."
          action={
            <Button variant="outline" onClick={() => void spaces.refetch()}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {spaces.data?.length ? (
        <div className="grid gap-10">
          <SideBySide
            workspace={paired.workspace}
            spaces={spaces.data}
            accountsByBrowser={accountsByBrowser}
            onSave={paired.save}
            onOpen={() => navigate({ to: "/environments", search: { view: "paired" } })}
            onNewBrowser={() => {
              reset();
              setOpen(true);
            }}
          />
          <section aria-labelledby="browser-list-title" className="grid gap-3">
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="browser-list-title" className="text-sm font-semibold">
                Browsers{" "}
                <span className="ml-1 text-muted-foreground tabular-nums">
                  {spaces.data.length}
                </span>
              </h2>
              <p className="text-xs text-muted-foreground">
                Each one remembers its own sign-ins, cookies, and settings.
              </p>
            </div>
            <ul
              className="grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-2 xl:grid-cols-3"
              aria-label="Browsers"
            >
              {spaces.data.map((space) => {
                const signedInAs = [...(accountsByBrowser[space.id] ?? [])]
                  .filter((account) => !account.revokedAt)
                  .sort((a, b) => b.createdAt - a.createdAt)[0]?.name;
                const site = browserHost(space.startUrl);
                return (
                  <li key={space.id}>
                    <Link
                      className="group grid h-full gap-4 rounded-xl border border-border bg-card p-4 transition-[border-color,box-shadow] hover:border-foreground/20 hover:shadow-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      to="/environments/$profileId"
                      params={{ profileId: space.id }}
                      search={continuation ? { returnTo: rawReturnTo } : undefined}
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
                            {browserLabel(space, spaces.data)}
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
                      {/* One browser, one identity: say who it opens as. */}
                      <span className="flex min-h-6 items-center gap-2 text-xs text-muted-foreground">
                        <PersonAvatar name={signedInAs ?? "Signed out"} size="sm" />
                        {signedInAs ? (
                          <span className="truncate">
                            Signed in as{" "}
                            <span className="font-medium text-foreground">{signedInAs}</span>
                          </span>
                        ) : (
                          "Signed out"
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
              <li>
                <button
                  type="button"
                  onClick={() => {
                    reset();
                    setOpen(true);
                  }}
                  className="flex h-full min-h-28 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border text-sm text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <Plus className="size-4" aria-hidden="true" /> New browser
                </button>
              </li>
            </ul>
          </section>
        </div>
      ) : null}
      {!spaces.isPending && !spaces.error && spaces.data?.length === 0 ? (
        <EmptyState
          icon={Globe2}
          title="No browsers yet"
          detail="Start one to record or run a test."
          action={
            <Button
              variant="default"
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              New browser
            </Button>
          }
        />
      ) : null}
    </LibraryPage>
  );
}
