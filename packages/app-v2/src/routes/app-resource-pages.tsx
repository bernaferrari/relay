/** @jsxImportSource react */
import { Button } from "@relay/ui-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
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

const versionsRoute = getRouteApi("/apps/$appId/versions");
const accountsRoute = getRouteApi("/apps/$appId/accounts");

export function AppVersionsPage() {
  const { appId } = versionsRoute.useParams();
  const { mapService, appResourcesService } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const [editor, setEditor] = useState<ProductAppVersion | "create">();
  const app = useQuery({
    queryKey: ["app", appId],
    queryFn: () => mapService.get(appId),
    staleTime: 15_000,
  });
  const versions = useQuery({
    queryKey: ["app-resources", "versions"],
    queryFn: () => appResourcesService.listVersions(),
    staleTime: 15_000,
  });
  const error = app.error ?? versions.error;
  const loading = app.isPending || versions.isPending;
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
      appId={appId}
      appName={app.data?.appName}
      title="Versions"
      description="Review registered builds and deployments before choosing what Relay should verify."
      action={
        canWriteVersions ? (
          <Button variant="primary" onClick={() => setEditor("create")}>
            <Plus aria-hidden="true" /> Add version
          </Button>
        ) : undefined
      }
    >
      {loading ? <PageLoading label="Loading registered versions…" /> : null}
      {error ? (
        <ResourceRecovery
          detail="Start Relay, then try loading registered versions again."
          retrying={app.isFetching || versions.isFetching}
          onRetry={() => {
            void app.refetch();
            void versions.refetch();
          }}
        />
      ) : null}
      {!loading && !error ? (
        <section className="relay-app-resource-section" aria-labelledby="registered-versions-title">
          <ResourceHeading
            id="registered-versions-title"
            label="Workspace registry"
            title="Registered versions"
            detail={`Builds are project-scoped. Relay shows the versions available when configuring verification for ${app.data?.appName ?? "this app"} without implying an App link the registry does not store.`}
          />
          {versions.data?.length ? (
            <ul className="relay-resource-list">
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
                <Link className="relay-inline-link" to="/apps/$appId" params={{ appId }}>
                  Back to app
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
  const { appId } = accountsRoute.useParams();
  const { mapService, appResourcesService } = useRouteContext({ from: "__root__" });
  const queryClient = useQueryClient();
  const [accountDialog, setAccountDialog] = useState<"save" | ProductBrowserAccount>();
  const [revokeAccount, setRevokeAccount] = useState<ProductBrowserAccount>();
  const app = useQuery({
    queryKey: ["app", appId],
    queryFn: () => mapService.get(appId),
    staleTime: 15_000,
  });
  const accounts = useQuery({
    queryKey: ["app-resources", "browser-accounts"],
    queryFn: () => appResourcesService.listBrowserAccounts(),
    staleTime: 10_000,
  });
  const error = app.error ?? accounts.error;
  const loading = app.isPending || accounts.isPending;
  const targets = useMemo(() => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const account of accounts.data ?? []) seen.set(account.target.id, account.target);
    return [...seen.values()].sort((left, right) => left.name.localeCompare(right.name));
  }, [accounts.data]);
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
      appId={appId}
      appName={app.data?.appName}
      title="Accounts"
      description="Review saved browser sign-ins that can be reused while testing this app."
      action={
        <span className="relay-resource-header-actions">
          <Button
            variant="primary"
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
          <Button render={<Link to="/devices" />} variant="secondary">
            Open Devices
          </Button>
        </span>
      }
    >
      {loading ? <PageLoading label="Loading browser sign-ins…" /> : null}
      {error ? (
        <ResourceRecovery
          detail="Start Relay, then try loading saved browser sign-ins again."
          retrying={app.isFetching || accounts.isFetching}
          onRetry={() => {
            void app.refetch();
            void accounts.refetch();
          }}
        />
      ) : null}
      {!loading && !error ? (
        <section className="relay-app-resource-section" aria-labelledby="browser-signins-title">
          <ResourceHeading
            id="browser-signins-title"
            label="Managed browsers"
            title="Saved browser sign-ins"
            detail={`Sign-ins belong to an exact managed browser, not directly to an App. These are the reviewed sign-ins available while testing ${app.data?.appName ?? "this app"}.`}
          />
          {accounts.data?.length ? (
            <ul className="relay-resource-list">
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
                <Link className="relay-inline-link" to="/devices">
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
  appId,
  appName,
  title,
  description,
  action,
  children,
}: {
  appId: string;
  appName?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="relay-page relay-app-resource-page">
      <Breadcrumbs
        items={[
          { label: "Apps", to: "/apps" },
          { label: appName ?? "App details", to: "/apps/$appId", params: { appId } },
          { label: title },
        ]}
      />
      <header className="relay-page-header relay-app-resource-header">
        <div>
          <p className="relay-eyebrow">{appName ?? "App"}</p>
          <h1>{title}</h1>
          <p className="relay-page-description">{description}</p>
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
      title="Relay is not connected"
      detail={detail}
      action={
        <Button variant="secondary" onClick={onRetry} disabled={retrying}>
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
    <header className="relay-app-resource-heading">
      <p className="relay-section-label">{label}</p>
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
    <li className="relay-resource-row relay-resource-row--account">
      <span className="relay-resource-icon" aria-hidden="true">
        <KeyRound />
      </span>
      <span className="relay-resource-copy">
        <strong>{account.fixture.name}</strong>
        <small>
          {account.target.name}
          {account.fixture.origins.length
            ? ` · ${account.fixture.origins.slice(0, 2).join(", ")}`
            : ""}
        </small>
      </span>
      <span className={`relay-resource-status relay-resource-status--${state}`}>
        {statusLabel(state)}
      </span>
      <time dateTime={new Date(account.fixture.createdAt).toISOString()}>
        Saved {shortDate(account.fixture.createdAt)}
      </time>
      {canRefresh || (canRevoke && state !== "revoked") ? (
        <span className="relay-resource-row-actions">
          {canRefresh ? (
            <Button
              size="small"
              variant="ghost"
              onClick={onRefresh}
              aria-label={`Refresh ${account.fixture.name}`}
            >
              Refresh
            </Button>
          ) : null}
          {canRevoke && state !== "revoked" ? (
            <Button
              size="small"
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
