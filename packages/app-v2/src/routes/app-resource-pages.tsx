/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Box, KeyRound, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import type {
  ProductAccountLane,
  ProductAppVersion,
  ProductBrowserAccount,
} from "../data/app-resources-product-service";
import {
  BrowserAccountDialog,
  RevokeAccountDialog,
  VersionEditorDialog,
  VersionRow,
  type AccountDraft,
  type AccountRefreshInput,
  type VersionDraft,
} from "./app-resource-dialogs";
import { PageLoading } from "./recording-shared";
import {
  accountHealthState,
  concurrentAccountCopy,
  probedAccountIdentity,
  readySignIns,
  healthCheckedAt,
  lanesForAccount,
  liveSignIns,
  revokedSignIns,
  signInStatusLabel,
} from "./sign-ins-health";

export function AppVersionsPage() {
  const { appResourcesService } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<ProductAppVersion | "create">();
  const versions = useQuery({
    queryKey: ["app-resources", "versions"],
    queryFn: () => appResourcesService.listVersions(),
    staleTime: 15_000,
  });
  const error = versions.error;
  const loading = versions.isPending;
  const saveVersion = useMutation({
    mutationFn: async ({ mode, input }: { mode: "create" | "edit"; input: VersionDraft }) => {
      const operation =
        mode === "edit"
          ? (appResourcesService.updateVersion ?? appResourcesService.saveVersion)
          : (appResourcesService.createVersion ?? appResourcesService.saveVersion);
      if (!operation) throw new Error("Version editing is unavailable in this Relay connection.");
      return operation(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-resources", "versions"] });
      setEditor(undefined);
    },
  });
  const canWriteVersions = Boolean(
    appResourcesService.createVersion ?? appResourcesService.saveVersion,
  );

  return (
    <AppResourceFrame
      title="Versions"
      description="Builds Relay can run against."
      action={
        canWriteVersions ? (
          <Button variant="default" onClick={() => setEditor("create")}>
            <Plus aria-hidden="true" /> Add version
          </Button>
        ) : undefined
      }
    >
      {loading ? <PageLoading label="Loading registered versions…" /> : null}
      {error ? (
        <ResourceRecovery
          detail="Start Relay, then try loading registered versions again."
          retrying={versions.isFetching}
          onRetry={() => {
            void versions.refetch();
          }}
        />
      ) : null}
      {!loading && !error ? (
        <section aria-label="Versions">
          {versions.data?.length ? (
            <ul className="list-none overflow-hidden rounded-lg border border-border bg-card p-0">
              {versions.data.map((version) => (
                <VersionRow
                  key={version.id}
                  version={version}
                  canEdit={Boolean(
                    appResourcesService.updateVersion ?? appResourcesService.saveVersion,
                  )}
                  onEdit={() => setEditor(version)}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Box}
              title="No registered versions"
              detail="No mobile build or web deployment has been registered in this workspace yet."
              action={
                <Link
                  className="{productLinkClassName}"
                  to="/tests"
                >
                  Open Tests
                </Link>
              }
            />
          )}
        </section>
      ) : null}
      {editor ? (
        <VersionEditorDialog
          value={editor === "create" ? undefined : editor}
          pending={saveVersion.isPending}
          error={saveVersion.error}
          onClose={() => {
            if (!saveVersion.isPending) {
              saveVersion.reset();
              setEditor(undefined);
            }
          }}
          onSubmit={(input) =>
            saveVersion.mutate({ mode: editor === "create" ? "create" : "edit", input })
          }
        />
      ) : null}
    </AppResourceFrame>
  );
}

export function AppAccountsPage() {
  const { appResourcesService } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const [accountDialog, setAccountDialog] = useState<"save" | ProductBrowserAccount>();
  const [revokeAccount, setRevokeAccount] = useState<ProductBrowserAccount>();
  const [showRevoked, setShowRevoked] = useState(false);
  const accounts = useQuery({
    queryKey: ["app-resources", "browser-accounts"],
    queryFn: () => appResourcesService.listBrowserAccounts(),
    staleTime: 10_000,
  });
  const browsers = useQuery({
    queryKey: ["app-resources", "browser-targets"],
    queryFn: () => appResourcesService.listBrowserTargets?.() ?? Promise.resolve([]),
    staleTime: 10_000,
  });
  const lanes = useQuery({
    queryKey: ["app-resources", "account-lanes"],
    queryFn: () => appResourcesService.listAccountLanes?.() ?? Promise.resolve([]),
    staleTime: 15_000,
  });
  const error = accounts.error ?? browsers.error;
  const loading = accounts.isPending || browsers.isPending;
  const targets = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const account of accounts.data ?? []) seen.set(account.target.id, account.target);
    for (const target of browsers.data ?? []) seen.set(target.id, target);
    return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [accounts.data, browsers.data]);
  const saveAccount = useMutation({
    mutationFn: async (input: AccountDraft) => {
      if (!appResourcesService.saveBrowserAccount) {
        throw new Error("Saving browser sign-ins is unavailable in this Relay connection.");
      }
      return appResourcesService.saveBrowserAccount(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-resources", "browser-accounts"] });
      setAccountDialog(undefined);
    },
  });
  const refreshAccount = useMutation({
    mutationFn: async (input: AccountRefreshInput) => {
      if (!appResourcesService.refreshBrowserAccount) {
        throw new Error("Refreshing browser sign-ins is unavailable in this Relay connection.");
      }
      return appResourcesService.refreshBrowserAccount(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-resources", "browser-accounts"] });
      setAccountDialog(undefined);
    },
  });
  const revoke = useMutation({
    mutationFn: async (input: { targetId: string; reference: string }) => {
      if (!appResourcesService.revokeBrowserAccount) {
        throw new Error("Revoking browser sign-ins is unavailable in this Relay connection.");
      }
      return appResourcesService.revokeBrowserAccount(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-resources", "browser-accounts"] });
      setRevokeAccount(undefined);
    },
  });
  const probeAccount = useMutation({
    mutationFn: async (input: { targetId: string; reference: string }) => {
      if (!appResourcesService.probeBrowserAccount) {
        throw new Error("Checking this sign-in is unavailable in this Relay connection.");
      }
      return appResourcesService.probeBrowserAccount(input);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-resources", "browser-accounts"] });
    },
  });
  const signInNow = useMutation({
    mutationFn: async (input: { targetId: string; reference?: string }) => {
      if (!appResourcesService.openBrowserAccountForSignIn) {
        throw new Error("Opening this sign-in is unavailable in this Relay connection.");
      }
      return appResourcesService.openBrowserAccountForSignIn(input);
    },
  });
  const checkAll = useMutation({
    mutationFn: async () => {
      if (!appResourcesService.probeBrowserAccountHealth) {
        throw new Error("Checking sign-ins is unavailable in this Relay connection.");
      }
      const targetIds = [
        ...new Set(liveSignIns(accounts.data ?? []).map((account) => account.target.id)),
      ];
      for (const targetId of targetIds) {
        await appResourcesService.probeBrowserAccountHealth({ targetId });
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["app-resources", "browser-accounts"] });
    },
  });
  const firstBrowser = targets[0];
  const canSaveAccount = Boolean(appResourcesService.saveBrowserAccount) && targets.length > 0;
  const actionError = probeAccount.error ?? signInNow.error ?? checkAll.error;
  const listed = accounts.data ?? [];
  const live = liveSignIns(listed);
  const revoked = revokedSignIns(listed);
  const visible = showRevoked ? listed : live;
  const stateCounts = {
    ready: listed.filter((item) => accountHealthState(item.fixture) === "ready").length,
    needsRelogin: listed.filter((item) => accountHealthState(item.fixture) === "needs-relogin")
      .length,
    expired: listed.filter((item) => accountHealthState(item.fixture) === "expired").length,
    revoked: revoked.length,
  };

  return (
    <AppResourceFrame
      title="Sign-ins"
      description="Saved browser sign-ins for daily Plans. Check health before a run; expired or signed-out accounts fail closed."
      action={
        <span className="inline-flex items-center justify-end gap-1.5 max-[780px]:flex-wrap max-[780px]:justify-start">
          {appResourcesService.probeBrowserAccountHealth && live.length ? (
            <Button
              variant="outline"
              onClick={() => checkAll.mutate()}
              disabled={checkAll.isPending}
            >
              {checkAll.isPending ? "Checking…" : "Check live health"}
            </Button>
          ) : null}
          <Button
            variant="default"
            onClick={() => setAccountDialog("save")}
            disabled={!canSaveAccount}
            title={
              !appResourcesService.saveBrowserAccount
                ? "Saving sign-ins is unavailable in this Relay connection."
                : targets.length === 0
                  ? "Start a browser first, then save its sign-in."
                  : undefined
            }
          >
            <Plus aria-hidden="true" /> Save sign-in
          </Button>
          {!canSaveAccount ? (
            <Button nativeButton={false} render={<Link to="/environments" />} variant="outline">
              New browser
            </Button>
          ) : null}
        </span>
      }
    >
      {loading ? <PageLoading label="Loading browser sign-ins…" /> : null}
      {error ? (
        <ResourceRecovery
          detail="Start Relay, then try loading saved browser sign-ins again."
          retrying={accounts.isFetching || browsers.isFetching}
          onRetry={() => {
            void accounts.refetch();
            void browsers.refetch();
          }}
        />
      ) : null}
      {!loading && !error ? (
        <section aria-label="Sign-ins">
          {actionError ? (
            <p className="mb-3 text-sm text-destructive" role="alert">
              {actionError instanceof Error ? actionError.message : "Could not check this sign-in."}
            </p>
          ) : null}
          {signInNow.isSuccess ? (
            <p className="mb-3 text-sm text-muted-foreground">
              Complete OAuth in the browser, then{" "}
              {listed.length ? "Refresh this sign-in" : "Save sign-in"}.
            </p>
          ) : null}
          {listed.length ? (
            <>
              <p className="mb-3 text-sm text-muted-foreground">
                {stateCounts.ready} ready · {stateCounts.needsRelogin} need sign-in ·{" "}
                {stateCounts.expired} expired · {stateCounts.revoked} revoked. Check health before
                the daily Plan.
              </p>
              <p className="mb-3 text-sm text-muted-foreground">
                {concurrentAccountCopy(readySignIns(listed).length)}
              </p>
              {revoked.length ? (
                <p className="mb-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowRevoked((current) => !current)}
                  >
                    {showRevoked ? "Hide revoked" : `Show ${revoked.length} revoked`}
                  </Button>
                </p>
              ) : null}
              <ul className="list-none overflow-hidden rounded-lg border border-border bg-card p-0">
                {visible.map((account) => (
                  <AccountRow
                    key={account.fixture.reference}
                    account={account}
                    lanes={lanes.data ?? []}
                    canRefresh={Boolean(appResourcesService.refreshBrowserAccount)}
                    canRevoke={Boolean(appResourcesService.revokeBrowserAccount)}
                    canProbe={Boolean(appResourcesService.probeBrowserAccount)}
                    canSignIn={Boolean(appResourcesService.openBrowserAccountForSignIn)}
                    probing={
                      probeAccount.isPending &&
                      probeAccount.variables?.reference === account.fixture.reference
                    }
                    opening={
                      signInNow.isPending &&
                      signInNow.variables?.reference === account.fixture.reference
                    }
                    onRefresh={() => setAccountDialog(account)}
                    onRevoke={() => setRevokeAccount(account)}
                    onProbe={() =>
                      probeAccount.mutate({
                        targetId: account.target.id,
                        reference: account.fixture.reference,
                      })
                    }
                    onSignIn={() =>
                      signInNow.mutate({
                        targetId: account.target.id,
                        reference: account.fixture.reference,
                      })
                    }
                  />
                ))}
              </ul>
            </>
          ) : (
            <EmptyState
              icon={KeyRound}
              title="No saved sign-ins"
              detail="Open a headed browser, complete OAuth, then save it here. Daily Plans with missing or expired sign-ins fail closed as Infra."
              action={
                firstBrowser && appResourcesService.openBrowserAccountForSignIn ? (
                  <Button
                    onClick={() => signInNow.mutate({ targetId: firstBrowser.id })}
                    disabled={signInNow.isPending}
                  >
                    {signInNow.isPending ? "Opening…" : "Open headed browser"}
                  </Button>
                ) : (
                  <Link
                    className="{productLinkClassName}"
                    to="/environments"
                  >
                    Open browsers
                  </Link>
                )
              }
            />
          )}
        </section>
      ) : null}
      {accountDialog ? (
        <BrowserAccountDialog
          account={accountDialog === "save" ? undefined : accountDialog}
          targets={targets}
          pending={accountDialog === "save" ? saveAccount.isPending : refreshAccount.isPending}
          error={accountDialog === "save" ? saveAccount.error : refreshAccount.error}
          onClose={() => {
            if (!saveAccount.isPending && !refreshAccount.isPending) {
              saveAccount.reset();
              refreshAccount.reset();
              setAccountDialog(undefined);
            }
          }}
          onSave={(input) => saveAccount.mutate(input)}
          onRefresh={(input) => refreshAccount.mutate(input)}
        />
      ) : null}
      {revokeAccount ? (
        <RevokeAccountDialog
          account={revokeAccount}
          pending={revoke.isPending}
          error={revoke.error}
          onClose={() => {
            if (!revoke.isPending) {
              revoke.reset();
              setRevokeAccount(undefined);
            }
          }}
          onConfirm={() =>
            revoke.mutate({
              targetId: revokeAccount.target.id,
              reference: revokeAccount.fixture.reference,
            })
          }
        />
      ) : null}
    </AppResourceFrame>
  );
}

function AppResourceFrame({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <LibraryPage className="max-w-[1040px]">
      <PageHeader context="Workspace" title={title} description={description} actions={action} />
      {children}
    </LibraryPage>
  );
}

function ResourceRecovery({
  detail,
  retrying,
  onRetry,
}: {
  detail: string;
  retrying: boolean;
  onRetry(): void;
}) {
  return (
    <RecoveryState
      className="relay-apps-recovery"
      layout="centered"
      title="Could not load resources"
      detail={detail}
      action={
        <Button variant="outline" onClick={onRetry} disabled={retrying}>
          <RotateCcw aria-hidden="true" />
          {retrying ? "Trying again…" : "Try again"}
        </Button>
      }
    />
  );
}

function AccountRow({
  account,
  lanes,
  canRefresh,
  canRevoke,
  canProbe,
  canSignIn,
  probing,
  opening,
  onRefresh,
  onRevoke,
  onProbe,
  onSignIn,
}: {
  account: ProductBrowserAccount;
  lanes: readonly ProductAccountLane[];
  canRefresh: boolean;
  canRevoke: boolean;
  canProbe: boolean;
  canSignIn: boolean;
  probing: boolean;
  opening: boolean;
  onRefresh(): void;
  onRevoke(): void;
  onProbe(): void;
  onSignIn(): void;
}) {
  const state = accountHealthState(account.fixture);
  const identity = probedAccountIdentity(account.fixture);
  const bound = lanesForAccount(account, lanes);
  const checkedAt = healthCheckedAt(account.fixture);
  const showActions = canProbe || canSignIn || canRefresh || (canRevoke && state !== "revoked");
  return (
    <li className="grid min-h-[66px] grid-cols-[36px_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-[11px] sm:grid-cols-[36px_minmax(0,1fr)_auto_auto]">
      <span
        className="grid size-9 place-items-center rounded-md border border-border bg-background text-foreground"
        aria-hidden="true"
      >
        <KeyRound />
      </span>
      <span className="grid min-w-0 gap-1">
        <strong>
          {identity ?? (state === "needs-relogin" ? "Needs relogin" : account.fixture.name)}
        </strong>
        <small>
          {identity ? `Saved as ${account.fixture.name}` : account.fixture.name}
          {" · "}
          <Link
            to="/devices/$deviceId"
            params={{ deviceId: account.target.id }}
            className="relay-inline-link"
          >
            {account.target.name}
          </Link>
          {account.fixture.origins.length
            ? ` · ${account.fixture.origins.slice(0, 2).join(", ")}`
            : ""}
          {bound.length ? ` · Lane ${bound.map((lane) => lane.id).join(", ")}` : ""}
        </small>
      </span>
      <span
        className={`inline-flex min-h-6 items-center rounded-full bg-background px-2.5 text-[11px] font-semibold capitalize ${
          state === "ready" ? "text-muted-foreground" : "text-destructive"
        }`}
      >
        {signInStatusLabel(state)}
      </span>
      <time
        className="hidden text-sm text-muted-foreground sm:block"
        dateTime={new Date(checkedAt ?? account.fixture.createdAt).toISOString()}
      >
        {checkedAt
          ? `Checked ${shortDate(checkedAt)}`
          : `Saved ${shortDate(account.fixture.createdAt)}`}
      </time>
      {showActions ? (
        <span className="col-span-full flex flex-wrap justify-end gap-1 sm:col-start-2">
          {canProbe ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onProbe}
              disabled={probing}
              aria-label={`Check health of ${account.fixture.name}`}
            >
              {probing ? "Checking…" : "Check health"}
            </Button>
          ) : null}
          {canSignIn && state !== "revoked" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onSignIn}
              disabled={opening}
              aria-label={`Sign in now for ${account.fixture.name}`}
            >
              {opening ? "Opening…" : "Sign in now"}
            </Button>
          ) : null}
          {canRefresh ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRefresh}
              aria-label={`Refresh ${account.fixture.name}`}
            >
              Refresh
            </Button>
          ) : null}
          {canRevoke && state !== "revoked" ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onRevoke}
              aria-label={`Revoke ${account.fixture.name}`}
            >
              Revoke
            </Button>
          ) : null}
        </span>
      ) : null}
    </li>
  );
}

function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}
