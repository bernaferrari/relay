/** @jsxImportSource react */
import type { SensitiveEvidenceChannel } from "@relay/protocol";
import { Badge } from "@relay/ui-react/components/badge";
import { Field, FieldDescription, FieldLabel } from "@relay/ui-react/components/field";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@relay/ui-react/components/item";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { settingsQueryKeys, type SettingsCategory } from "../data/settings-product-service";
import { AppearanceSettings } from "./appearance-settings";
import { PageLoading } from "./recording-shared";
import { SettingRow, SettingsFrame, ToggleRow, type SaveState } from "./settings-frame";
import { AboutSettings } from "./settings-about";
import {
  CHANNELS,
  CONNECTION_QUERY_KEY,
  SetupRow,
  errorMessage,
  setupChecks,
} from "./settings-support";

function GeneralSettings() {
  const { platform } = useRouteContext({ from: "__root__" });
  const connection = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () =>
      platform.getServerConnection
        ? platform.getServerConnection()
        : Promise.resolve(platform.getServerUrl()).then((url) => ({ url })),
  });
  const hostname = useMemo(() => {
    try {
      return connection.data ? new URL(connection.data.url).host : undefined;
    } catch {
      return connection.data?.url;
    }
  }, [connection.data]);
  const notification = useMutation({
    mutationFn: async () =>
      platform.notify?.("Relay notifications are ready", "Important Run updates can appear here."),
  });

  return (
    <SettingsFrame category="general" saveState={connection.isError ? "unavailable" : undefined}>
      <section
        className="grid gap-3 rounded-xl border border-border bg-card p-5"
        aria-labelledby="general-behavior-title"
      >
        <header>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Workspace behavior
          </p>
          <h2 id="general-behavior-title">Your workspace</h2>
        </header>
        <SettingRow
          title="Active work"
          description="Relay restores a Recording or Run from its last durable state when you return."
        >
          <span className="whitespace-nowrap text-xs font-semibold text-foreground">Automatic</span>
        </SettingRow>
        <SettingRow
          title="Workspace connection"
          description={
            hostname
              ? `Relay is configured to use ${hostname}.`
              : "Checking the current Relay workspace."
          }
        >
          <Badge
            variant="secondary"
            className={
              connection.isError ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : undefined
            }
          >
            {connection.isPending ? "Checking" : connection.isError ? "Unavailable" : "Configured"}
          </Badge>
          <Link
            className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
            to="/settings/advanced"
            search={{ section: "connection" }}
          >
            Change address
          </Link>
        </SettingRow>
        <SettingRow
          title="Desktop notifications"
          description={
            platform.notify
              ? "Relay can use native notifications when work finishes or needs your attention."
              : "Native notifications are available in the Relay desktop app."
          }
        >
          {platform.notify ? (
            <Button
              size="sm"
              variant="outline"
              disabled={notification.isPending}
              onClick={() => notification.mutate()}
            >
              {notification.isPending ? "Sending…" : "Send a test"}
            </Button>
          ) : (
            <span className="whitespace-nowrap text-xs font-semibold text-foreground">
              Web only
            </span>
          )}
        </SettingRow>
      </section>
      {notification.error ? (
        <p role="alert">Could not send the notification. {errorMessage(notification.error)}</p>
      ) : notification.isSuccess ? (
        <p role="status">Test notification sent.</p>
      ) : null}
      {connection.error ? (
        <Alert variant="destructive">
          <AlertTitle>Could not read the workspace address</AlertTitle>
          <AlertDescription>{errorMessage(connection.error)}</AlertDescription>
          <AlertAction>
            <Button variant="outline" onClick={() => void connection.refetch()}>
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
    </SettingsFrame>
  );
}

function EvidenceSettings() {
  const { settingsService, queryClient } = useRouteContext({ from: "__root__" });
  const privacy = useQuery({
    queryKey: settingsQueryKeys.privacy,
    queryFn: () => settingsService.privacy(),
  });
  const evidence = useQuery({
    queryKey: settingsQueryKeys.evidence,
    queryFn: () => settingsService.evidence(),
  });
  const privacyMutation = useMutation({
    mutationFn: (enabled: boolean) => settingsService.setPrivacy(enabled),
    onSuccess: (policy) => queryClient.setQueryData(settingsQueryKeys.privacy, policy),
  });
  const evidenceMutation = useMutation({
    mutationFn: (input: { channel: SensitiveEvidenceChannel; enabled: boolean }) =>
      settingsService.setEvidence({
        ...input,
        ...(input.enabled ? { reason: "Enabled in Relay Evidence & privacy settings" } : {}),
      }),
    onSuccess: (policy) => queryClient.setQueryData(settingsQueryKeys.evidence, policy),
  });
  const saveState: SaveState | undefined =
    privacy.isError || evidence.isError
      ? "unavailable"
      : privacyMutation.isPending || evidenceMutation.isPending
        ? "saving"
        : privacyMutation.isError || evidenceMutation.isError
          ? "failed"
          : privacyMutation.isSuccess || evidenceMutation.isSuccess
            ? "saved"
            : undefined;
  const error = privacy.error ?? evidence.error ?? privacyMutation.error ?? evidenceMutation.error;

  return (
    <SettingsFrame category="evidence" saveState={saveState}>
      {privacy.isPending || evidence.isPending ? (
        <PageLoading label="Loading evidence and privacy settings…" />
      ) : null}
      {error ? (
        <Alert
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
          variant="destructive"
          role="alert"
        >
          <AlertTitle>Relay could not load or save this setting</AlertTitle>
          <AlertDescription>{errorMessage(error)}</AlertDescription>
          <AlertAction>
            <Button
              size="sm"
              onClick={() => {
                privacyMutation.reset();
                evidenceMutation.reset();
                void privacy.refetch();
                void evidence.refetch();
              }}
            >
              Try again
            </Button>
          </AlertAction>
        </Alert>
      ) : null}
      {privacy.data && evidence.data ? (
        <>
          <section
            className="grid gap-3 rounded-xl border border-border bg-card p-5"
            id="privacy"
            aria-labelledby="privacy-title"
          >
            <header>
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Privacy
              </p>
              <h2 id="privacy-title">Protect evidence before it is saved</h2>
              <p>Changes apply to future collection. Finished Reports stay unchanged.</p>
            </header>
            <ToggleRow
              id="redact-sensitive-evidence"
              title="Redact sensitive evidence"
              description="Masks credentials, cookies, typed secrets, clipboard contents, and URL query values."
              checked={privacy.data.enabled}
              disabled={privacy.data.locked || privacyMutation.isPending}
              onChange={(enabled) => privacyMutation.mutate(enabled)}
            />
            <SettingRow
              title="Stored evidence"
              description={
                privacy.data.locked
                  ? "This policy is controlled outside Relay for this workspace."
                  : privacy.data.source === "workspace"
                    ? "This policy is saved for the current workspace."
                    : "Relay is using its default policy until you change it."
              }
            >
              <span className="whitespace-nowrap text-xs font-semibold text-foreground">
                {privacy.data.enabled ? "Sensitive values redacted" : "Raw values allowed"}
              </span>
            </SettingRow>
          </section>

          <section
            className="grid gap-3 rounded-xl border border-border bg-card p-5"
            id="sensitive"
            aria-labelledby="sensitive-title"
          >
            <header>
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Optional collection
              </p>
              <h2 id="sensitive-title">Sensitive evidence</h2>
              <p>Each source stays off until a person explicitly enables it.</p>
            </header>
            {CHANNELS.map((channel) => (
              <ToggleRow
                key={channel.id}
                id={`evidence-${channel.id}`}
                title={channel.label}
                description={channel.description}
                checked={Boolean(evidence.data.sensitive[channel.id])}
                disabled={evidenceMutation.isPending}
                onChange={(enabled) => evidenceMutation.mutate({ channel: channel.id, enabled })}
              />
            ))}
          </section>
        </>
      ) : null}
    </SettingsFrame>
  );
}

function IntegrationsSettings() {
  const { platform, settingsService } = useRouteContext({ from: "__root__" });
  const integrations = useQuery({
    queryKey: ["settings", "integrations"],
    queryFn: () => settingsService.integrations!.list(),
    enabled: Boolean(settingsService.integrations),
    staleTime: 10_000,
  });
  const connection = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () =>
      platform.getServerConnection
        ? platform.getServerConnection()
        : Promise.resolve(platform.getServerUrl()).then((url) => ({ url })),
  });
  let serverName = "Relay server";
  try {
    if (connection.data) serverName = new URL(connection.data.url).host;
  } catch {
    serverName = "Relay server";
  }

  return (
    <SettingsFrame
      category="integrations"
      saveState={connection.isError ? "unavailable" : undefined}
    >
      <section
        className="grid gap-3 rounded-xl border border-border bg-card p-5"
        aria-labelledby="integration-title"
      >
        <header>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Current workspace
          </p>
          <h2 id="integration-title">Connected services</h2>
          <p>Relay works locally without requiring an external account.</p>
        </header>
        {connection.isPending || (settingsService.integrations && integrations.isPending) ? (
          <PageLoading label="Checking workspace integrations…" />
        ) : null}
        {connection.isError || (settingsService.integrations && integrations.error) ? (
          <Alert
            className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            variant="destructive"
            role="alert"
          >
            <AlertTitle>Could not load connected services</AlertTitle>
            <AlertDescription>
              {errorMessage(integrations.error ?? connection.error)}
            </AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                onClick={() => {
                  void connection.refetch();
                  void integrations.refetch();
                }}
              >
                Try again
              </Button>
            </AlertAction>
          </Alert>
        ) : integrations.data ? (
          <div className="mt-4 grid gap-2.5">
            {integrations.data.map((integration) => (
              <Item
                className="mt-0 min-h-[84px] grid-cols-[36px_minmax(0,1fr)_auto] gap-3 rounded-xl bg-card p-3.5 shadow-sm"
                variant="outline"
                key={integration.provider}
              >
                <ItemMedia
                  className="grid size-9 place-items-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground"
                  aria-hidden="true"
                >
                  {integration.name.slice(0, 1).toLocaleUpperCase()}
                </ItemMedia>
                <ItemContent>
                  <ItemTitle>{integration.name}</ItemTitle>
                  <ItemDescription>{integration.detail}</ItemDescription>
                  {integration.capabilities.length ? (
                    <span className="mt-1 block text-[10px] capitalize text-muted-foreground">
                      {integration.capabilities
                        .map((capability) => capability.replace(/-/gu, " "))
                        .join(" · ")}
                    </span>
                  ) : null}
                </ItemContent>
                <ItemActions>
                  <Badge
                    variant={integration.state === "unsupported" ? "outline" : "secondary"}
                    className={
                      integration.state === "connected"
                        ? "bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
                        : integration.state === "unsupported"
                          ? undefined
                          : "bg-amber-500/15 text-amber-800 dark:text-amber-300"
                    }
                  >
                    {integration.state
                      .replace(/-/gu, " ")
                      .replace(/^./u, (letter) => letter.toLocaleUpperCase())}
                  </Badge>
                </ItemActions>
              </Item>
            ))}
          </div>
        ) : connection.data ? (
          <Item
            className="mt-0 min-h-[84px] grid-cols-[36px_minmax(0,1fr)_auto] gap-3 rounded-xl bg-card p-3.5 shadow-sm"
            variant="outline"
          >
            <ItemMedia
              className="grid size-9 place-items-center rounded-lg bg-primary text-[13px] font-bold text-primary-foreground"
              aria-hidden="true"
            >
              R
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Relay workspace</ItemTitle>
              <ItemDescription>Workspace address: {serverName}.</ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge
                variant="default"
                className="bg-emerald-500/15 text-emerald-800 dark:text-emerald-300"
              >
                Configured
              </Badge>
            </ItemActions>
          </Item>
        ) : null}
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          <h3>Managed by your workspace</h3>
          <p>
            Your workspace administrator manages service credentials on the Relay server. You can
            run Tests without connecting an external service.
          </p>
          <Link
            className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
            to="/changes"
          >
            View Changes
          </Link>
        </div>
      </section>
    </SettingsFrame>
  );
}

function AdvancedSettings() {
  const { platform, settingsService, queryClient } = useRouteContext({ from: "__root__" });
  const connection = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () => Promise.resolve(platform.getServerUrl()).then((url) => ({ url })),
  });
  const apple = useQuery({
    queryKey: settingsQueryKeys.appleSetup,
    queryFn: () => settingsService.appleSetup(),
    retry: false,
  });
  const android = useQuery({
    queryKey: settingsQueryKeys.androidSetup,
    queryFn: () => settingsService.androidSetup(),
    retry: false,
  });
  const [url, setUrl] = useState("");
  const [saveState, setSaveState] = useState<SaveState | undefined>();
  const [savedNotice, setSavedNotice] = useState(false);
  const [connectionError, setConnectionError] = useState<string>();
  const edited = useRef(false);

  useEffect(() => {
    if (connection.data && !edited.current) setUrl(connection.data.url);
  }, [connection.data]);

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!platform.setServerUrl || !url.trim()) return;
    setSaveState("saving");
    setSavedNotice(false);
    setConnectionError(undefined);
    try {
      await Promise.resolve(platform.setServerUrl(url.trim()));
      await queryClient.cancelQueries();
      queryClient.clear();
      queryClient.setQueryData(CONNECTION_QUERY_KEY, { url: url.trim() });
      setSavedNotice(true);
      setSaveState("saved");
    } catch (error) {
      setSaveState("failed");
      setConnectionError(errorMessage(error));
    }
  }

  return (
    <SettingsFrame category="advanced" saveState={connection.isError ? "unavailable" : saveState}>
      <section
        className="grid gap-3 rounded-xl border border-border bg-card p-5"
        id="connection"
        aria-labelledby="connection-title"
      >
        <header>
          <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
            Server
          </p>
          <h2 id="connection-title">Relay address</h2>
          <p>Change this only when your workspace runs on a different Relay server.</p>
        </header>
        {connection.isPending ? <PageLoading label="Loading the Relay address…" /> : null}
        {connection.isError ? (
          <Alert
            className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
            variant="destructive"
            role="alert"
          >
            <AlertTitle>The Relay address is unavailable</AlertTitle>
            <AlertDescription>{errorMessage(connection.error)}</AlertDescription>
          </Alert>
        ) : null}
        {connection.data ? (
          <form className="grid gap-6" onSubmit={saveConnection}>
            <Field className="grid gap-2">
              <FieldLabel htmlFor="relay-server-url">Server URL</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="relay-server-url"
                  type="url"
                  value={url}
                  required
                  readOnly={!platform.setServerUrl}
                  disabled={saveState === "saving"}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => {
                    edited.current = true;
                    setUrl(event.currentTarget.value);
                    setSavedNotice(false);
                  }}
                />
                {platform.setServerUrl ? (
                  <Button
                    variant="default"
                    type="submit"
                    disabled={!url.trim() || saveState === "saving"}
                  >
                    {saveState === "saving" ? "Saving…" : "Save address"}
                  </Button>
                ) : null}
              </div>
              <FieldDescription>For example, http://127.0.0.1:8787</FieldDescription>
              {connectionError ? (
                <p role="alert">
                  Could not save this address. {connectionError} Your entered address is preserved;
                  try saving again.
                </p>
              ) : null}
              {savedNotice ? (
                <p className="mt-4 flex items-center gap-2" role="status">
                  Saved. Reopen Relay to use the new address everywhere.
                </p>
              ) : null}
            </Field>
          </form>
        ) : null}
      </section>

      <section
        className="grid gap-3 rounded-xl border border-border bg-card p-5"
        id="device-support"
        aria-labelledby="device-support-title"
      >
        <header className="flex items-start justify-between gap-3">
          <div>
            <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
              Device support
            </p>
            <h2 id="device-support-title">Local readiness</h2>
            <p>
              These checks explain what to install or open when a mobile device needs attention.
            </p>
          </div>
          {apple.isError || android.isError ? (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void apple.refetch();
                void android.refetch();
              }}
            >
              Check again
            </Button>
          ) : null}
        </header>
        <SetupRow
          title="Apple devices"
          checks={setupChecks(apple.data)}
          loading={apple.isPending}
          action={
            platform.openXcode ? (
              <Button size="sm" onClick={() => void platform.openXcode?.()}>
                Open Xcode
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void platform.openExternal?.("https://developer.apple.com/xcode/")}
              >
                Learn about Xcode
              </Button>
            )
          }
        />
        <SetupRow
          title="Android devices"
          checks={setupChecks(android.data)}
          loading={android.isPending}
          action={
            <Button
              size="sm"
              onClick={() =>
                void platform.openExternal?.(
                  "https://developer.android.com/tools/releases/platform-tools",
                )
              }
            >
              Get Platform Tools
            </Button>
          }
        />
      </section>
    </SettingsFrame>
  );
}

export function SettingsPage({ category }: { category: SettingsCategory }) {
  if (category === "general") return <GeneralSettings />;
  if (category === "evidence") return <EvidenceSettings />;
  if (category === "integrations") return <IntegrationsSettings />;
  if (category === "appearance") return <AppearanceSettings />;
  if (category === "advanced") return <AdvancedSettings />;
  return <AboutSettings />;
}
