/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { Box, KeyRound, Plus, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Breadcrumbs, EmptyState, RecoveryState } from "../components/product-patterns";
import type {
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
      description="Review registered builds and deployments before choosing what Relay should verify."
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
        <section className="mt-[30px]" aria-labelledby="registered-versions-title">
          <ResourceHeading
            id="registered-versions-title"
            label="Workspace registry"
            title="Registered versions"
            detail="Builds are workspace-scoped and available when configuring verification."
          />
          {versions.data?.length ? (
            <ul className="mt-[18px] list-none overflow-hidden rounded-lg border border-border bg-card p-0">
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
                  className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
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
  const canSaveAccount = Boolean(appResourcesService.saveBrowserAccount) && targets.length > 0;

  return (
    <AppResourceFrame
      title="Accounts"
      description="Review saved browser sign-ins attached to managed browsers in this workspace."
      action={
        <span className="inline-flex items-center justify-end gap-1.5 max-[780px]:flex-wrap max-[780px]:justify-start">
          <Button
            variant="default"
            onClick={() => setAccountDialog("save")}
            disabled={!canSaveAccount}
            title={
              !appResourcesService.saveBrowserAccount
                ? "Saving browser sign-ins is unavailable in this Relay connection."
                : targets.length === 0
                  ? "Open Devices and create a managed browser before saving a sign-in."
                  : undefined
            }
          >
            <Plus aria-hidden="true" /> Save account
          </Button>
          <Button nativeButton={false} render={<Link to="/devices" />} variant="outline">
            Open Devices
          </Button>
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
        <section className="mt-[30px]" aria-labelledby="browser-signins-title">
          <ResourceHeading
            id="browser-signins-title"
            label="Managed browsers"
            title="Saved browser sign-ins"
            detail="Sign-ins belong to an exact managed browser, not directly to an App."
          />
          {accounts.data?.length ? (
            <ul className="mt-[18px] list-none overflow-hidden rounded-lg border border-border bg-card p-0">
              {accounts.data.map((account) => (
                <AccountRow
                  key={account.fixture.reference}
                  account={account}
                  canRefresh={Boolean(appResourcesService.refreshBrowserAccount)}
                  canRevoke={Boolean(appResourcesService.revokeBrowserAccount)}
                  onRefresh={() => setAccountDialog(account)}
                  onRevoke={() => setRevokeAccount(account)}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={KeyRound}
              title="No saved browser sign-ins"
              detail="Open a managed browser from Devices, sign in, and save its reviewed state when you need an authenticated Test."
              action={
                <Link
                  className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                  to="/devices"
                >
                  Open Devices
                </Link>
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
    <section className="relay-page mx-auto w-full px-[clamp(20px,3vw,40px)] pt-7 pb-10 max-w-[1040px]">
      <Breadcrumbs items={[{ label: "Workspace", to: "/home" }, { label: title }]} />
      <header className="relay-page-header flex items-start justify-between gap-7 max-[780px]:flex-col">
        <div>
          <p className="relay-eyebrow mb-2 text-[11px] font-semibold tracking-[0.02em] text-[var(--text-weak)]">
            Workspace
          </p>
          <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
            {title}
          </h1>
          <p className="relay-page-description mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-[var(--text-weak)]">
            {description}
          </p>
        </div>
        {action}
      </header>
      {children}
    </section>
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

function ResourceHeading({
  id,
  label,
  title,
  detail,
}: {
  id: string;
  label: string;
  title: string;
  detail: string;
}) {
  return (
    <header className="max-w-[720px]">
      <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
        {label}
      </p>
      <h2 id={id}>{title}</h2>
      <p>{detail}</p>
    </header>
  );
}

function AccountRow({
  account,
  canRefresh,
  canRevoke,
  onRefresh,
  onRevoke,
}: {
  account: ProductBrowserAccount;
  canRefresh: boolean;
  canRevoke: boolean;
  onRefresh(): void;
  onRevoke(): void;
}) {
  const state = accountState(account.fixture);
  return (
    <li className="grid min-h-[66px] grid-cols-[36px_minmax(0,1fr)_auto_minmax(110px,auto)] items-center gap-3 px-3.5 py-[11px] max-[780px]:grid-cols-[36px_minmax(0,1fr)_auto]">
      <span
        className="grid size-9 place-items-center rounded-md border border-border bg-background text-foreground"
        aria-hidden="true"
      >
        <KeyRound />
      </span>
      <span className="grid min-w-0 gap-1">
        <strong>{account.fixture.name}</strong>
        <small>
          {account.target.name}
          {account.fixture.origins.length
            ? ` · ${account.fixture.origins.slice(0, 2).join(", ")}`
            : ""}
        </small>
      </span>
      <span
        className={`inline-flex min-h-6 items-center rounded-full bg-background px-2.5 text-[11px] font-semibold capitalize text-muted-foreground`}
      >
        {statusLabel(state)}
      </span>
      <time dateTime={new Date(account.fixture.createdAt).toISOString()}>
        Saved {shortDate(account.fixture.createdAt)}
      </time>
      {canRefresh || (canRevoke && state !== "revoked") ? (
        <span className="grid min-h-[66px] grid-cols-[36px_minmax(0,1fr)_auto_minmax(110px,auto)] items-center gap-3 px-3.5 py-[11px] max-[780px]:col-start-2 max-[780px]:col-end-[-1]">
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

function accountState(fixture: ProductBrowserAccount["fixture"]): "ready" | "revoked" | "expired" {
  if (fixture.revokedAt !== undefined) return "revoked";
  if (fixture.expiresAt !== undefined && fixture.expiresAt <= Date.now()) return "expired";
  return "ready";
}

function statusLabel(status: string): string {
  return status.replace(/-/gu, " ").replace(/^./u, (letter) => letter.toLocaleUpperCase());
}

function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}
