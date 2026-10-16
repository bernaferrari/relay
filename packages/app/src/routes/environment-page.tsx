import { BrowserSignInImport } from "./browser-sign-in-import";
/** @jsxImportSource react */
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@relay/ui-react/components/dropdown-menu";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Link,
  getRouteApi,
  useLocation,
  useNavigate,
  useRouteContext,
} from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
  RefreshCw,
  RotateCcw,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { FormPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { readSetupContinuation } from "../data/setup-continuation";
import { BrowserLaneTabs } from "../components/browser-lane-tabs";
import { PageLoading } from "./recording-shared";
import { productLinkClassName } from "../lib/class-names";
import type { ProductBrowserAuthFixture } from "../data/browser-spaces-product-service";
import { PersonAvatar, tintFor } from "./browsers-side-by-side";

const routeApi = getRouteApi("/environments/$profileId");

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function signInStatus(fixture: { revokedAt?: number; expiresAt?: number }): string | undefined {
  if (fixture.revokedAt !== undefined) return "Revoked";
  if (fixture.expiresAt && fixture.expiresAt <= Date.now()) return "Expired";
  return undefined;
}

export function EnvironmentPage() {
  const { appResourcesService, browserSpacesService, suiteProfileService, queryClient, platform } =
    useRouteContext({
      from: "__root__",
    });
  const { profileId } = routeApi.useParams();
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const continuation =
    rawSearch && typeof rawSearch === "object" && "returnTo" in rawSearch
      ? readSetupContinuation(rawSearch.returnTo)
      : undefined;
  const [accountOpen, setAccountOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const [revokeFixture, setRevokeFixture] = useState<{ reference: string; name: string }>();
  const [accountName, setAccountName] = useState("");
  const spaces = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 10_000,
  });
  const space = spaces.data?.find((candidate) => candidate.id === profileId);
  const fixtures = useQuery({
    queryKey: ["browser-spaces", profileId, "accounts"],
    queryFn: () => browserSpacesService.listAuthenticationFixtures(profileId),
    enabled: Boolean(space),
    staleTime: 5_000,
  });
  const readiness = useQuery({
    queryKey: ["environments", profileId, "preflight"],
    queryFn: () => suiteProfileService.preflightEnvironment({ profileId }),
    enabled: Boolean(space),
    retry: false,
  });
  const open = useMutation({
    mutationFn: () => browserSpacesService.openSpace(profileId),
    onSuccess: (session) =>
      navigate({ to: "/devices/$deviceId", params: { deviceId: session.targetId } }),
  });
  const openExternal = useMutation({
    mutationFn: () =>
      browserSpacesService.openSpace({ spaceId: profileId, presentation: "external" }),
  });
  const lanes = useQuery({
    queryKey: ["app-resources", "account-lanes"],
    queryFn: () => appResourcesService.listAccountLanes?.() ?? Promise.resolve([]),
    staleTime: 10_000,
  });
  const accountHealth = useQuery({
    queryKey: ["environments", profileId, "account-health"],
    queryFn: () =>
      appResourcesService.probeBrowserAccountHealth?.({
        targetId: space!.id,
        probe: false,
      }) ?? Promise.resolve(undefined),
    enabled: Boolean(space && appResourcesService.probeBrowserAccountHealth),
    staleTime: 10_000,
  });
  const openLane = useMutation({
    mutationFn: async (laneId: string) => {
      const session = await browserSpacesService.openSpace({
        spaceId: profileId,
        laneId,
        presentation: "embedded",
      });
      if (platform.openLaneTab && session.url) {
        await platform.openLaneTab({ url: session.url, laneId });
      }
      return session;
    },
    onSuccess: (session) =>
      navigate({ to: "/devices/$deviceId", params: { deviceId: session.targetId } }),
  });
  const saveAccount = useMutation({
    mutationFn: () =>
      browserSpacesService.saveAuthenticationFixture({ spaceId: profileId, name: accountName }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces", profileId, "accounts"] });
      setAccountOpen(false);
      setAccountName("");
    },
  });
  const refreshAccount = useMutation({
    mutationFn: (input: { fixtureId: string; name: string }) =>
      browserSpacesService.refreshAuthenticationFixture({ spaceId: profileId, ...input }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["browser-spaces", profileId, "accounts"] }),
  });
  const revokeAccount = useMutation({
    mutationFn: (reference: string) =>
      browserSpacesService.revokeAuthenticationFixture({ spaceId: profileId, reference }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces", profileId, "accounts"] });
      setRevokeFixture(undefined);
    },
  });
  const remove = useMutation({
    mutationFn: () => browserSpacesService.removeSpace(profileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
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
            ...(continuation.appId ? { app: continuation.appId } : {}),
            ...(continuation.targetId ? { target: continuation.targetId } : {}),
          },
        });
      } else {
        await navigate({ to: "/environments" });
      }
    },
  });

  function submitAccount(event: FormEvent) {
    event.preventDefault();
    saveAccount.mutate();
  }

  const failedChecks =
    readiness.data?.target.checks.filter((check) => check.status === "fail") ?? [];
  const warningChecks =
    readiness.data?.target.checks.filter((check) => check.status === "warning") ?? [];
  // One browser is one identity: its newest active sign-in. Anything older is history.
  const activeAccounts = [
    ...(fixtures.data?.filter((fixture) => fixture.revokedAt === undefined) ?? []),
  ].sort((a, b) => b.createdAt - a.createdAt);
  const currentAccounts = activeAccounts.slice(0, 1);
  const inactiveAccounts = [
    ...activeAccounts.slice(1),
    ...(fixtures.data?.filter((fixture) => fixture.revokedAt !== undefined) ?? []),
  ];

  function accountRow(fixture: ProductBrowserAuthFixture) {
    const status = signInStatus(fixture);
    const active = fixture.revokedAt === undefined;
    return (
      <li className="flex items-center gap-3 px-4 py-3" key={fixture.reference}>
        <PersonAvatar name={fixture.name} />
        <span className="grid min-w-0 flex-1">
          <strong className="truncate text-sm font-medium">{fixture.name}</strong>
          <small
            className={`text-xs ${status ? "text-warning-foreground" : "text-muted-foreground"}`}
          >
            {status ??
              `Saved ${new Date(fixture.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`}
          </small>
        </span>
        {active ? (
          <span className="flex shrink-0 items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refreshAccount.mutate({ fixtureId: fixture.id, name: fixture.name })}
              disabled={refreshAccount.isPending}
              title="Replace it with the sign-in open in this browser right now"
            >
              <RefreshCw aria-hidden="true" /> Update
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button size="icon-sm" variant="ghost" aria-label={`More for ${fixture.name}`} />
                }
              >
                <MoreHorizontal aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={6}>
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => {
                    revokeAccount.reset();
                    setRevokeFixture(fixture);
                  }}
                  disabled={revokeAccount.isPending}
                >
                  Revoke sign-in
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        ) : null}
      </li>
    );
  }

  return (
    <FormPage>
      {spaces.isPending ? <PageLoading label="Loading browser…" /> : null}
      {spaces.error ? (
        <RecoveryState
          layout="centered"
          title="This browser is unavailable"
          detail="Reconnect Relay, then try again."
          action={
            <Button variant="outline" onClick={() => void spaces.refetch()}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {!spaces.isPending && !spaces.error && !space ? (
        <EmptyState
          title="Browser not found"
          detail="It may have been removed from this workspace."
          action={
            <Link className={productLinkClassName} to="/environments">
              Back to browsers
            </Link>
          }
        />
      ) : null}
      {space ? (
        <>
          <Link
            to="/environments"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-4" aria-hidden="true" /> Browsers
          </Link>
          <header className="mt-3 mb-6 flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-4">
              <span
                aria-hidden="true"
                className={`grid size-12 shrink-0 place-items-center rounded-xl text-lg font-semibold ${tintFor(displayHost(space.startUrl))}`}
              >
                {displayHost(space.startUrl)
                  .replace(/^www\./u, "")
                  .charAt(0)
                  .toUpperCase() || "?"}
              </span>
              <div className="grid min-w-0 gap-0.5">
                <h1 className="truncate font-display text-3xl leading-9 font-semibold tracking-[-0.025em]">
                  {space.name}
                </h1>
                <p className="truncate text-sm text-muted-foreground">
                  {displayHost(space.startUrl)}
                  {space.environment?.locale ? ` · ${space.environment.locale}` : ""}
                </p>
              </div>
            </div>
            {
              <div className="flex items-center gap-2">
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
                            ...(continuation.appId ? { app: continuation.appId } : {}),
                            ...(continuation.targetId ? { target: continuation.targetId } : {}),
                          }}
                        />
                      )
                    }
                  >
                    {continuation.kind === "run-setup" ? "Back to test" : "Back to recording"}
                  </Button>
                ) : null}
                <Button variant="default" onClick={() => open.mutate()} disabled={open.isPending}>
                  {open.isPending ? "Opening…" : "Open browser"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" disabled={openExternal.isPending} />}
                  >
                    <MoreHorizontal aria-hidden="true" /> More
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" sideOffset={6}>
                    <DropdownMenuItem
                      onClick={() => openExternal.mutate()}
                      disabled={openExternal.isPending}
                    >
                      {openExternal.isPending ? "Opening…" : "Open browser window"}
                    </DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setRemoveOpen(true)}>
                      Remove
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          </header>
          {open.error || openExternal.error || openLane.error ? (
            <FieldError>
              {(open.error ?? openExternal.error ?? openLane.error) instanceof Error
                ? (open.error ?? openExternal.error ?? openLane.error)?.message
                : "Relay could not open this browser."}
            </FieldError>
          ) : null}

          {readiness.error ? (
            <RecoveryState
              className="mt-2"
              title="Relay could not check this browser"
              detail="Open it anyway, or check again."
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void readiness.refetch()}
                  disabled={readiness.isFetching}
                >
                  <RotateCcw aria-hidden="true" />
                  {readiness.isFetching ? "Checking…" : "Check again"}
                </Button>
              }
            />
          ) : null}
          {readiness.data && !readiness.data.target.ok ? (
            <RecoveryState
              className="mt-2"
              title="This browser needs attention"
              detail={
                /ERR_CONNECTION_REFUSED|connection refused/iu.test(
                  failedChecks[0]?.message ?? warningChecks[0]?.message ?? "",
                )
                  ? "The app at this browser’s address isn’t running or can’t be reached. Start the app, then choose Check again."
                  : (failedChecks[0]?.message ??
                    warningChecks[0]?.message ??
                    "Some checks failed. Open the browser and try again.")
              }
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void readiness.refetch()}
                  disabled={readiness.isFetching}
                >
                  <RotateCcw aria-hidden="true" />
                  {readiness.isFetching ? "Checking…" : "Check again"}
                </Button>
              }
            />
          ) : null}

          <BrowserLaneTabs
            lanes={lanes.data ?? []}
            targetId={space.id}
            disabled={openLane.isPending}
            electronGrokLabPartitionPresent={
              accountHealth.data?.summary.electronGrokLabPartitionPresent
            }
            onOpen={(tab) => openLane.mutate(tab.laneId)}
          />

          <section className="mt-8 grid gap-3" aria-labelledby="environment-account-title">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div className="grid gap-0.5">
                <h2 id="environment-account-title" className="text-base font-semibold">
                  Sign-in
                </h2>
                <p className="text-sm text-muted-foreground">
                  This browser opens signed in as this account, and tests start from it.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <BrowserSignInImport
                  service={browserSpacesService}
                  spaces={spaces.data ?? []}
                  spaceId={profileId}
                />
                {currentAccounts.length ? null : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setAccountName("");
                      saveAccount.reset();
                      setAccountOpen(true);
                    }}
                  >
                    <Plus aria-hidden="true" /> Save sign-in
                  </Button>
                )}
              </div>
            </div>
            {fixtures.isPending ? <PageLoading label="Loading accounts…" /> : null}
            {currentAccounts.length ? (
              <ul
                data-slot="environment-accounts"
                className="grid list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0"
              >
                {currentAccounts.map(accountRow)}
              </ul>
            ) : !fixtures.isPending ? (
              // First time: three plain steps, with the two buttons that do them.
              <div className="grid gap-4 rounded-xl border border-dashed border-border p-5">
                <ol className="grid list-none gap-3 p-0 sm:grid-cols-3">
                  {[
                    ["Open the browser", "Relay opens it with its own clean profile."],
                    ["Sign in to an account", "Use the site normally, like Admin or Member."],
                    ["Save it here", "Name it, like Admin. Tests start signed in."],
                  ].map(([title, detail], index) => (
                    <li key={title} className="flex gap-3">
                      <span className="grid size-6 shrink-0 place-items-center rounded-full bg-muted text-xs font-medium tabular-nums">
                        {index + 1}
                      </span>
                      <span className="grid gap-0.5">
                        <span className="text-sm font-medium">{title}</span>
                        <span className="text-xs leading-relaxed text-muted-foreground">
                          {detail}
                        </span>
                      </span>
                    </li>
                  ))}
                </ol>
                <div className="flex flex-wrap gap-2">
                  <Button size="sm" onClick={() => open.mutate()} disabled={open.isPending}>
                    {open.isPending ? "Opening…" : "Open browser"}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setAccountName("");
                      saveAccount.reset();
                      setAccountOpen(true);
                    }}
                  >
                    Save sign-in
                  </Button>
                </div>
              </div>
            ) : null}
            {inactiveAccounts.length ? (
              <Collapsible key={profileId} className="mt-3 border-t border-border">
                <CollapsibleTrigger
                  aria-label={`Earlier sign-ins, ${inactiveAccounts.length}`}
                  className="group flex min-h-11 w-full items-center gap-2 rounded-md px-1 py-2 text-left text-sm text-muted-foreground outline-none hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2"
                >
                  <ChevronRight
                    className="size-4 shrink-0 group-aria-expanded:rotate-90"
                    aria-hidden="true"
                  />
                  <span>Earlier sign-ins</span>
                  <span className="text-xs tabular-nums">{inactiveAccounts.length}</span>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <ul data-slot="environment-inactive-accounts" className="grid list-none p-0">
                    {inactiveAccounts.map(accountRow)}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            ) : null}
            {fixtures.error || saveAccount.error || refreshAccount.error || revokeAccount.error ? (
              <FieldError>
                {[
                  fixtures.error,
                  saveAccount.error,
                  refreshAccount.error,
                  revokeAccount.error,
                ].find(Boolean) instanceof Error
                  ? (
                      [
                        fixtures.error,
                        saveAccount.error,
                        refreshAccount.error,
                        revokeAccount.error,
                      ].find(Boolean) as Error
                    ).message
                  : "Relay could not update this sign-in."}
              </FieldError>
            ) : null}
          </section>

          <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
            <DialogContent showCloseButton={false}>
              <DialogTitle>Remove {space.name}?</DialogTitle>
              <DialogDescription>
                Saved sign-ins for this browser will be removed. Existing reports stay.
              </DialogDescription>
              {remove.error ? (
                <FieldError>
                  {remove.error instanceof Error
                    ? remove.error.message
                    : "Relay could not remove this browser."}
                </FieldError>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                <Button
                  variant="destructive"
                  onClick={() => remove.mutate()}
                  disabled={remove.isPending}
                >
                  {remove.isPending ? "Removing…" : "Remove browser"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
            <DialogContent showCloseButton={false}>
              <DialogTitle>Save sign-in</DialogTitle>
              <DialogDescription>
                Sign in inside this browser first, then name the account, like Admin.
              </DialogDescription>
              <form onSubmit={submitAccount}>
                <Field>
                  <FieldLabel htmlFor="account-fixture-name">Account name</FieldLabel>
                  <Input
                    id="account-fixture-name"
                    value={accountName}
                    onChange={(event) => setAccountName(event.currentTarget.value)}
                    placeholder="For example, Staging member"
                    autoComplete="off"
                    autoFocus
                  />
                </Field>
                {saveAccount.error ? (
                  <FieldError>
                    {saveAccount.error instanceof Error
                      ? saveAccount.error.message
                      : "Relay could not save this sign-in."}
                  </FieldError>
                ) : null}
                <div className="flex flex-wrap items-center justify-end gap-2.5">
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button
                    type="submit"
                    variant="default"
                    disabled={!accountName.trim() || saveAccount.isPending}
                  >
                    {saveAccount.isPending ? "Saving…" : "Save"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog
            open={Boolean(revokeFixture)}
            onOpenChange={(open) => {
              if (!open) setRevokeFixture(undefined);
            }}
          >
            <DialogContent showCloseButton={false}>
              <DialogTitle>Revoke {revokeFixture?.name}?</DialogTitle>
              <DialogDescription>
                Relay will keep the audit record and existing run evidence. This named sign-in will
                no longer be valid for future authenticated tests.
              </DialogDescription>
              {revokeAccount.error ? (
                <FieldError>
                  {revokeAccount.error instanceof Error
                    ? revokeAccount.error.message
                    : "Relay could not revoke this sign-in."}
                </FieldError>
              ) : null}
              <div className="flex flex-wrap items-center justify-end gap-2.5">
                <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                <Button
                  variant="destructive"
                  onClick={() => {
                    if (revokeFixture) revokeAccount.mutate(revokeFixture.reference);
                  }}
                  disabled={!revokeFixture || revokeAccount.isPending}
                >
                  {revokeAccount.isPending ? "Revoking…" : "Revoke sign-in"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </>
      ) : null}
    </FormPage>
  );
}
