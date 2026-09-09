/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Link,
  getRouteApi,
  useLocation,
  useRouteContext,
  useNavigate,
} from "@tanstack/react-router";
import { RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { WorkbenchPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { deviceSummaryLine } from "../data/device-label";
import {
  deviceQueryKeys,
  type DeviceProductService,
  type ProductDevice,
} from "../data/device-product-service";
import { InstalledAppChoice } from "../components/installed-app-choice";
import { SelectField } from "../components/filter-select";
import { readSetupContinuation } from "../data/setup-continuation";
import type {
  LiveTargetBrowserContext,
  LiveTargetInput,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, errorMessage } from "./recording-shared";
import { TalkBackModeSelect, TalkBackOverlay, useTalkBackReview } from "./talkback-review-panel";
import { localeLabel, supportedLocaleChoice } from "../lib/locale-label";

const routeApi = getRouteApi("/devices/$deviceId");

function deviceDescription(device: ProductDevice): string {
  if (device.status === "needs-attention") {
    return "One step before this device is ready";
  }
  return deviceSummaryLine(device);
}

export function DevicePage() {
  const { deviceId } = routeApi.useParams();
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const returnTo =
    rawSearch && typeof rawSearch === "object" && "returnTo" in rawSearch
      ? readSetupContinuation(rawSearch.returnTo)
      : undefined;
  const { deviceService, productService, queryClient, platform } = useRouteContext({
    from: "__root__",
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const session = useRef<LiveTargetSession | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [liveIssue, setLiveIssue] = useState<string>();
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [talkBackRefresh, setTalkBackRefresh] = useState(0);
  const selectedApp = useQuery<string>({
    queryKey: ["device-app-choice", deviceId],
    enabled: false,
    initialData: "",
    gcTime: Infinity,
  });
  const appIdentifier = selectedApp.data;
  const setAppIdentifier = (value: string) =>
    queryClient.setQueryData(["device-app-choice", deviceId], value);
  const [localeSuccess, setLocaleSuccess] = useState<string>();
  const localeSelectionRef = useRef({ serial: "", packageName: "" });
  const device = useQuery({
    queryKey: deviceQueryKeys.device(deviceId),
    queryFn: () => deviceService.get(deviceId),
    staleTime: 5_000,
  });
  const talkBack = useTalkBackReview({
    enabled: Boolean(device.data?.serial),
    serial: device.data?.serial,
    capture: productService.reviewTalkBack,
    refreshKey: talkBackRefresh,
    platform,
  });
  const boot = useMutation({
    mutationFn: () => deviceService.startEmulator!(device.data!.avdName!),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.devices });
      await navigate({ to: "/devices/$deviceId", params: { deviceId: result.serial } });
    },
  });
  const recover = useMutation({
    mutationFn: async () => {
      if (!device.data) throw new TypeError("This device is no longer available.");
      return deviceService.recover(device.data.serial, "connect");
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.devices });
      setLiveAttempt((value) => value + 1);
    },
  });
  const appLocales = useQuery({
    queryKey: ["device-app-locales", device.data?.serial, appIdentifier],
    queryFn: () => deviceService.listAppLocales!(device.data!.serial, appIdentifier),
    enabled: Boolean(device.data?.serial && appIdentifier && deviceService.listAppLocales),
    retry: false,
  });
  localeSelectionRef.current = { serial: device.data?.serial ?? "", packageName: appIdentifier };
  useEffect(() => setLocaleSuccess(undefined), [deviceId, appIdentifier]);
  const localeChange = useMutation({
    mutationFn: ({
      locale,
      serial,
      packageName,
    }: {
      locale: string;
      serial: string;
      packageName: string;
    }) => deviceService.setAppLocale!(serial, packageName, locale),
    onSuccess: async (result, variables) => {
      if (
        localeSelectionRef.current.serial !== variables.serial ||
        localeSelectionRef.current.packageName !== variables.packageName
      )
        return;
      setLiveAttempt((value) => value + 1);
      setLocaleSuccess(result.observedLocale ?? variables.locale);
      await appLocales.refetch();
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
  const appControlsSupported = Boolean(
    device.data?.runnable &&
    device.data.platform === "android" &&
    deviceService.launchApp &&
    deviceService.listInstalledApps,
  );

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
      setTalkBackRefresh((count) => count + 1);
      return true;
    } catch (error) {
      setLiveIssue(friendlyLiveIssue(errorMessage(error)));
      return false;
    } finally {
      setLiveBusy(false);
    }
  }

  if (device.data?.status === "needs-attention" && device.data.avdName) {
    return (
      <WorkbenchPage className="flex h-full min-h-0 flex-col">
        <PageHeader
          crumbs={[{ label: "Devices", to: "/devices" }, { label: device.data.name }]}
          title={device.data.name}
          description="Android emulator"
        />
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            title={boot.isPending ? "Starting emulator…" : "This emulator is stopped"}
            detail={
              boot.isPending
                ? "The device will open here when it is ready."
                : "Start it to open an app, choose a language, or record a test."
            }
            action={
              <Button onClick={() => boot.mutate()} disabled={boot.isPending}>
                {boot.isPending ? "Starting…" : "Start emulator"}
              </Button>
            }
          />
        </div>
        {boot.error ? (
          <p role="alert" className="py-3 text-center text-sm text-destructive">
            {boot.error.message}
          </p>
        ) : null}
      </WorkbenchPage>
    );
  }

  return (
    <WorkbenchPage className="flex h-full min-h-0 flex-col !pb-4 [&>header]:shrink-0">
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
                onClick={() => (device.data?.avdName ? boot.mutate() : recover.mutate())}
                disabled={recover.isPending || boot.isPending}
              >
                {device.data?.avdName
                  ? boot.isPending
                    ? "Starting…"
                    : "Start emulator"
                  : recover.isPending
                    ? "Reconnecting…"
                    : "Reconnect device"}
              </Button>
            ) : device.data && !device.isError ? (
              <Button
                variant="default"
                nativeButton={false}
                render={
                  <Link
                    to="/tests/new"
                    search={{
                      ...(returnTo?.appId ? { app: returnTo.appId } : {}),
                      target: target.data?.targetId ?? device.data.serial,
                      ...(appIdentifier ? { originApplication: appIdentifier } : {}),
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
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <EmptyState
            title="Relay could not check this device"
            detail="The connection may have changed. Check again without losing your place."
            tone="notice"
            action={
              <Button
                variant="default"
                disabled={device.isFetching}
                onClick={async () => {
                  await device.refetch();
                  await target.refetch();
                  if (appIdentifier) await appLocales.refetch();
                  setLiveAttempt((value) => value + 1);
                }}
              >
                {device.isFetching ? "Checking…" : "Try again"}
              </Button>
            }
          />
        </div>
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

      {device.data && !device.isError ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(240px,300px)] gap-6 max-[900px]:grid-cols-1 max-[900px]:overflow-y-auto">
          {device.data.status !== "needs-attention" ? (
            <DeviceLivePreview
              platform={device.data.platform}
              canvas={canvas}
              target={target.data ?? undefined}
              browserContext={browserContext}
              status={liveStatus}
              issue={liveIssue}
              busy={liveBusy}
              reconnect={() => {
                recover.mutate();
              }}
              send={send}
              pending={target.isPending || recover.isPending}
              talkBack={talkBack}
            />
          ) : null}
          <aside
            className="grid min-w-0 content-start gap-5 overflow-y-auto py-2"
            aria-label="Device controls"
          >
            {boot.error ? (
              <p role="alert" className="text-sm text-destructive">
                {boot.error.message}
              </p>
            ) : null}
            {recover.error ? (
              <p
                className="relay-settings-error max-w-[60ch] text-[13px] leading-5 text-destructive"
                role="alert"
              >
                Reconnection did not finish. Keep the device awake and connected, then try again.
              </p>
            ) : null}
            {recover.data ? (
              <p
                className={recover.data.ready ? "sr-only" : "text-sm text-muted-foreground"}
                aria-live="polite"
              >
                <strong className="font-medium">
                  {recover.data.ready ? "Device is ready. " : "Device still needs attention. "}
                </strong>
                {recover.data.ready ? null : recover.data.summary}
              </p>
            ) : null}
            {device.data.platform === "android" ? (
              <section className="grid gap-4" aria-labelledby="device-launch-title">
                <div className="grid gap-2 text-sm leading-relaxed text-text-weak">
                  <h2 className="font-semibold text-text-strong" id="device-launch-title">
                    App and language
                  </h2>
                </div>
                <div className="grid gap-4">
                  <div className="relay-form-field grid min-w-0 gap-2 text-sm [&>label]:font-medium">
                    {appControlsSupported ? (
                      <InstalledAppChoice
                        service={deviceService}
                        serial={device.data.serial}
                        value={appIdentifier}
                        onChange={(value) => {
                          setAppIdentifier(value);
                          setLocaleSuccess(undefined);
                          localeSelectionRef.current = {
                            serial: device.data!.serial,
                            packageName: value,
                          };
                        }}
                        onOpened={() => setLiveAttempt((value) => value + 1)}
                      />
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        App controls are unavailable on this host. Reconnect the device and try
                        again.
                      </p>
                    )}
                  </div>
                  {appIdentifier ? (
                    appLocales.isPending ? (
                      <p className="text-sm text-muted-foreground" role="status">
                        Loading supported languages…
                      </p>
                    ) : appLocales.isError ? (
                      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                        <span>Supported languages could not be loaded.</span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => void appLocales.refetch()}
                        >
                          Try again
                        </Button>
                      </div>
                    ) : appLocales.data?.locales.length ? (
                      <div className="grid max-w-sm gap-2">
                        <SelectField
                          label="Language"
                          value={
                            localeChange.isPending &&
                            localeChange.variables.serial === device.data.serial &&
                            localeChange.variables.packageName === appIdentifier
                              ? localeChange.variables.locale
                              : supportedLocaleChoice(
                                  appLocales.data.currentLocale,
                                  appLocales.data.locales,
                                )
                          }
                          placeholder="Choose a language"
                          options={appLocales.data.locales.map((locale) => ({
                            value: locale,
                            label: localeLabel(locale),
                          }))}
                          onValueChange={(locale) => {
                            localeSelectionRef.current = {
                              serial: device.data!.serial,
                              packageName: appIdentifier,
                            };
                            localeChange.mutate({
                              locale,
                              serial: device.data!.serial,
                              packageName: appIdentifier,
                            });
                          }}
                          disabled={localeChange.isPending}
                        />
                        {localeChange.isPending ? (
                          <p className="text-sm text-muted-foreground" role="status">
                            Applying language…
                          </p>
                        ) : localeSuccess ? (
                          <p
                            className="text-sm text-emerald-700 dark:text-emerald-400"
                            role="status"
                          >
                            Language updated: {localeLabel(localeSuccess)}
                          </p>
                        ) : null}
                        {localeChange.error ? (
                          <p className="text-sm text-destructive" role="alert">
                            Language could not be updated. Try again.
                          </p>
                        ) : null}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        This app has no selectable languages available.
                      </p>
                    )
                  ) : null}
                </div>
              </section>
            ) : null}
            {device.data.platform === "ios" && device.data.runnable && deviceService.launchApp ? (
              <IOSAppLaunchForm
                service={deviceService}
                deviceId={device.data.id}
                deviceName={device.data.name}
              />
            ) : null}
          </aside>
        </div>
      ) : null}
    </WorkbenchPage>
  );
}

function IOSAppLaunchForm({
  service,
  deviceId,
  deviceName,
}: {
  service: DeviceProductService;
  deviceId: string;
  deviceName: string;
}) {
  const [identifier, setIdentifier] = useState("");
  const [relaunch, setRelaunch] = useState(false);
  const launch = useMutation({
    mutationFn: () => service.launchApp!(deviceId, identifier.trim(), relaunch),
  });
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!identifier.trim()) return;
    launch.mutate();
  }
  return (
    <section
      className="grid gap-4 border-t border-border pt-6"
      aria-labelledby="device-launch-title"
    >
      <div className="grid gap-1 text-sm">
        <h2 className="font-semibold" id="device-launch-title">
          Launch an app
        </h2>
        <p className="text-muted-foreground">Open an app by package or bundle identifier.</p>
      </div>
      <form className="grid max-w-xl gap-4" onSubmit={submit} noValidate>
        <label className="grid gap-1.5 text-sm font-medium" htmlFor="device-app-identifier">
          App or bundle identifier
          <input
            id="device-app-identifier"
            className="min-h-11 rounded-md border border-input bg-background px-3 text-base font-normal focus-visible:outline-2 focus-visible:outline-ring"
            value={identifier}
            onChange={(event) => {
              setIdentifier(event.target.value);
              launch.reset();
            }}
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={relaunch}
            onChange={(event) => setRelaunch(event.target.checked)}
          />
          Relaunch if the app is already open
        </label>
        <Button type="submit" className="w-fit" disabled={launch.isPending || !identifier.trim()}>
          {launch.isPending ? "Launching…" : "Launch app"}
        </Button>
        {launch.error ? (
          <p className="text-sm text-destructive" role="alert">
            {friendlyAppLaunchIssue(launch.error)}
          </p>
        ) : null}
        {launch.data ? (
          <p className="text-sm text-muted-foreground" role="status">
            Launch requested for {launch.data.app} on {deviceName}.
          </p>
        ) : null}
      </form>
    </section>
  );
}

function DeviceLivePreview({
  platform,
  canvas,
  target,
  browserContext,
  status,
  issue,
  busy,
  reconnect,
  send,
  pending,
  talkBack,
}: {
  platform: string;
  canvas: RefObject<HTMLCanvasElement | null>;
  target?: { name: string; detail: string };
  browserContext?: LiveTargetBrowserContext;
  status: LiveTargetStatus;
  issue?: string;
  busy: boolean;
  reconnect: () => void;
  send: (input: LiveTargetInput) => Promise<boolean>;
  pending: boolean;
  talkBack: ReturnType<typeof useTalkBackReview>;
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
      className="flex min-h-0 min-w-0 flex-col rounded-xl bg-muted/30 max-[900px]:h-[65dvh]"
      aria-labelledby="device-live-title"
    >
      <div className="flex shrink-0 items-center justify-between gap-4 px-3 py-2">
        <h2 className="text-[13px] font-medium" id="device-live-title">
          Live preview
        </h2>
        <Button size="sm" variant="ghost" onClick={reconnect}>
          <RotateCcw aria-hidden="true" /> Reconnect
        </Button>
      </div>
      <div className="min-h-0 flex-1">
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
          showTargetDetails={false}
          targetPlatform={platform}
          helpText=""
          overlay={
            talkBack.on && talkBack.mode !== "off" ? (
              <TalkBackOverlay
                canvasRef={canvas}
                items={talkBack.inspection.overlayItems}
                bounds={talkBack.inspection.bounds}
                mode={talkBack.mode}
              />
            ) : null
          }
          toolbar={
            <TalkBackModeSelect
              mode={talkBack.mode}
              loading={talkBack.loading}
              onModeChange={(mode) => talkBack.setMode(mode)}
            />
          }
        />
      </div>
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
