/** @jsxImportSource react */
import type { SensitiveEvidenceChannel } from "@relay/protocol";
import { Field, FieldDescription, FieldLabel } from "@relay/ui-react/components/field";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { deviceQueryKeys } from "../data/device-product-service";
import { productClientForPlatform } from "../data/product-client";
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
import { AgentConnectSettings } from "./agent-connect-settings";
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

/** Shortcuts that exist in the product today, grouped where they work. */
const SHORTCUTS: readonly { area: string; keys: readonly (readonly [string, string])[] }[] = [
  { area: "Anywhere", keys: [["⌘ K", "Search or run a command"]] },
  {
    area: "Review screenshots",
    keys: [
      ["J  K", "Next or previous screenshot"],
      ["A", "Looks correct"],
      ["⇧ A", "Accept as reference"],
      ["R", "Report an issue"],
      ["1  2  3", "Side by side, highlight changes, swipe"],
    ],
  },
  {
    area: "Map",
    keys: [
      ["F", "Fit the map"],
      ["⇧ F", "Focus the selected screen"],
      ["+  −", "Zoom in or out"],
      ["0", "Reset the view"],
    ],
  },
];

function formatUptime(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just started";
  if (minutes < 60) return `running for ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `running for ${hours} h`;
  return `running for ${Math.floor(hours / 24)} days`;
}

function GeneralSettings() {
  const { platform, deviceService } = useRouteContext({ from: "__root__" });
  const connection = useQuery({
    queryKey: CONNECTION_QUERY_KEY,
    queryFn: () =>
      platform.getServerConnection
        ? platform.getServerConnection()
        : Promise.resolve(platform.getServerUrl()).then((url) => ({ url })),
  });
  const health = useQuery({
    queryKey: ["settings", "health"] as const,
    queryFn: async () =>
      (await productClientForPlatform(platform)).client.invoke("system.health.get", {}),
    refetchInterval: 30_000,
    retry: false,
  });
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
    retry: false,
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
      platform.notify?.("Relay notifications are ready", "Important run updates can appear here."),
  });
  const hardware = (devices.data ?? []).filter((device) => device.platform !== "browser");
  const ready = hardware.filter((device) => device.status === "ready").length;
  const attention = hardware.filter((device) => device.status === "needs-attention").length;
  const virtual = hardware.filter((device) => device.status === "virtual").length;

  return (
    <SettingsFrame
      category="general"
      saveState={connection.isError || health.isError ? "unavailable" : undefined}
    >
      <SettingsGroup title="Status">
        <SettingRow
          title="Relay"
          description={
            health.isPending
              ? "Checking…"
              : health.isError
                ? `Relay isn’t answering${hostname ? ` at ${hostname}` : ""}. Start it, or change its address in Advanced.`
                : `Version ${health.data.version} · ${formatUptime(health.data.uptimeMs)}${hostname ? ` · ${hostname}` : ""}`
          }
        >
          {health.isPending ? null : health.isError ? (
            <Button size="sm" variant="outline" onClick={() => void health.refetch()}>
              Try again
            </Button>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-xs font-medium text-success-foreground">
              <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
              Connected
            </span>
          )}
        </SettingRow>
        <SettingRow
          title="Devices"
          description={
            devices.isPending
              ? "Looking for phones and tablets…"
              : devices.isError
                ? "Relay couldn’t list devices right now."
                : !hardware.length
                  ? "No phones, tablets, or emulators yet. Connect one by USB or start an emulator."
                  : [
                      `${ready} ready`,
                      attention ? `${attention} need${attention === 1 ? "s" : ""} attention` : "",
                      virtual ? `${virtual} emulator${virtual === 1 ? "" : "s"} available` : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")
          }
        >
          <Button size="sm" variant="ghost" nativeButton={false} render={<Link to="/devices" />}>
            Manage
          </Button>
        </SettingRow>
        {platform.notify ? (
          <SettingRow title="Desktop notifications" description="Notify when a run finishes.">
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
      <SettingsGroup title="Keyboard shortcuts">
        {SHORTCUTS.map((group) => (
          <div key={group.area} className="grid gap-2 py-3">
            <h3 className="text-xs font-medium text-muted-foreground">{group.area}</h3>
            <dl className="grid gap-1.5">
              {group.keys.map(([keys, action]) => (
                <div key={keys} className="flex items-center justify-between gap-4 text-sm">
                  <dt>{action}</dt>
                  <dd className="flex shrink-0 gap-1">
                    {keys.split(/\s{2}/u).map((key) => (
                      <kbd
                        key={key}
                        className="min-w-6 rounded border border-border bg-muted/50 px-1.5 py-0.5 text-center font-sans text-xs text-muted-foreground"
                      >
                        {key}
                      </kbd>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </SettingsGroup>
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
          className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
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
          className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
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
          {/* A service this workspace can't use is not a setting; leave it out. */}
          {integrations.data
            .filter((integration) => integration.state !== "unsupported")
            .map((integration) => (
              <SettingRow
                key={integration.provider}
                title={integration.name}
                description={integration.detail}
              >
                {integration.state === "connected" ||
                integration.state === "server-managed" ? null : (
                  <span
                    className={
                      integration.state === "unavailable" ? "text-warning-foreground" : undefined
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
      <AgentConnectSettings />
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
            className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm"
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
              <FieldDescription>
                Where this computer reaches your Relay server. In a browser, keep the address ending
                in /relay.
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
          title="Screenshot and text checks"
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

      {/* Release and lab hosting only matter to people shipping Relay itself. */}
      <details className="group/dev text-sm">
        <summary className="w-fit cursor-pointer py-1 text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
          For Relay developers
        </summary>
        <div className="mt-2">
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
        </div>
      </details>
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
