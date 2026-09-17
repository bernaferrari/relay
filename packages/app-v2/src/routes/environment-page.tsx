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
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Link,
  getRouteApi,
  useLocation,
  useNavigate,
  useRouteContext,
} from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { FormPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { readSetupContinuation } from "../data/setup-continuation";
import { BrowserLaneTabs } from "../components/browser-lane-tabs";
import { PageLoading } from "./recording-shared";

const routeApi = getRouteApi("/environments/$profileId");

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function signInStatus(fixture: { revokedAt?: number; expiresAt?: number }): string | undefined {
  if (fixture.revokedAt) return "Revoked";
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
      if (continuation) {
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
            <Link
              className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
              to="/environments"
            >
              Back to browsers
            </Link>
          }
        />
      ) : null}
      {space ? (
        <>
          <PageHeader
            crumbs={[{ label: "Browsers", to: "/environments" }, { label: space.name }]}
            title={space.name}
            description={displayHost(space.startUrl)}
            actions={
              <div className="flex items-center gap-2">
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
                <Button variant="default" onClick={() => open.mutate()} disabled={open.isPending}>
                  {open.isPending ? "Opening…" : "Open in Relay"}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={<Button variant="ghost" disabled={openExternal.isPending} />}
                  >
                    More
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
          />
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
                  <RotateCcw aria-hidden="true" />{" "}
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
                failedChecks[0]?.message ??
                warningChecks[0]?.message ??
                "Some checks failed. Open it and try again."
              }
              action={
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void readiness.refetch()}
                  disabled={readiness.isFetching}
                >
                  <RotateCcw aria-hidden="true" />{" "}
                  {readiness.isFetching ? "Checking…" : "Check again"}
                </Button>
              }
            />
          ) : null}

          <BrowserLaneTabs
            lanes={lanes.data ?? []}
            targetId={space.id}
            disabled={openLane.isPending}
            onOpen={(tab) => openLane.mutate(tab.laneId)}
          />

          <section className="mt-2" aria-labelledby="environment-account-title">
            <h2
              id="environment-account-title"
              className="text-[13px] font-medium text-muted-foreground"
            >
              Sign-ins
            </h2>
            {fixtures.isPending ? <PageLoading label="Loading sign-ins…" /> : null}
            {fixtures.data?.length ? (
              <ul className="relay-environment-accounts mt-2 grid list-none p-0">
                {fixtures.data.map((fixture) => {
                  const status = signInStatus(fixture);
                  return (
                    <li
                      className="flex items-center gap-4 border-t border-border py-2.5 first:border-t-0 first:pt-0"
                      key={fixture.reference}
                    >
                      <span className="min-w-0 flex-1">
                        <strong className="block text-[13px] font-medium wrap-anywhere">
                          {fixture.name}
                        </strong>
                        {status ? (
                          <small className="text-[12px] text-muted-foreground">{status}</small>
                        ) : null}
                      </span>
                      {!fixture.revokedAt ? (
                        <span className="flex shrink-0 items-center">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              refreshAccount.mutate({ fixtureId: fixture.id, name: fixture.name })
                            }
                            disabled={refreshAccount.isPending}
                          >
                            Refresh
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              revokeAccount.reset();
                              setRevokeFixture(fixture);
                            }}
                            disabled={revokeAccount.isPending}
                          >
                            Revoke
                          </Button>
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : !fixtures.isPending ? (
              <p className="mt-2 text-[13px] leading-5 text-muted-foreground">
                No sign-in saved yet.
              </p>
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
            <Button
              className="mt-1"
              variant="ghost"
              size="sm"
              onClick={() => {
                setAccountName("");
                saveAccount.reset();
                setAccountOpen(true);
              }}
            >
              Save sign-in
            </Button>
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
              <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
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
                Open the browser, sign in, then save it under a name.
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
                <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
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
                Relay will keep the audit record and existing Run evidence. This named sign-in will
                no longer be valid for future authenticated Tests.
              </DialogDescription>
              {revokeAccount.error ? (
                <FieldError>
                  {revokeAccount.error instanceof Error
                    ? revokeAccount.error.message
                    : "Relay could not revoke this sign-in."}
                </FieldError>
              ) : null}
              <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
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
