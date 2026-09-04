/** @jsxImportSource react */
import type { SensitiveEvidenceChannel } from "@relay/protocol";
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Disclosure,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useRouteContext } from "@tanstack/react-router";
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { settingsQueryKeys, type SettingsCategory } from "../data/settings-product-service";
import type { DesktopUpdateState } from "../platform/types";
import { AppearanceSettings } from "./appearance-settings";
import { PageLoading } from "./recording-shared";
import { SettingRow, SettingsFrame, ToggleRow, type SaveState } from "./settings-frame";

type SetupCheck = { id: string; label: string; status: string; detail: string };

const CONNECTION_QUERY_KEY = ["settings", "connection"] as const;
const CHANNELS: readonly {
  id: SensitiveEvidenceChannel;
  label: string;
  description: string;
}[] = [
  {
    id: "crash",
    label: "Crash details",
    description: "Keep crash reports that help explain why a Test stopped.",
  },
  {
    id: "audio",
    label: "Audio recordings",
    description: "Keep audio only when a Test needs to verify sound.",
  },
  {
    id: "network-body",
    label: "Request and response bodies",
    description: "Keep HTTP content that may include personal or account data.",
  },
  {
    id: "network-raw",
    label: "Raw network captures",
    description:
      "Keep PCAP files after a Run. Android emulator packet metadata is captured temporarily either way.",
  },
  {
    id: "browser-trace",
    label: "Browser diagnostics",
    description: "Keep a detailed browser trace for difficult failures.",
  },
];

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function setupChecks(value: unknown): readonly SetupCheck[] {
  const checks = recordValue(value)?.checks;
  if (!Array.isArray(checks)) return [];
  return checks.flatMap((item) => {
    const check = recordValue(item);
    return typeof check?.id === "string" &&
      typeof check.label === "string" &&
      typeof check.status === "string" &&
      typeof check.detail === "string"
      ? [
          {
            id: check.id,
            label: check.label,
            status: check.status,
            detail: check.detail,
          },
        ]
      : [];
  });
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && /failed to fetch|network|load failed/i.test(error.message)) {
    return "The Relay server could not be reached. Your existing settings are unchanged.";
  }
  return error instanceof Error ? error.message : "Relay could not complete this change.";
}

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

  return (
    <SettingsFrame category="general" saveState={connection.isError ? "unavailable" : undefined}>
      <section className="relay-settings-group" aria-labelledby="general-behavior-title">
        <header>
          <p className="relay-section-label">Workspace behavior</p>
          <h2 id="general-behavior-title">Built to resume safely</h2>
          <p>These behaviors follow the active workspace and need no manual maintenance.</p>
        </header>
        <SettingRow
          title="Active work"
          description="Relay restores a Recording or Run from its last durable state when you return."
        >
          <span className="relay-settings-value">Automatic</span>
        </SettingRow>
        <SettingRow
          title="Workspace connection"
          description={
            hostname
              ? `This app is connected through ${hostname}.`
              : "Checking the current Relay workspace."
          }
        >
          <Badge variant={connection.isError ? "warning" : "success"}>
            {connection.isPending ? "Checking" : connection.isError ? "Unavailable" : "Connected"}
          </Badge>
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
              size="small"
              onClick={() =>
                void platform.notify?.(
                  "Relay notifications are ready",
                  "Important Run updates can appear here.",
                )
              }
            >
              Send a test
            </Button>
          ) : (
            <span className="relay-settings-value">Web only</span>
          )}
        </SettingRow>
      </section>
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
        <Alert className="relay-settings-alert" variant="danger" role="alert">
          <AlertTitle>Relay could not load or save this setting</AlertTitle>
          <AlertDescription>{errorMessage(error)}</AlertDescription>
          <AlertActions>
            <Button
              size="small"
              onClick={() => {
                privacyMutation.reset();
                evidenceMutation.reset();
                void privacy.refetch();
                void evidence.refetch();
              }}
            >
              Try again
            </Button>
          </AlertActions>
        </Alert>
      ) : null}
      {privacy.data && evidence.data ? (
        <>
          <section className="relay-settings-group" id="privacy" aria-labelledby="privacy-title">
            <header>
              <p className="relay-section-label">Privacy</p>
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
              <span className="relay-settings-value">
                {privacy.data.enabled ? "Sensitive values redacted" : "Raw values allowed"}
              </span>
            </SettingRow>
          </section>

          <section
            className="relay-settings-group"
            id="sensitive"
            aria-labelledby="sensitive-title"
          >
            <header>
              <p className="relay-section-label">Optional collection</p>
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
  const { platform } = useRouteContext({ from: "__root__" });
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
      <section className="relay-settings-group" aria-labelledby="integration-title">
        <header>
          <p className="relay-section-label">Current workspace</p>
          <h2 id="integration-title">Connected services</h2>
          <p>Relay works locally without requiring an external account.</p>
        </header>
        {connection.isPending ? <PageLoading label="Checking workspace connection…" /> : null}
        {connection.isError ? (
          <Alert className="relay-settings-alert" variant="danger" role="alert">
            <AlertTitle>The workspace connection is unavailable</AlertTitle>
            <AlertDescription>
              Open Advanced to check the Relay address, then try again.
            </AlertDescription>
            <AlertActions>
              <Button size="small" render={<Link to="/settings/advanced" />}>
                Open Advanced
              </Button>
            </AlertActions>
          </Alert>
        ) : connection.data ? (
          <Item className="relay-integration-card" variant="outline">
            <ItemMedia className="relay-integration-mark" aria-hidden="true">
              R
            </ItemMedia>
            <ItemContent>
              <ItemTitle>Relay workspace</ItemTitle>
              <ItemDescription>
                Runs and Reports are connected through {serverName}.
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <Badge variant="success">Connected</Badge>
            </ItemActions>
          </Item>
        ) : null}
        <div className="relay-settings-empty-inline">
          <h3>No external service is required</h3>
          <p>
            Git and CI activity will appear as Changes when those services send work to this
            workspace. Relay keeps local Tests usable either way.
          </p>
          <Link className="relay-inline-link" to="/changes">
            View Changes
          </Link>
        </div>
      </section>
    </SettingsFrame>
  );
}

function SetupRow({
  title,
  checks,
  loading,
  action,
}: {
  title: string;
  checks: readonly SetupCheck[];
  loading: boolean;
  action?: ReactNode;
}) {
  const attention = checks.find((check) => check.status !== "ready");
  const ready = checks.length > 0 && !attention;
  return (
    <div className="relay-setup-status">
      <Item className="relay-setting-row relay-setup-status-row" size="small">
        <ItemContent className="relay-setting-row-copy">
          <ItemTitle>{title}</ItemTitle>
          <ItemDescription>
            {loading
              ? "Checking support on this computer…"
              : (attention?.detail ??
                (ready
                  ? "Relay has the local support it needs."
                  : "Relay could not read this support check."))}
          </ItemDescription>
        </ItemContent>
        <ItemActions className="relay-setting-row-control relay-setup-status-actions">
          <Badge variant={ready ? "success" : "warning"}>
            {loading ? "Checking" : ready ? "Ready" : "Needs attention"}
          </Badge>
          {!loading && attention ? action : null}
        </ItemActions>
      </Item>
      {!loading && attention && checks.length > 1 ? (
        <Disclosure.Root className="relay-setup-checks">
          <Disclosure.Trigger>Diagnostic checks ({checks.length})</Disclosure.Trigger>
          <Disclosure.Panel>
            <ul>
              {checks.map((check) => (
                <li key={check.id}>
                  <Badge variant={check.status === "ready" ? "success" : "warning"}>
                    {check.status === "ready" ? "Ready" : "Needs attention"}
                  </Badge>
                  <div>
                    <strong>{check.label}</strong>
                    <p>{check.detail}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Disclosure.Panel>
        </Disclosure.Root>
      ) : null}
    </div>
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

  useEffect(() => {
    if (connection.data) setUrl(connection.data.url);
  }, [connection.data]);

  async function saveConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!platform.setServerUrl || !url.trim()) return;
    setSaveState("saving");
    setSavedNotice(false);
    try {
      await Promise.resolve(platform.setServerUrl(url.trim()));
      queryClient.setQueryData(CONNECTION_QUERY_KEY, { url: url.trim() });
      setSavedNotice(true);
      setSaveState("saved");
    } catch {
      setSaveState("failed");
    }
  }

  return (
    <SettingsFrame category="advanced" saveState={connection.isError ? "unavailable" : saveState}>
      <section className="relay-settings-group" id="connection" aria-labelledby="connection-title">
        <header>
          <p className="relay-section-label">Connection</p>
          <h2 id="connection-title">Relay address</h2>
          <p>Change this only when your workspace runs on a different Relay server.</p>
        </header>
        {connection.isPending ? <PageLoading label="Loading the Relay address…" /> : null}
        {connection.isError ? (
          <Alert className="relay-settings-alert" variant="danger" role="alert">
            <AlertTitle>The Relay address is unavailable</AlertTitle>
            <AlertDescription>{errorMessage(connection.error)}</AlertDescription>
          </Alert>
        ) : null}
        {connection.data ? (
          <form className="relay-settings-form" onSubmit={saveConnection}>
            <Field className="relay-settings-address-field">
              <FieldLabel htmlFor="relay-server-url">Server URL</FieldLabel>
              <div className="relay-settings-address-control">
                <Input
                  id="relay-server-url"
                  type="url"
                  value={url}
                  required
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => {
                    setUrl(event.currentTarget.value);
                    setSavedNotice(false);
                  }}
                />
                {platform.setServerUrl ? (
                  <Button
                    variant="primary"
                    type="submit"
                    disabled={!url.trim() || saveState === "saving"}
                  >
                    {saveState === "saving" ? "Saving…" : "Save address"}
                  </Button>
                ) : null}
              </div>
              <FieldDescription>For example, http://127.0.0.1:8787</FieldDescription>
              {savedNotice ? (
                <p className="relay-settings-saved-notice" role="status">
                  Saved. Reopen Relay to use the new address everywhere.
                </p>
              ) : null}
            </Field>
          </form>
        ) : null}
      </section>

      <section
        className="relay-settings-group"
        id="device-support"
        aria-labelledby="device-support-title"
      >
        <header className="relay-settings-section-header">
          <div>
            <p className="relay-section-label">Device support</p>
            <h2 id="device-support-title">Local readiness</h2>
            <p>
              These checks explain what to install or open when a mobile device needs attention.
            </p>
          </div>
          {apple.isError || android.isError ? (
            <Button
              size="small"
              variant="secondary"
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
              <Button size="small" onClick={() => void platform.openXcode?.()}>
                Open Xcode
              </Button>
            ) : (
              <Button
                size="small"
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
              size="small"
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

function updateDescription(state: DesktopUpdateState | null): string {
  if (!state) return "Relay will report update availability when the desktop app supports it.";
  if (state.phase === "checking") return "Checking for a signed update…";
  if (state.phase === "available")
    return `${state.releaseName ?? state.version ?? "An update"} is available.`;
  if (state.phase === "downloaded")
    return `${state.releaseName ?? state.version ?? "An update"} is ready to install.`;
  if (state.phase === "error") return state.error ?? "Relay could not check for updates right now.";
  if (state.phase === "disabled") return "Automatic updates are disabled for this build.";
  if (state.phase === "unsupported") return "Updates are managed outside this app.";
  return "Relay checks for signed updates while the desktop app is running.";
}

function AboutSettings() {
  const { platform } = useRouteContext({ from: "__root__" });
  const [update, setUpdate] = useState<DesktopUpdateState | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!platform.updates) return;
    let active = true;
    void platform.updates.getState().then((state) => {
      if (active) setUpdate(state);
    });
    const unsubscribe = platform.updates.subscribe((state) => {
      if (active) setUpdate(state);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [platform]);

  async function checkForUpdates() {
    if (!platform.updates || checking) return;
    setChecking(true);
    try {
      await platform.updates.check();
      setUpdate(await platform.updates.getState());
    } finally {
      setChecking(false);
    }
  }

  return (
    <SettingsFrame category="about">
      <section className="relay-settings-group" aria-labelledby="about-product-title">
        <header>
          <p className="relay-section-label">Product</p>
          <h2 id="about-product-title">Relay</h2>
          <p>Proof that software works on real apps, browsers, and devices.</p>
        </header>
        <SettingRow title="Version" description="The build currently running on this computer.">
          <span className="relay-settings-value relay-settings-value--numeric">
            {platform.version ? `v${platform.version}` : "Development build"}
          </span>
        </SettingRow>
        <SettingRow title="Host" description="Where this Relay interface is running.">
          <span className="relay-settings-value">
            {platform.platform === "desktop" ? "Desktop app" : "Web browser"}
          </span>
        </SettingRow>
        {platform.updates ? (
          <SettingRow title="Updates" description={updateDescription(update)}>
            {update?.phase === "downloaded" ? (
              <Button
                variant="primary"
                size="small"
                onClick={() => void platform.updates?.install()}
              >
                Install update
              </Button>
            ) : (
              <Button
                size="small"
                onClick={() => void checkForUpdates()}
                disabled={checking || update?.phase === "checking"}
              >
                {checking || update?.phase === "checking" ? "Checking…" : "Check now"}
              </Button>
            )}
          </SettingRow>
        ) : null}
        <SettingRow
          title="Support"
          description="Read the project guide for setup, workflows, and troubleshooting."
        >
          {platform.openExternal ? (
            <Button
              size="small"
              onClick={() =>
                void platform.openExternal?.("https://github.com/callstackincubator/agent-device")
              }
            >
              Open project guide
            </Button>
          ) : (
            <span className="relay-settings-value">Available in the desktop app</span>
          )}
        </SettingRow>
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
