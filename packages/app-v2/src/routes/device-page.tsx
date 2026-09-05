/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useLocation, useRouteContext } from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { deviceQueryKeys, type ProductDevice } from "../data/device-product-service";
import { readSetupContinuation } from "../data/setup-continuation";
import type {
  LiveTargetInput,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, errorMessage } from "./recording-shared";

const routeApi = getRouteApi("/devices/$deviceId");

function productPlatform(device: ProductDevice): string {
  if (device.platform === "ios") return "Apple device";
  if (device.platform === "android") return "Android device";
  return "Managed browser";
}

function statusCopy(device: ProductDevice): { label: string; title: string; detail: string } {
  if (device.status === "needs-attention") {
    return {
      label: "Needs attention",
      title: "One step before this device is ready",
      detail: device.recovery ?? "Reconnect this device, then ask Relay to check it again.",
    };
  }
  if (device.status === "virtual") {
    return {
      label: "Virtual device",
      title: "Available when a Test needs it",
      detail:
        "Relay checks this virtual device again when you start a Test, so the final Run uses current availability.",
    };
  }
  return {
    label: "Ready",
    title: "Ready for a Test",
    detail:
      "Relay reported this device ready. Its connection and evidence capabilities are checked again when a Run starts.",
  };
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
      if (connected.recovery) return undefined;
      const options = await productService.presentTargets(connected.targets);
      return options.find(
        (option) => option.targetId === device.data?.serial || option.targetId === device.data?.id,
      );
    },
    enabled: Boolean(device.data && device.data.status !== "needs-attention"),
    staleTime: 5_000,
  });
  const presentation = device.data ? statusCopy(device.data) : undefined;
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
    void createPreview(target.data)
      .then((next) => {
        if (disposed || !canvas.current) return next.close();
        mounted = next;
        session.current = next;
        unsubscribe = next.subscribe((state) => {
          setLiveStatus(state.status);
          setLiveIssue(state.issue ? friendlyLiveIssue(state.issue) : undefined);
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
      return;
    }
    setLiveBusy(true);
    setLiveIssue(undefined);
    try {
      await session.current.input(input);
    } catch (error) {
      setLiveIssue(friendlyLiveIssue(errorMessage(error)));
    } finally {
      setLiveBusy(false);
    }
  }

  return (
    <section className="relay-page relay-device-page">
      <Breadcrumbs
        items={[{ label: "Devices", to: "/devices" }, { label: device.data?.name ?? "Device" }]}
      />
      {returnTo ? (
        <Link
          className="relay-inline-link"
          to="/tests/new"
          search={{
            ...(returnTo.appId ? { app: returnTo.appId } : {}),
            ...(returnTo.targetId ? { target: returnTo.targetId } : {}),
          }}
        >
          ← Back to Test setup
        </Link>
      ) : null}
      <header className="relay-page-header relay-device-detail-header">
        <div>
          <p className="relay-eyebrow">Device</p>
          <h1>{device.data?.name ?? "Device"}</h1>
          {device.data ? (
            <p className="relay-page-description">
              {[productPlatform(device.data), device.data.osVersion, device.data.kind]
                .filter(Boolean)
                .join(" · ")}
            </p>
          ) : null}
        </div>
        {device.data?.status === "needs-attention" ? (
          <Button variant="default" onClick={() => recover.mutate()} disabled={recover.isPending}>
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
            Use for a new Test
          </Button>
        ) : null}
      </header>

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

      {device.data && presentation ? (
        <div className="relay-device-detail-grid">
          {device.data.status !== "needs-attention" ? (
            <DeviceLivePreview
              canvas={canvas}
              target={target.data}
              status={liveStatus}
              issue={liveIssue}
              busy={liveBusy}
              reconnect={() => setLiveAttempt((value) => value + 1)}
              send={send}
              pending={target.isPending}
            />
          ) : null}
          <section className="relay-device-health" aria-labelledby="device-health-title">
            <Badge
              variant={device.data.status === "needs-attention" ? "secondary" : "default"}
              className={
                device.data.status === "needs-attention"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-300"
                  : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"
              }
            >
              {presentation.label}
            </Badge>
            <h2 id="device-health-title">{presentation.title}</h2>
            <p>{presentation.detail}</p>
            {recover.error ? (
              <p className="relay-settings-error" role="alert">
                Reconnection did not finish. Keep the device awake and connected, then try again.
              </p>
            ) : null}
            {recover.data ? (
              <div className="relay-device-recovery-result" aria-live="polite">
                <strong>
                  {recover.data.ready ? "Device is ready" : "Device still needs attention"}
                </strong>
                <p>{recover.data.summary}</p>
              </div>
            ) : null}
          </section>

          <section className="relay-device-facts" aria-labelledby="device-details-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">At a glance</p>
                <h2 id="device-details-title">Device details</h2>
              </div>
            </div>
            <dl>
              <div>
                <dt>Platform</dt>
                <dd>{productPlatform(device.data)}</dd>
              </div>
              <div>
                <dt>Software</dt>
                <dd>{device.data.osVersion ?? "Reported by the device when available"}</dd>
              </div>
              <div>
                <dt>Type</dt>
                <dd>{device.data.kind ?? "Device"}</dd>
              </div>
            </dl>
          </section>

          <section className="relay-device-launch" aria-labelledby="device-launch-title">
            <div className="relay-device-launch-copy">
              <p className="relay-section-label">App control</p>
              <h2 id="device-launch-title">Launch an app</h2>
              <p>Open an installed app on this device by name, package, or bundle identifier.</p>
            </div>
            {appLaunchSupported ? (
              <form className="relay-device-launch-form" onSubmit={submitAppLaunch} noValidate>
                <div className="relay-form-field">
                  <label htmlFor="device-app-identifier">App/package/bundle identifier</label>
                  <input
                    id="device-app-identifier"
                    className="relay-input"
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
                  <p id="device-app-identifier-help">
                    Relay sends this exact identifier to the attached {device.data.platform} device.
                  </p>
                  {appIdentifierError ? (
                    <p
                      id="device-app-identifier-error"
                      className="relay-settings-error"
                      role="alert"
                    >
                      {appIdentifierError}
                    </p>
                  ) : null}
                </div>
                <label className="relay-device-launch-relaunch">
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
                  <p className="relay-settings-error" role="alert">
                    {friendlyAppLaunchIssue(appLaunch.error)}
                  </p>
                ) : null}
                {appLaunch.data ? (
                  <div className="relay-device-launch-result" role="status" aria-live="polite">
                    <strong>Launch requested</strong>
                    <p>
                      Relay launched {appLaunch.data.app} on {device.data.name}.
                    </p>
                  </div>
                ) : null}
              </form>
            ) : (
              <p className="relay-device-launch-unavailable" role="note">
                {device.data.platform === "browser"
                  ? "App launch is not available for managed browsers. Use the live session below instead."
                  : device.data.status !== "ready"
                    ? "Reconnect this device and wait until Relay reports it ready before launching an app."
                    : deviceService.launchApp
                      ? "App launch is available only for attached Android and iOS devices."
                      : "This Relay host cannot launch apps yet."}
              </p>
            )}
          </section>
        </div>
      ) : null}
    </section>
  );
}

function DeviceLivePreview({
  canvas,
  target,
  status,
  issue,
  busy,
  reconnect,
  send,
  pending,
}: {
  canvas: RefObject<HTMLCanvasElement | null>;
  target?: { name: string; detail: string };
  status: LiveTargetStatus;
  issue?: string;
  busy: boolean;
  reconnect: () => void;
  send: (input: LiveTargetInput) => Promise<boolean | void>;
  pending: boolean;
}) {
  return (
    <section className="relay-device-live" aria-labelledby="device-live-title">
      <div className="relay-device-live-heading">
        <div>
          <p className="relay-section-label">Live preview</p>
          <h2 id="device-live-title">Position the device before recording</h2>
          <p>
            Interact freely here. This preview closes when you leave; start a Test to create a
            durable Session with saved evidence and history.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={reconnect}>
          <RotateCcw aria-hidden="true" /> Reconnect
        </Button>
      </div>
      {pending ? <PageLoading label="Opening the live device…" /> : null}
      {target ? (
        <LiveTargetCanvas
          canvasRef={canvas}
          status={status}
          issue={issue}
          busy={busy}
          targetTitle={target.name}
          targetDetail={target.detail}
          send={send}
          recording={false}
        />
      ) : !pending ? (
        <EmptyState
          title="Live control is not available yet"
          detail="Keep the device awake and connected, then reconnect. You can still use it when Relay reports it ready."
        />
      ) : null}
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
