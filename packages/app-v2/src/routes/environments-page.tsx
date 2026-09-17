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
import { PairedWorkspacePanel } from "./paired-workspace-panel";

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EnvironmentsPage() {
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
    mutationFn: () =>
      browserSpacesService.createSpace({
        name,
        startUrl,
        profileRetention: "retain",
      }),
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      setOpen(false);
      if (continuation) {
        await navigate({
          to: "/tests/new",
          search: {
            ...(continuation.appId ? { app: continuation.appId } : {}),
            target: space.id,
          },
        });
      } else {
        await navigate({ to: "/environments/$profileId", params: { profileId: space.id } });
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
        context="Workspace"
        title="Browsers"
        description="Saved browsers you can open, record on, and sign into."
        actions={
          <>
            {continuation ? (
              <Button
                variant="ghost"
                nativeButton={false}
                render={
                  <Link
                    to="/tests/new"
                    search={{
                      ...(continuation.appId ? { app: continuation.appId } : {}),
                      ...(continuation.targetId ? { target: continuation.targetId } : {}),
                    }}
                  />
                }
              >
                Back to recording
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
                  Opens a browser you can record on and sign into.
                </DialogDescription>
                <form onSubmit={submit} className="grid gap-5">
                  <Field>
                    <FieldLabel htmlFor="space-name">Name</FieldLabel>
                    <Input
                      id="space-name"
                      value={name}
                      onChange={(event) => setName(event.currentTarget.value)}
                      placeholder="For example, Staging member"
                      autoComplete="off"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="space-url">Website</FieldLabel>
                    <Input
                      id="space-url"
                      type="url"
                      inputMode="url"
                      value={startUrl}
                      onChange={(event) => setStartUrl(event.currentTarget.value)}
                      placeholder="https://staging.example.com"
                      autoCapitalize="none"
                      autoCorrect="off"
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
                            if (continuation) {
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
                      disabled={!name.trim() || !startUrl.trim() || create.isPending}
                    >
                      {create.isPending ? "Creating…" : "Create browser"}
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
        <ul
          className="mb-6 list-none overflow-hidden rounded-lg border border-border bg-card p-0"
          aria-label="Browsers"
        >
          {spaces.data.map((space) => (
            <li className="border-b border-border last:border-b-0" key={space.id}>
              <Link
                className="flex min-h-20 w-full items-center gap-4 px-4 py-3 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                to="/environments/$profileId"
                params={{ profileId: space.id }}
                search={continuation ? { returnTo: rawReturnTo } : undefined}
              >
                <span
                  className="grid size-9 place-items-center rounded-md border border-border bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <Globe2 className="size-4" />
                </span>
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <strong className="text-sm font-medium wrap-anywhere">{space.name}</strong>
                  <small className="text-xs text-muted-foreground wrap-anywhere">
                    {space.environment?.locale
                      ? `${displayHost(space.startUrl)} · ${space.environment.locale}`
                      : displayHost(space.startUrl)}
                  </small>
                </span>
                <ChevronRight
                  className="size-4 shrink-0 text-muted-foreground"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {spaces.data?.length ? (
        <PairedWorkspacePanel
          workspace={paired.workspace}
          spaces={spaces.data}
          accountsByBrowser={accountsByBrowser}
          onSave={paired.save}
          onOpenLive={(plan) =>
            browserSpacesService.openSpace({
              spaceId: plan.browserId,
              ...(plan.signedOut
                ? { account: { kind: "signed-out" as const } }
                : plan.accountReference || (plan.accountId && plan.accountRevision)
                  ? {
                      account: {
                        kind: "fixture" as const,
                        reference:
                          plan.accountReference ??
                          `authfx:${plan.accountId}:${plan.accountRevision}`,
                      },
                    }
                  : {}),
            })
          }
        />
      ) : null}
      {!spaces.isPending && !spaces.error && spaces.data?.length === 0 ? (
        <EmptyState
          icon={Globe2}
          title="No browsers yet"
          detail="Start one to record or run a Test."
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
