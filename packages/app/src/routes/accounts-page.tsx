/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useRouteContext } from "@tanstack/react-router";
import { KeyRound, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState } from "../components/product-patterns";
import { SiteIcon } from "../components/site-icon";
import type {
  ProductBrowserAccount,
  ProductBrowserTarget,
} from "../data/app-resources-product-service";
import { RevokeAccountDialog } from "./app-resource-dialogs";
import { AppResourceFrame, ResourceRecovery } from "./app-resource-pages";
import { AddAccountDialog } from "./add-account-dialog";
import {
  accountDisplayName,
  accountFacts,
  accountLastUsedAt,
  accountSiteHost,
  accountSiteUrl,
  accountStatus,
  accountStatusLabel,
  type AccountStatus,
} from "./account-presentation";
import { PageLoading } from "./recording-shared";

const ACCOUNTS_KEY = ["app-resources", "browser-accounts"] as const;

/**
 * Saved logins, as people think of them: an account on a website that tests
 * can run as. Add one by signing in once in a real browser.
 */
export function AppAccountsPage() {
  const { appResourcesService, browserSpacesService, catalogService } = useRouteContext({
    from: "__root__",
  });
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [revokeAccount, setRevokeAccount] = useState<ProductBrowserAccount>();
  const [showRevoked, setShowRevoked] = useState(false);
  /** The account whose sign-in window is open, waiting for "Save sign-in". */
  const [signingIn, setSigningIn] = useState<string>();
  const accounts = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => appResourcesService.listBrowserAccounts(),
    staleTime: 10_000,
  });
  const browsers = useQuery({
    queryKey: ["app-resources", "browser-targets"],
    queryFn: () => appResourcesService.listBrowserTargets?.() ?? Promise.resolve([]),
    staleTime: 10_000,
  });
  const runs = useQuery({
    queryKey: ["accounts", "runs"],
    queryFn: () => catalogService.listRuns().catch(() => []),
    staleTime: 60_000,
  });
  const error = accounts.error ?? browsers.error;
  const loading = accounts.isPending || browsers.isPending;
  const websites = useMemo(() => {
    const seen = new Map<string, ProductBrowserTarget>();
    for (const account of accounts.data ?? []) seen.set(account.target.id, account.target);
    for (const target of browsers.data ?? []) seen.set(target.id, target);
    return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [accounts.data, browsers.data]);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });

  const openSignedIn = useMutation({
    mutationFn: (account: ProductBrowserAccount) =>
      browserSpacesService.openSpace({
        spaceId: account.target.id,
        presentation: "embedded",
        account: { kind: "fixture", reference: account.fixture.reference },
      }),
    onSuccess: (session) =>
      navigate({ to: "/devices/$deviceId", params: { deviceId: session.targetId } }),
  });
  const signInAgain = useMutation({
    mutationFn: async (account: ProductBrowserAccount) => {
      if (!appResourcesService.openBrowserAccountForSignIn) {
        throw new Error("Signing in again is unavailable in this Relay connection.");
      }
      await appResourcesService.openBrowserAccountForSignIn({
        targetId: account.target.id,
        reference: account.fixture.reference,
      });
    },
    onSuccess: (_, account) => setSigningIn(account.fixture.reference),
  });
  const saveSignIn = useMutation({
    mutationFn: async (account: ProductBrowserAccount) => {
      if (!appResourcesService.refreshBrowserAccount) {
        throw new Error("Saving this sign-in is unavailable in this Relay connection.");
      }
      return appResourcesService.refreshBrowserAccount({
        targetId: account.target.id,
        name: account.fixture.name,
        fixtureId: account.fixture.id,
      });
    },
    onSuccess: async () => {
      setSigningIn(undefined);
      await invalidate();
    },
  });
  const check = useMutation({
    mutationFn: async (account: ProductBrowserAccount) => {
      if (!appResourcesService.probeBrowserAccount) {
        throw new Error("Checking this account is unavailable in this Relay connection.");
      }
      return appResourcesService.probeBrowserAccount({
        targetId: account.target.id,
        reference: account.fixture.reference,
      });
    },
    onSuccess: invalidate,
  });
  const checkAll = useMutation({
    mutationFn: async () => {
      if (!appResourcesService.probeBrowserAccountHealth) {
        throw new Error("Checking accounts is unavailable in this Relay connection.");
      }
      const targetIds = new Set(live.map((account) => account.target.id));
      for (const targetId of targetIds) {
        await appResourcesService.probeBrowserAccountHealth({ targetId });
      }
    },
    onSuccess: invalidate,
  });
  const revoke = useMutation({
    mutationFn: async (account: ProductBrowserAccount) => {
      if (!appResourcesService.revokeBrowserAccount) {
        throw new Error("Revoking accounts is unavailable in this Relay connection.");
      }
      return appResourcesService.revokeBrowserAccount({
        targetId: account.target.id,
        reference: account.fixture.reference,
      });
    },
    onSuccess: async () => {
      setRevokeAccount(undefined);
      await invalidate();
    },
  });

  const listed = accounts.data ?? [];
  const live = listed.filter((account) => accountStatus(account) !== "revoked");
  const revoked = listed.filter((account) => accountStatus(account) === "revoked");
  const visible = showRevoked ? listed : live;
  const needsSignIn = live.filter((account) => accountStatus(account) !== "signed-in").length;
  const canAdd = Boolean(appResourcesService.saveBrowserAccount);
  const actionError =
    openSignedIn.error ?? signInAgain.error ?? saveSignIn.error ?? check.error ?? checkAll.error;

  const addButton = (
    <Button
      variant="default"
      onClick={() => setAdding(true)}
      disabled={!canAdd}
      title={canAdd ? undefined : "Adding accounts is unavailable in this Relay connection."}
    >
      <Plus aria-hidden="true" /> Add account
    </Button>
  );

  return (
    <AppResourceFrame
      title="Accounts"
      description="Logins your tests can run as. Sign in once; Relay keeps the session."
      action={
        <span className="inline-flex flex-wrap items-center justify-end gap-1.5">
          {appResourcesService.probeBrowserAccountHealth && live.length ? (
            <Button
              variant="outline"
              onClick={() => checkAll.mutate()}
              disabled={checkAll.isPending}
            >
              {checkAll.isPending ? "Checking…" : "Check all"}
            </Button>
          ) : null}
          {addButton}
        </span>
      }
    >
      {loading ? <PageLoading label="Loading accounts…" /> : null}
      {error ? (
        <ResourceRecovery
          detail="Start Relay, then try loading saved accounts again."
          retrying={accounts.isFetching || browsers.isFetching}
          onRetry={() => {
            void accounts.refetch();
            void browsers.refetch();
          }}
        />
      ) : null}
      {!loading && !error ? (
        <section aria-label="Accounts" className="grid gap-3">
          {actionError ? (
            <p className="text-sm text-destructive" role="alert">
              {actionError instanceof Error
                ? actionError.message
                : "Relay could not update this account."}
            </p>
          ) : null}
          {needsSignIn ? (
            <p className="text-sm text-muted-foreground" role="status">
              {needsSignIn === 1
                ? "1 account needs sign-in. Tests that use it stop before they start."
                : `${needsSignIn} accounts need sign-in. Tests that use them stop before they start.`}
            </p>
          ) : null}
          {listed.length ? (
            <>
              <ul className="grid list-none gap-2 p-0" aria-label="Saved accounts">
                {visible.map((account) => (
                  <AccountCard
                    key={account.fixture.reference}
                    account={account}
                    lastUsedAt={accountLastUsedAt(account, runs.data ?? [])}
                    canCheck={Boolean(appResourcesService.probeBrowserAccount)}
                    canSignIn={Boolean(appResourcesService.openBrowserAccountForSignIn)}
                    canSave={Boolean(appResourcesService.refreshBrowserAccount)}
                    canRevoke={Boolean(appResourcesService.revokeBrowserAccount)}
                    waitingForSignIn={signingIn === account.fixture.reference}
                    busy={{
                      opening:
                        openSignedIn.isPending &&
                        openSignedIn.variables?.fixture.reference === account.fixture.reference,
                      signingIn:
                        signInAgain.isPending &&
                        signInAgain.variables?.fixture.reference === account.fixture.reference,
                      saving:
                        saveSignIn.isPending &&
                        saveSignIn.variables?.fixture.reference === account.fixture.reference,
                      checking:
                        check.isPending &&
                        check.variables?.fixture.reference === account.fixture.reference,
                    }}
                    onOpen={() => openSignedIn.mutate(account)}
                    onSignIn={() => signInAgain.mutate(account)}
                    onSaveSignIn={() => saveSignIn.mutate(account)}
                    onCancelSignIn={() => setSigningIn(undefined)}
                    onCheck={() => check.mutate(account)}
                    onRevoke={() => {
                      revoke.reset();
                      setRevokeAccount(account);
                    }}
                  />
                ))}
              </ul>
              {revoked.length ? (
                <p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowRevoked((current) => !current)}
                  >
                    {showRevoked ? "Hide revoked" : `Show ${revoked.length} revoked`}
                  </Button>
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState
              icon={KeyRound}
              title="No accounts yet"
              detail="Save a login once; tests can run as it."
              action={canAdd ? addButton : undefined}
            />
          )}
        </section>
      ) : null}
      {adding ? (
        <AddAccountDialog
          websites={websites}
          onClose={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await invalidate();
            await queryClient.invalidateQueries({ queryKey: ["app-resources", "browser-targets"] });
          }}
        />
      ) : null}
      {revokeAccount ? (
        <RevokeAccountDialog
          account={revokeAccount}
          pending={revoke.isPending}
          error={revoke.error}
          onClose={() => {
            if (!revoke.isPending) setRevokeAccount(undefined);
          }}
          onConfirm={() => revoke.mutate(revokeAccount)}
        />
      ) : null}
    </AppResourceFrame>
  );
}

const STATUS_TONE: Record<AccountStatus, string> = {
  "signed-in": "bg-success/15 text-success-foreground",
  "needs-sign-in": "bg-warning/15 text-warning-foreground",
  "unchecked-error": "bg-destructive/12 text-destructive",
  revoked: "bg-muted text-muted-foreground",
};

function AccountCard({
  account,
  lastUsedAt,
  canCheck,
  canSignIn,
  canSave,
  canRevoke,
  waitingForSignIn,
  busy,
  onOpen,
  onSignIn,
  onSaveSignIn,
  onCancelSignIn,
  onCheck,
  onRevoke,
}: {
  account: ProductBrowserAccount;
  lastUsedAt?: number;
  canCheck: boolean;
  canSignIn: boolean;
  canSave: boolean;
  canRevoke: boolean;
  waitingForSignIn: boolean;
  busy: { opening: boolean; signingIn: boolean; saving: boolean; checking: boolean };
  onOpen(): void;
  onSignIn(): void;
  onSaveSignIn(): void;
  onCancelSignIn(): void;
  onCheck(): void;
  onRevoke(): void;
}) {
  const status = accountStatus(account);
  const name = accountDisplayName(account);
  const siteUrl = accountSiteUrl(account);
  const host = accountSiteHost(account) ?? account.target.name;
  const facts = accountFacts(account, lastUsedAt);
  const active = status !== "revoked";
  const needsSignIn = status === "needs-sign-in" || status === "unchecked-error";
  return (
    <li
      className="grid gap-3 rounded-lg border border-border bg-card p-4"
      aria-label={`${name} on ${host}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-md border border-border bg-background">
          <SiteIcon url={siteUrl} className="size-5" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <strong className="truncate text-sm font-semibold">{name}</strong>
            <span
              className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${STATUS_TONE[status]}`}
            >
              {accountStatusLabel(status)}
            </span>
          </div>
          <p className="truncate text-sm text-muted-foreground">{host}</p>
          <p className="text-xs text-muted-foreground">{facts.join(" · ")}</p>
        </div>
      </div>
      {active && waitingForSignIn ? (
        <div
          className="flex flex-wrap items-center gap-2 rounded-md bg-muted/60 px-3 py-2 text-sm"
          role="status"
        >
          <span className="min-w-0 flex-1">
            Finish signing in to {host} in the browser window
            {canSave ? ", then save." : "."}
          </span>
          {canSave ? (
            <Button size="sm" onClick={onSaveSignIn} disabled={busy.saving}>
              {busy.saving ? "Saving…" : "Save sign-in"}
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={onCancelSignIn} disabled={busy.saving}>
            Cancel
          </Button>
        </div>
      ) : null}
      {active ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {needsSignIn && canSignIn ? (
            <Button size="sm" onClick={onSignIn} disabled={busy.signingIn}>
              {busy.signingIn ? "Opening…" : "Sign in again"}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant={needsSignIn ? "outline" : "default"}
            onClick={onOpen}
            disabled={busy.opening}
            aria-label={`Open ${host} signed in as ${name}`}
          >
            {busy.opening ? "Opening…" : "Open signed in"}
          </Button>
          {siteUrl ? (
            <Button
              size="sm"
              variant="outline"
              nativeButton={false}
              render={
                <Link to="/tests/new" search={{ site: siteUrl, account: account.fixture.id }} />
              }
            >
              New test as this account
            </Button>
          ) : null}
          <span className="flex-1" />
          {!needsSignIn && canSignIn ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onSignIn}
              disabled={busy.signingIn}
              aria-label={`Refresh sign-in for ${name}`}
            >
              {busy.signingIn ? "Opening…" : "Refresh sign-in"}
            </Button>
          ) : null}
          {canCheck ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onCheck}
              disabled={busy.checking}
              aria-label={`Check ${name}`}
            >
              {busy.checking ? "Checking…" : "Check"}
            </Button>
          ) : null}
          {canRevoke ? (
            <Button size="sm" variant="ghost" onClick={onRevoke} aria-label={`Revoke ${name}`}>
              Revoke
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}
