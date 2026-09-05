/** @jsxImportSource react */
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Badge } from "@relay/ui-react/components/badge";
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
import { ExternalLink, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { Breadcrumbs, EmptyState, RecoveryState } from "../components/product-patterns";
import { readSetupContinuation } from "../data/setup-continuation";
import { PageLoading } from "./recording-shared";

const routeApi = getRouteApi("/environments/$profileId");

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EnvironmentPage() {
  const { browserSpacesService, suiteProfileService, platform, queryClient } = useRouteContext({
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
    mutationFn: () => browserSpacesService.openSpace(profileId),
    onSuccess: (session) => platform.openExternal?.(session.url),
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
    <LibraryPage className="max-w-[1040px]">
      <Breadcrumbs
        items={[{ label: "Browsers", to: "/environments" }, { label: space?.name ?? "Browser" }]}
      />
      {continuation ? (
        <Link
          className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
          to="/tests/new"
          search={{
            ...(continuation.appId ? { app: continuation.appId } : {}),
            ...(continuation.targetId ? { target: continuation.targetId } : {}),
          }}
        >
          ← Back to recording
        </Link>
      ) : null}
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
            context="Browser"
            title={space.name}
            description={`${displayHost(space.startUrl)} · ${space.persistent ? "Keeps sign-in" : "Fresh each time"}`}
            actions={
              <>
                <Button variant="default" onClick={() => open.mutate()} disabled={open.isPending}>
                  {open.isPending ? "Opening…" : "Open"}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => openExternal.mutate()}
                  disabled={openExternal.isPending}
                >
                  <ExternalLink aria-hidden="true" />{" "}
                  {openExternal.isPending ? "Opening…" : "Open in system browser"}
                </Button>
              </>
            }
          />
          {open.error || openExternal.error ? (
            <FieldError>
              {(open.error ?? openExternal.error) instanceof Error
                ? (open.error ?? openExternal.error)?.message
                : "Relay could not open this browser."}
            </FieldError>
          ) : null}

          <div className="mt-6 grid grid-cols-2 items-start gap-4 max-[780px]:grid-cols-1">
            <section
              className="min-w-0 rounded-xl border border-border bg-card p-[18px] shadow-sm"
              aria-labelledby="environment-readiness-title"
            >
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Readiness
              </p>
              <h2
                id="environment-readiness-title"
                className="mt-1 text-base font-semibold text-foreground"
              >
                Current checks
              </h2>
              {readiness.isPending ? <PageLoading label="Checking browser…" /> : null}
              {readiness.data ? (
                <>
                  <div className="relay-environment-ready-line mt-4 flex flex-wrap items-center gap-2 border-b border-border pb-3 text-sm font-semibold">
                    <Badge
                      variant={readiness.data.target.ok ? "default" : "secondary"}
                      className={
                        readiness.data.target.ok
                          ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                          : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                      }
                    >
                      {readiness.data.target.ok ? "Ready" : "Needs attention"}
                    </Badge>
                    {readiness.data.target.capabilities.length ? (
                      <span className="text-sm font-normal text-muted-foreground">
                        {readiness.data.target.ok
                          ? "Can record and run Tests"
                          : "Some checks failed"}
                      </span>
                    ) : null}
                  </div>
                  <ul className="relay-environment-checks mt-4 grid gap-3 p-0">
                    {readiness.data.target.checks.map((check) => (
                      <li
                        className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-3"
                        key={check.id}
                      >
                        <Badge
                          variant={check.status === "fail" ? "destructive" : "secondary"}
                          className={
                            check.status === "pass"
                              ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                              : check.status === "warning"
                                ? "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                                : undefined
                          }
                        >
                          {check.status === "pass"
                            ? "Ready"
                            : check.status === "fail"
                              ? "Needs work"
                              : "Warning"}
                        </Badge>
                        <span className="grid gap-0.5">
                          <strong className="text-sm font-medium text-foreground">
                            {check.label}
                          </strong>
                          <small className="text-xs leading-5 text-muted-foreground">
                            {check.message}
                          </small>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!failedChecks.length &&
                  !warningChecks.length &&
                  !readiness.data.target.checks.length ? (
                    <p className="relay-action-hint mt-3 text-sm leading-relaxed text-muted-foreground">
                      This browser is ready.
                    </p>
                  ) : null}
                </>
              ) : null}
              {readiness.error ? (
                <FieldError>
                  {readiness.error instanceof Error
                    ? readiness.error.message
                    : "Relay could not check this browser."}
                </FieldError>
              ) : null}
              <Button
                className="mt-4"
                variant="outline"
                size="sm"
                onClick={() => void readiness.refetch()}
                disabled={readiness.isFetching}
              >
                <RotateCcw aria-hidden="true" />{" "}
                {readiness.isFetching ? "Checking…" : "Check again"}
              </Button>
            </section>

            <section
              className="min-w-0 rounded-xl border border-border bg-card p-[18px] shadow-sm"
              aria-labelledby="environment-account-title"
            >
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Sign-ins
              </p>
              <h2
                id="environment-account-title"
                className="mt-1 text-base font-semibold text-foreground"
              >
                Saved sign-ins
              </h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                Reuse a signed-in session when you run a Test.
              </p>
              {fixtures.isPending ? <PageLoading label="Loading sign-ins…" /> : null}
              {fixtures.data?.length ? (
                <ul className="relay-environment-accounts grid gap-2 p-0">
                  {fixtures.data.map((fixture) => (
                    <li
                      className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-border p-3"
                      key={fixture.reference}
                    >
                      <span
                        className="relay-account-shield grid size-8 place-items-center rounded-full bg-muted text-muted-foreground"
                        aria-hidden="true"
                      >
                        <ShieldCheck />
                      </span>
                      <span className="grid min-w-0 gap-0.5">
                        <strong className="text-sm font-medium text-foreground wrap-anywhere">
                          {fixture.name}
                        </strong>
                        <small className="text-xs text-muted-foreground">
                          {fixture.cookieCount} {fixture.cookieCount === 1 ? "cookie" : "cookies"} ·
                          revision {fixture.revision}
                        </small>
                        <small className="text-xs font-medium text-muted-foreground">
                          {fixture.revokedAt
                            ? "Revoked"
                            : fixture.expiresAt && fixture.expiresAt <= Date.now()
                              ? "Expired"
                              : "Available"}
                        </small>
                      </span>
                      <div className="col-start-2 flex flex-wrap gap-1">
                        {!fixture.revokedAt ? (
                          <>
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
                          </>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : !fixtures.isPending ? (
                <p className="relay-action-hint mt-3 text-sm leading-relaxed text-muted-foreground">
                  No sign-in saved yet.
                </p>
              ) : null}
              {fixtures.error ||
              saveAccount.error ||
              refreshAccount.error ||
              revokeAccount.error ? (
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
                className="mt-4"
                variant="outline"
                size="sm"
                onClick={() => {
                  setAccountName("");
                  saveAccount.reset();
                  setAccountOpen(true);
                }}
              >
                Save current sign-in
              </Button>
            </section>
          </div>

          <section
            className="mt-6 flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-xl border border-red-500/40 bg-red-500/5 p-[18px]"
            aria-labelledby="remove-environment-title"
          >
            <div>
              <h2 id="remove-environment-title">Remove browser</h2>
              <p>Saved sign-ins for this browser will be removed. Existing reports stay.</p>
            </div>
            <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
              <DialogTrigger render={<Button variant="outline" />}>
                <Trash2 aria-hidden="true" /> Remove
              </DialogTrigger>

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
                    className="text-red-700 dark:text-red-300"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                  >
                    {remove.isPending ? "Removing…" : "Remove browser"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </section>

          <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
            <DialogContent showCloseButton={false}>
              <DialogTitle>Save current sign-in</DialogTitle>
              <DialogDescription>
                Open the browser, sign in, then save that sign-in under a name.
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
                    {saveAccount.isPending ? "Saving…" : "Save sign-in"}
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
                  className="text-red-700 dark:text-red-300"
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
    </LibraryPage>
  );
}
