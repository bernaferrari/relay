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
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ExternalLink, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Breadcrumbs, EmptyState, RecoveryState } from "../components/product-patterns";
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
  const [accountOpen, setAccountOpen] = useState(false);
  const [removeOpen, setRemoveOpen] = useState(false);
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
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["browser-spaces", profileId, "accounts"] }),
  });
  const remove = useMutation({
    mutationFn: () => browserSpacesService.removeSpace(profileId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      await navigate({ to: "/environments" });
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
    <section className="relay-page relay-environment-page">
      <Breadcrumbs
        items={[
          { label: "Environments", to: "/environments" },
          { label: space?.name ?? "Environment" },
        ]}
      />
      {spaces.isPending ? <PageLoading label="Loading Environment…" /> : null}
      {spaces.error ? (
        <RecoveryState
          layout="centered"
          title="This Environment is unavailable"
          detail="Reconnect Relay, then load the managed browser Space again."
          action={
            <Button variant="outline" onClick={() => void spaces.refetch()}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {!spaces.isPending && !spaces.error && !space ? (
        <EmptyState
          title="Environment not found"
          detail="It may have been removed from this workspace."
          action={
            <Link className="relay-inline-link" to="/environments">
              Back to Environments
            </Link>
          }
        />
      ) : null}
      {space ? (
        <>
          <header className="relay-page-header relay-environment-detail-header">
            <div>
              <p className="relay-eyebrow">Browser Space</p>
              <h1>{space.name}</h1>
              <p className="relay-page-description">
                {displayHost(space.startUrl)} ·{" "}
                {space.persistent ? "Persistent profile" : "Ephemeral profile"}
              </p>
            </div>
            <Button variant="default" onClick={() => open.mutate()} disabled={open.isPending}>
              <ExternalLink aria-hidden="true" /> {open.isPending ? "Opening…" : "Open Space"}
            </Button>
          </header>
          {open.error ? (
            <FieldError>
              {open.error instanceof Error
                ? open.error.message
                : "Relay could not open this Space."}
            </FieldError>
          ) : null}

          <div className="relay-environment-workspace">
            <section
              className="relay-environment-card"
              aria-labelledby="environment-readiness-title"
            >
              <p className="relay-section-label">Readiness</p>
              <h2 id="environment-readiness-title">Current checks</h2>
              {readiness.isPending ? <PageLoading label="Checking Environment…" /> : null}
              {readiness.data ? (
                <>
                  <div className="relay-environment-ready-line">
                    <Badge
                      variant={readiness.data.target.ok ? "default" : "secondary"}
                      className={
                        readiness.data.target.ok
                          ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                          : "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                      }
                    >
                      {readiness.data.target.ok ? "Ready" : "Needs attention"}
                    </Badge>
                    <span>{readiness.data.target.capabilities.length} available capabilities</span>
                  </div>
                  <ul className="relay-environment-checks">
                    {readiness.data.target.checks.map((check) => (
                      <li key={check.id}>
                        <Badge
                          variant={check.status === "fail" ? "destructive" : "secondary"}
                          className={
                            check.status === "pass"
                              ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
                              : check.status === "warning"
                                ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                                : undefined
                          }
                        >
                          {check.status === "pass"
                            ? "Passed"
                            : check.status === "fail"
                              ? "Failed"
                              : "Warning"}
                        </Badge>
                        <span>
                          <strong>{check.label}</strong>
                          <small>{check.message}</small>
                        </span>
                      </li>
                    ))}
                  </ul>
                  {!failedChecks.length &&
                  !warningChecks.length &&
                  !readiness.data.target.checks.length ? (
                    <p className="relay-action-hint">
                      Relay reported this Space ready without additional checks.
                    </p>
                  ) : null}
                </>
              ) : null}
              {readiness.error ? (
                <FieldError>
                  {readiness.error instanceof Error
                    ? readiness.error.message
                    : "Relay could not check this Environment."}
                </FieldError>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onClick={() => void readiness.refetch()}
                disabled={readiness.isFetching}
              >
                <RotateCcw aria-hidden="true" />{" "}
                {readiness.isFetching ? "Checking…" : "Check again"}
              </Button>
            </section>

            <section className="relay-environment-card" aria-labelledby="environment-account-title">
              <p className="relay-section-label">Accounts</p>
              <h2 id="environment-account-title">Reviewed sign-ins</h2>
              <p>
                Credentials and cookies remain on the Relay host. This page exposes lifecycle
                metadata only.
              </p>
              {fixtures.isPending ? <PageLoading label="Loading reviewed accounts…" /> : null}
              {fixtures.data?.length ? (
                <ul className="relay-environment-accounts">
                  {fixtures.data.map((fixture) => (
                    <li key={fixture.reference}>
                      <span className="relay-account-shield" aria-hidden="true">
                        <ShieldCheck />
                      </span>
                      <span>
                        <strong>{fixture.name}</strong>
                        <small>
                          {fixture.cookieCount} {fixture.cookieCount === 1 ? "cookie" : "cookies"} ·
                          revision {fixture.revision}
                        </small>
                        <small>
                          {fixture.revokedAt
                            ? "Revoked"
                            : fixture.expiresAt && fixture.expiresAt <= Date.now()
                              ? "Expired"
                              : "Available"}
                        </small>
                      </span>
                      <div>
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
                              onClick={() => revokeAccount.mutate(fixture.reference)}
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
                <p className="relay-action-hint">
                  No reviewed sign-in has been saved for this Space.
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
                    : "Relay could not update this account fixture."}
                </FieldError>
              ) : null}
              <Button
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

          <section className="relay-suite-danger" aria-labelledby="remove-environment-title">
            <div>
              <h2 id="remove-environment-title">Remove Browser Space</h2>
              <p>
                The local browser profile and its saved sign-ins will no longer be available to
                Relay.
              </p>
            </div>
            <Dialog open={removeOpen} onOpenChange={setRemoveOpen}>
              <DialogTrigger render={<Button variant="outline" />}>
                <Trash2 aria-hidden="true" /> Remove
              </DialogTrigger>

              <DialogContent showCloseButton={false}>
                <DialogTitle>Remove {space.name}?</DialogTitle>
                <DialogDescription>
                  This removes the managed target from Relay. Reports already created from it remain
                  durable.
                </DialogDescription>
                {remove.error ? (
                  <FieldError>
                    {remove.error instanceof Error
                      ? remove.error.message
                      : "Relay could not remove this Space."}
                  </FieldError>
                ) : null}
                <div className="relay-dialog-actions">
                  <DialogClose render={<Button variant="ghost">Cancel</Button>} />
                  <Button
                    className="relay-suite-remove-confirm"
                    onClick={() => remove.mutate()}
                    disabled={remove.isPending}
                  >
                    {remove.isPending ? "Removing…" : "Remove Space"}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          </section>

          <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
            <DialogContent showCloseButton={false}>
              <DialogTitle>Save current sign-in</DialogTitle>
              <DialogDescription>
                Open this Space, sign in yourself, then save the current reviewed browser state
                under a reusable name.
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
                <div className="relay-dialog-actions">
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
        </>
      ) : null}
    </section>
  );
}
