/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useLocation, useRouteContext } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { deviceSummaryLine } from "../data/device-label";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import { readSetupContinuation } from "../data/setup-continuation";
import type {
  LiveTargetBrowserContext,
  LiveTargetInput,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, errorMessage } from "./recording-shared";

const routeApi = getRouteApi("/devices/$deviceId");

function deviceDescription(device: ProductDevice): string {
  if (device.status === "needs-attention") {
    return "One step before this device is ready";
  }
  return deviceSummaryLine(device);
}

export function DevicePage() {
  const { deviceId } = routeApi.useParams();
  const rawSearch = useLocation({ select: (state) => state.search });
  const returnTo =
    rawSearch && typeof rawSearch === "object" && "returnTo" in rawSearch
      ? readSetupContinuation(rawSearch.returnTo)
      : undefined;
  const { deviceService, productService, queryClient } = useRouteContext({ from: "__root__" });
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<LiveTargetSession | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [liveIssue, setLiveIssue] = useState<string>();
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [appIdentifier, setAppIdentifier] = useState("");
  const [appIdentifierError, setAppIdentifierError] = useState<string>();
  const [relaunchApp, setRelaunchApp] = useState(false);
  const device = useQuery({
    queryKey: deviceQueryKeys.device(deviceId),
    queryFn: () => deviceService.get(deviceId),
    staleTime: 5_000,
  });
  const recover = useMutation({
    mutationFn: async () => {
      if (!device.data) throw new TypeError("This device is no longer available.");
      return deviceService.recover(device.data.serial, "connect");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.devices });
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.device(deviceId) });
    },
  });
  const appLaunch = useMutation({
    mutationFn: async () => {
      if (!device.data) throw new TypeError("This device is no longer available.");
      if (!deviceService.launchApp) {
        throw new TypeError("App launch is not available from this Relay host.");
      }
      return deviceService.launchApp(device.data.id, appIdentifier.trim(), relaunchApp);
    },
  });
  const target = useQuery({
    queryKey: ["devices", deviceId, "live-target"],
    queryFn: async () => {
      const connected = await productService.connect();
      if (connected.recovery) return null;
      const options = await productService.presentTargets(connected.targets);
      return (
        options.find(
          (option) =>
            option.targetId === device.data?.serial || option.targetId === device.data?.id,
        ) ?? null
      );
    },
    enabled: Boolean(device.data && device.data.status !== "needs-attention"),
    staleTime: 5_000,
  });
  const appLaunchSupported = Boolean(
    device.data?.status === "ready" &&
    (device.data.platform === "android" || device.data.platform === "ios") &&
    deviceService.launchApp,
  );

  function submitAppLaunch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const identifier = appIdentifier.trim();
    if (!identifier) {
      setAppIdentifierError("Enter an app name, package, or bundle identifier.");
      return;
    }
    setAppIdentifierError(undefined);
    appLaunch.mutate();
  }

  useEffect(() => {
    const createPreview = productService.previewTarget;
    if (!target.data || !canvas.current || !createPreview) return;
    let disposed = false;
    let unmount: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let mounted: LiveTargetSession | undefined;
    setLiveIssue(undefined);
    setLiveStatus("connecting");
    setBrowserContext(undefined);
    void createPreview(target.data)
      .then((next) => {
        if (disposed || !canvas.current) return next.close();
        mounted = next;
        session.current = next;
        unsubscribe = next.subscribe((state) => {
          setLiveStatus(state.status);
          setLiveIssue(state.issue ? friendlyLiveIssue(state.issue) : undefined);
          setBrowserContext(state.browserContext);
        });
        unmount = next.mount(canvas.current);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLiveStatus("degraded");
          setLiveIssue(friendlyLiveIssue(errorMessage(error)));
        }
      });
    return () => {
      disposed = true;
      unmount?.();
      unsubscribe?.();
      if (session.current === mounted) session.current = undefined;
      mounted?.close();
    };
  }, [liveAttempt, productService, target.data]);

  async function send(input: Parameters<LiveTargetSession["input"]>[0]) {
    if (!session.current) {
      setLiveIssue("The live view is still connecting.");
      return false;
    }
    setLiveBusy(true);
    setLiveIssue(undefined);
    try {
      await session.current.input(input);
      return true;
    } catch (error) {
      setLiveIssue(friendlyLiveIssue(errorMessage(error)));
      return false;
    } finally {
      setLiveBusy(false);
    }
  }

  return (
    <LibraryPage className="max-w-[1120px]">
      <PageHeader
        crumbs={[{ label: "Devices", to: "/devices" }, { label: device.data?.name ?? "Device" }]}
        title={device.data?.name ?? "Device"}
        description={device.data ? deviceDescription(device.data) : undefined}
        actions={
          <>
            {returnTo ? (
              <Button
                variant="ghost"
                nativeButton={false}
                render={
                  <Link
                    to="/tests/new"
                    search={{
                      ...(returnTo.appId ? { app: returnTo.appId } : {}),
                      ...(returnTo.targetId ? { target: returnTo.targetId } : {}),
                    }}
                  />
                }
              >
                Back to Test setup
              </Button>
            ) : null}
            {device.data?.status === "needs-attention" ? (
              <Button
                variant="default"
                onClick={() => recover.mutate()}
                disabled={recover.isPending}
              >
                {recover.isPending ? "Reconnecting…" : "Reconnect device"}
              </Button>
            ) : device.data ? (
              <Button
                variant="default"
                nativeButton={false}
                render={
                  <Link
                    to="/tests/new"
                    search={{
                      ...(returnTo?.appId ? { app: returnTo.appId } : {}),
                      target: target.data?.targetId ?? device.data.serial,
                    }}
                  />
                }
              >
                Record a Test
              </Button>
            ) : null}
          </>
        }
      />

      {device.isPending ? <PageLoading label="Checking this device…" /> : null}

      {device.isError ? (
        <EmptyState
          title="Relay could not check this device"
          detail="The connection may have changed. Check again without losing your place."
          tone="notice"
          action={
            <Button variant="default" onClick={() => void device.refetch()}>
              Try again
            </Button>
          }
        />
      ) : null}

      {!device.isPending && !device.isError && !device.data ? (
        <EmptyState
          title="This device is no longer available"
          detail="It may have been disconnected or renamed. Return to Devices to see what Relay can use now."
          action={
            <Button nativeButton={false} variant="default" render={<Link to="/devices" />}>
              View Devices
            </Button>
          }
        />
      ) : null}

      {device.data ? (
        <div className="grid gap-8">
          {recover.error ? (
            <p
              className="relay-settings-error max-w-[60ch] text-[13px] leading-5 text-destructive"
              role="alert"
            >
              Reconnection did not finish. Keep the device awake and connected, then try again.
            </p>
          ) : null}
          {recover.data ? (
            <p className="max-w-[60ch] text-[13px] leading-5" aria-live="polite">
              <strong className="font-medium">
                {recover.data.ready ? "Device is ready. " : "Device still needs attention. "}
              </strong>
              {recover.data.summary}
            </p>
          ) : null}
          {device.data.status !== "needs-attention" ? (
            <DeviceLivePreview
              canvas={canvas}
              target={target.data ?? undefined}
              browserContext={browserContext}
              status={liveStatus}
              issue={liveIssue}
              busy={liveBusy}
              reconnect={() => {
                void target.refetch();
                setLiveAttempt((value) => value + 1);
              }}
              send={send}
              pending={target.isPending}
            />
          ) : null}

          {appLaunchSupported ? (
            <section className="grid gap-4" aria-labelledby="device-launch-title">
              <div className="grid gap-2 text-sm leading-relaxed text-text-weak">
                <h2 className="font-semibold text-text-strong" id="device-launch-title">
                  Launch an app
                </h2>
                <p>Open an installed app by name, package, or bundle identifier.</p>
              </div>
              <form
                className="relay-device-launch-form grid gap-4"
                onSubmit={submitAppLaunch}
                noValidate
              >
                <div className="relay-form-field grid min-w-0 gap-2 text-sm [&>label]:font-medium">
                  <label htmlFor="device-app-identifier">App/package/bundle identifier</label>
                  <input
                    id="device-app-identifier"
                    className="relay-input min-h-9 w-full rounded-[var(--radius-md)] border border-[var(--border-base)] bg-[var(--background-strong)] px-3 text-base text-[var(--text-strong)] shadow-[0_1px_2px_color-mix(in_srgb,black_5%,transparent)] placeholder:text-[var(--text-weaker)] focus-visible:border-[var(--relay-focus-ring)] focus-visible:outline-3 focus-visible:outline-[color-mix(in_srgb,var(--relay-focus-ring)_24%,transparent)] focus-visible:outline-offset-1"
                    type="text"
                    value={appIdentifier}
                    placeholder="com.example.app"
                    autoComplete="off"
                    spellCheck={false}
                    required
                    aria-invalid={appIdentifierError ? true : undefined}
                    aria-describedby={
                      appIdentifierError
                        ? "device-app-identifier-error"
                        : "device-app-identifier-help"
                    }
                    onChange={(event) => {
                      setAppIdentifier(event.target.value);
                      if (appIdentifierError) setAppIdentifierError(undefined);
                      if (appLaunch.error || appLaunch.data) appLaunch.reset();
                    }}
                  />
                  <p id="device-app-identifier-help">Use the package or bundle identifier.</p>
                  {appIdentifierError ? (
                    <p
                      id="device-app-identifier-error"
                      className="relay-settings-error mt-3 text-sm leading-relaxed text-destructive"
                      role="alert"
                    >
                      {appIdentifierError}
                    </p>
                  ) : null}
                </div>
                <label className="relay-device-launch-relaunch flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={relaunchApp}
                    onChange={(event) => setRelaunchApp(event.target.checked)}
                  />
                  <span>Relaunch if the app is already open</span>
                </label>
                <Button type="submit" variant="default" disabled={appLaunch.isPending}>
                  {appLaunch.isPending ? "Launching…" : "Launch app"}
                </Button>
                {appLaunch.error ? (
                  <p
                    className="relay-settings-error mt-3 text-sm leading-relaxed text-destructive"
                    role="alert"
                  >
                    {friendlyAppLaunchIssue(appLaunch.error)}
                  </p>
                ) : null}
                {appLaunch.data ? (
                  <div
                    className="relay-device-launch-result rounded-xl border border-border bg-card p-5"
                    role="status"
                    aria-live="polite"
                  >
                    <strong>Launch requested</strong>
                    <p>
                      Relay launched {appLaunch.data.app} on {device.data.name}.
                    </p>
                  </div>
                ) : null}
              </form>
            </section>
          ) : null}
        </div>
      ) : null}
    </LibraryPage>
  );
}

function DeviceLivePreview({
  canvas,
  target,
  browserContext,
  status,
  issue,
  busy,
  reconnect,
  send,
  pending,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  target?: { name: string; detail: string };
  browserContext?: LiveTargetBrowserContext;
  status: LiveTargetStatus;
  issue?: string;
  busy: boolean;
  reconnect: () => void;
  send: (input: LiveTargetInput) => Promise<boolean>;
  pending: boolean;
}) {
  if (pending) return <PageLoading label="Opening the live device…" />;
  if (!target) {
    return (
      <RecoveryState
        title="Live view is not connected"
        detail="Keep the device awake and connected, then reconnect."
        action={
          <Button size="sm" variant="ghost" onClick={reconnect}>
            <RotateCcw aria-hidden="true" /> Reconnect
          </Button>
        }
      />
    );
  }
  return (
    <section
      className="min-w-0 overflow-hidden rounded-xl border border-border bg-card"
      aria-labelledby="device-live-title"
    >
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <h2 className="text-[13px] font-medium" id="device-live-title">
          Live
        </h2>
        <Button size="sm" variant="ghost" onClick={reconnect}>
          <RotateCcw aria-hidden="true" /> Reconnect
        </Button>
      </div>
      <LiveTargetCanvas
        canvasRef={canvas}
        status={status}
        issue={issue}
        busy={busy}
        targetTitle={target.name}
        targetDetail={target.detail}
        browserContext={browserContext}
        send={send}
        recording={false}
      />
    </section>
  );
}

function friendlyLiveIssue(message: string): string {
  if (/locked|unlock|view only/iu.test(message)) return "Unlock the device, then reconnect.";
  if (/packet|transport|codec|decode|base64|operation|targetid/iu.test(message)) {
    return "Relay could not show the live view. Keep the device connected, then reconnect.";
  }
  return message;
}

function friendlyAppLaunchIssue(error: unknown): string {
  const rawMessage = error instanceof Error ? error.message : "";
  if (/device|target|serial|offline|disconnected|unauthorized|not found/iu.test(rawMessage)) {
    return "Relay could not launch the app. Keep the device connected and try again.";
  }
  const message = errorMessage(error);
  if (/not available|attached Android and iOS/iu.test(message)) return message;
  return "Relay could not launch the app. Check the identifier and try again.";
}
