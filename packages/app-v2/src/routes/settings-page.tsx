/** @jsxImportSource react */
import type { SensitiveEvidenceChannel } from "@relay/protocol";
import { Field, FieldDescription, FieldLabel } from "@relay/ui-react/components/field";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { settingsQueryKeys, type SettingsCategory } from "../data/settings-product-service";
import { AppearanceSettings } from "./appearance-settings";
import { PageLoading } from "./recording-shared";
import {
  SettingRow,
  SettingsFrame,
  SettingsGroup,
  ToggleRow,
  type SaveState,
} from "./settings-frame";
import { AboutSettings } from "./settings-about";
import {
  CHANNELS,
  CONNECTION_QUERY_KEY,
  SetupRow,
  errorMessage,
  setupChecks,
  operatorBuildChecks,
  labServerChecks,
  judgeProviderChecks,
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
      <SettingsGroup>
        <SettingRow
          title="Workspace connection"
          description={
            connection.isError
              ? "Relay could not read this computer’s address."
              : hostname
                ? `Relay is using ${hostname}.`
                : "Checking the current Relay workspace."
          }
        >
          {connection.isPending ? (
            <span>Checking</span>
          ) : connection.isError ? (
            <span className="text-amber-800 dark:text-amber-300">Unavailable</span>
          ) : null}
        </SettingRow>
        {platform.notify ? (
          <SettingRow title="Desktop notifications" description="Notify when a Run finishes.">
            <Button
              size="sm"
              variant="ghost"
              disabled={notification.isPending}
              onClick={() => notification.mutate()}
            >
              {notification.isPending ? "Sending…" : "Send a test"}
            </Button>
          </SettingRow>
        ) : null}
      </SettingsGroup>
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
          <SettingsGroup title="Privacy" id="privacy">
            <ToggleRow
              id="redact-sensitive-evidence"
              title="Redact sensitive evidence"
              description={
                privacy.data.locked
                  ? "This policy is controlled outside Relay for this workspace."
                  : "Masks credentials, cookies, secrets, clipboard, and URL queries."
              }
              checked={privacy.data.enabled}
              disabled={privacy.data.locked || privacyMutation.isPending}
              onChange={(enabled) => privacyMutation.mutate(enabled)}
            />
          </SettingsGroup>

          <SettingsGroup title="Optional collection" id="sensitive">
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
          </SettingsGroup>
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
      ) : null}
      {integrations.data?.length ? (
        <SettingsGroup>
          {integrations.data.map((integration) => (
            <SettingRow
              key={integration.provider}
              title={integration.name}
              description={integration.detail}
            >
              {integration.state === "connected" ||
              integration.state === "server-managed" ? null : (
                <span
                  className={
                    integration.state === "unavailable"
                      ? "text-amber-800 dark:text-amber-300"
                      : undefined
                  }
                >
                  {integration.state
                    .replace(/-/gu, " ")
                    .replace(/^./u, (letter) => letter.toLocaleUpperCase())}
                </span>
              )}
            </SettingRow>
          ))}
        </SettingsGroup>
      ) : connection.data ? (
        <SettingsGroup>
          <SettingRow title="Relay workspace" description={serverName} />
        </SettingsGroup>
      ) : null}
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
      <SettingsGroup id="connection">
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
          <form className="grid gap-2" onSubmit={saveConnection}>
            <Field className="grid gap-2">
              <FieldLabel htmlFor="">Server URL</FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id=""
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
              <FieldDescription>
                Local Vite uses this same origin at /relay (for example
                http://127.0.0.1:5175/relay). Direct http://127.0.0.1:8787 is for desktop and curl —
                browsers that cannot call another loopback port should keep the /relay address.
              </FieldDescription>
              {connectionError ? (
                <p role="alert">
                  Could not save this address. {connectionError} Your entered address is preserved;
                  try saving again.
                </p>
              ) : null}
              {savedNotice ? (
                <p role="status">Saved. Reopen Relay to use the new address everywhere.</p>
              ) : null}
            </Field>
          </form>
        ) : null}
      </SettingsGroup>

      <SettingsGroup
        title="Device support"
        id="device-support"
        action={
          apple.isError || android.isError ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void apple.refetch();
                void android.refetch();
              }}
            >
              Check again
            </Button>
          ) : undefined
        }
      >
        <SetupRow
          title="Apple devices"
          checks={setupChecks(apple.data)}
          loading={apple.isPending}
          action={
            platform.openXcode ? (
              <Button size="sm" variant="ghost" onClick={() => void platform.openXcode?.()}>
                Open Xcode
              </Button>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void platform.openExternal?.("https://developer.apple.com/xcode/")}
              >
                Learn about Xcode
              </Button>
            )
          }
        />
        <SetupRow
          title="Signed desktop build"
          checks={operatorBuildChecks(apple.data)}
          loading={apple.isPending}
        />
        <SetupRow
          title="Lab Mac server"
          checks={labServerChecks(apple.data)}
          loading={apple.isPending}
        />
        <SetupRow
          title="Visual and semantic judges"
          checks={judgeProviderChecks(apple.data)}
          loading={apple.isPending}
        />
        <SetupRow
          title="Android devices"
          checks={setupChecks(android.data)}
          loading={android.isPending}
          action={
            <Button
              size="sm"
              variant="ghost"
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
      </SettingsGroup>
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
