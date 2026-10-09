/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import {
  Sheet,
  SheetTrigger,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@relay/ui-react/components/sheet";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Link,
  getRouteApi,
  useLocation,
  useRouteContext,
  useNavigate,
} from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { WorkbenchPage, PageHeader } from "../components/page-layout";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { deviceSummaryLine } from "../data/device-label";
import { liveInputRecovery } from "../data/live-input-recovery";
import {
  deviceQueryKeys,
  deviceDiscoveryScope,
  type ProductDevice,
} from "../data/device-product-service";
import { InstalledAppChoice } from "../components/installed-app-choice";
import { SelectField } from "../components/filter-select";
import { readSetupContinuation } from "../data/setup-continuation";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { PageLoading, errorMessage } from "./recording-shared";
import { useTalkBackReview } from "./talkback-review-panel";
import { localeLabel, supportedLocaleChoice } from "../lib/locale-label";
import { DeviceLivePreview } from "./device-live-preview";
import { IOSAppLaunchForm } from "./device-app-launch-form";
import { forgetNativeAppLaunch, rememberNativeAppLaunch } from "../data/native-app-launch-context";
import type { DeviceProductService } from "../data/device-product-service";
import { useDevicePreviewSession } from "./use-device-preview-session";

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
  // Device repair only ever originates from the New Test setup flow.
  const recordingContinuation = returnTo?.kind === "record-test" ? returnTo : undefined;
  const { deviceService, productService, browserSpacesService, queryClient, platform } =
    useRouteContext({
      from: "__root__",
    });
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [browserAccessibility, setBrowserAccessibility] =
    useState<import("../data/talkback-overlay").TalkBackCaptureResult>();
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [liveIssue, setLiveIssue] = useState<string>();
  const [inputIssue, setInputIssue] = useState<ReturnType<typeof liveInputRecovery>>();
  const inputPending = useRef(false);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [appControlsOpen, setAppControlsOpen] = useState(false);
  const [iosAppDraft, setIosAppDraft] = useState("");
  const [iosRelaunch, setIosRelaunch] = useState(false);
  const [talkBackRefresh, setTalkBackRefresh] = useState(0);
  const selectedApp = useQuery<string>({
    queryKey: ["device-app-choice", deviceId],
    queryFn: () => queryClient.getQueryData<string>(["device-app-choice", deviceId]) ?? "",
    enabled: false,
    initialData: "",
    gcTime: Infinity,
    staleTime: Infinity,
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
  const currentLaunchTarget = useRef({
    service: deviceService,
    deviceId,
    serial: device.data?.serial,
  });
  currentLaunchTarget.current = { service: deviceService, deviceId, serial: device.data?.serial };
  const iosAppLaunch = useMutation({
    mutationFn: (input: {
      service: DeviceProductService;
      deviceId: string;
      serial: string;
      app: string;
      relaunch: boolean;
    }) => input.service.launchApp!(input.serial, input.app, input.relaunch),
    onSuccess: (result, input) => {
      if (
        currentLaunchTarget.current.service !== input.service ||
        currentLaunchTarget.current.deviceId !== input.deviceId ||
        currentLaunchTarget.current.serial !== input.serial ||
        result.serial !== input.serial ||
        result.platform !== "ios"
      )
        return;
      rememberNativeAppLaunch(input.service, result);
      setAppIdentifier(result.observed?.matched ? result.app : "");
      setLiveStatus("connecting");
      setLiveAttempt((value) => value + 1);
      setAppControlsOpen(false);
    },
  });
  useEffect(() => {
    setAppControlsOpen(false);
    setIosAppDraft("");
    setIosRelaunch(false);
    iosAppLaunch.reset();
  }, [deviceId]);
  const talkBack = useTalkBackReview({
    enabled:
      liveStatus === "streaming" &&
      Boolean(device.data?.serial) &&
      device.data?.platform !== "browser",
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
      if (device.data.platform === "browser") {
        await browserSpacesService.openSpace(device.data.id);
        return { ready: true, summary: "Browser is ready." };
      }
      forgetNativeAppLaunch(deviceService, device.data.serial);
      return deviceService.recover(device.data.serial, "connect");
    },
    onSuccess: async () => {
      setInputIssue(undefined);
      await queryClient.invalidateQueries({ queryKey: deviceQueryKeys.devices });
      setLiveAttempt((value) => value + 1);
    },
  });
  const appLocales = useQuery({
    queryKey: ["device-app-locales", device.data?.serial, appIdentifier],
    queryFn: () => deviceService.listAppLocales!(device.data!.serial, appIdentifier),
    enabled: Boolean(
      device.data?.platform === "android" &&
      device.data.runnable &&
      appIdentifier &&
      deviceService.listAppLocales &&
      deviceService.setAppLocale,
    ),
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
      const selectedDevice = device.data!;
      if (selectedDevice.platform === "browser") {
        return {
          kind: "browser" as const,
          platform: "browser" as const,
          targetId: selectedDevice.id,
          name: selectedDevice.name,
          detail: "Managed browser",
        };
      }
      const scope = deviceDiscoveryScope(selectedDevice);
      const connected = await productService.connect(scope);
      if (connected.recovery) return null;
      const options = await productService.presentTargets(connected.targets, scope);
      return (
        options.find(
          (option) =>
            option.targetId === selectedDevice.serial || option.targetId === selectedDevice.id,
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
  const appLanguagesSupported = Boolean(deviceService.listAppLocales && deviceService.setAppLocale);
  const showDeviceControls = Boolean(
    appControlsSupported ||
    (device.data?.platform === "ios" && device.data.runnable && deviceService.launchApp),
  );
  const reconnecting =
    recover.isPending || (Boolean(target.data) && liveAttempt > 0 && liveStatus === "connecting");

  const { canvas, session, onCanvasChange } = useDevicePreviewSession({
    enabled: Boolean(device.data && !device.isError && device.data.status !== "needs-attention"),
    target: target.data,
    attempt: liveAttempt,
    createPreview: productService.previewTarget,
    inspectAccessibility: talkBack.on,
    onSnapshot: (state) => {
      if (state.status === "connecting") setInputIssue(undefined);
      setLiveStatus(state.status);
      setLiveIssue(state.issue ? friendlyLiveIssue(state.issue) : undefined);
      setBrowserContext(state.browserContext);
      setBrowserAccessibility(state.accessibility);
    },
  });

  async function send(input: Parameters<LiveTargetSession["input"]>[0]) {
    if (!session.current) {
      setLiveIssue("The live view is still connecting.");
      return false;
    }
    if (inputPending.current) return false;
    inputPending.current = true;
    setLiveBusy(true);
    try {
      if (device.data?.platform !== "browser" && device.data?.serial)
        forgetNativeAppLaunch(deviceService, device.data.serial);
      await session.current.input(input);
      setInputIssue(undefined);
      setTalkBackRefresh((count) => count + 1);
      return true;
    } catch (error) {
      setInputIssue(liveInputRecovery(error));
      return false;
    } finally {
      inputPending.current = false;
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
    <Sheet open={appControlsOpen} onOpenChange={setAppControlsOpen}>
      <WorkbenchPage className="flex h-full min-h-0 flex-col !pb-4 [&>header]:shrink-0">
        <PageHeader
          crumbs={[{ label: "Devices", to: "/devices" }, { label: device.data?.name ?? "Device" }]}
          title={device.data?.name ?? "Device"}
          description={device.data ? deviceDescription(device.data) : undefined}
          actions={
            <>
              {showDeviceControls ? (
                <SheetTrigger render={<Button variant="secondary" />}>Open app</SheetTrigger>
              ) : null}
              {recordingContinuation ? (
                <Button
                  variant="ghost"
                  nativeButton={false}
                  render={
                    <Link
                      to="/tests/new"
                      search={{
                        ...(recordingContinuation?.appId
                          ? { app: recordingContinuation.appId }
                          : {}),
                        ...(recordingContinuation?.targetId
                          ? { target: recordingContinuation.targetId }
                          : {}),
                      }}
                    />
                  }
                >
                  Back to test setup
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
                  disabled={iosAppLaunch.isPending}
                  render={
                    <Link
                      to="/tests/new"
                      search={{
                        ...(recordingContinuation?.appId
                          ? { app: recordingContinuation.appId }
                          : {}),
                        target: target.data?.targetId ?? device.data.serial,
                        targetKind: "device",
                        ...(appIdentifier ? { originApplication: appIdentifier } : {}),
                      }}
                    />
                  }
                >
                  Record a test
                </Button>
              ) : null}
            </>
          }
        />

        {device.isPending ? <PageLoading label="Checking this device…" /> : null}
        {boot.error ? (
          <p role="alert" className="py-2 text-sm text-destructive">
            {boot.error.message}
          </p>
        ) : null}
        {recover.data && !recover.data.ready ? (
          <p className="py-2 text-sm text-muted-foreground" role="status">
            <strong className="font-medium">Device still needs attention.</strong>{" "}
            {recover.data.summary}
          </p>
        ) : null}
        {recover.data?.ready && !device.isError ? (
          <p className="sr-only" aria-live="polite">
            Device is ready.
          </p>
        ) : null}

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
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            {device.data.status !== "needs-attention" ? (
              <DeviceLivePreview
                platform={device.data.platform}
                canvas={canvas}
                onCanvasChange={onCanvasChange}
                target={target.data ?? undefined}
                browserContext={browserContext}
                status={liveStatus}
                issue={
                  inputIssue?.message ??
                  liveIssue ??
                  (recover.error ? "Couldn’t reconnect to the device." : undefined)
                }
                issueAction={
                  inputIssue ? (
                    inputIssue.reconnect ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => recover.mutate()}
                        disabled={recover.isPending}
                      >
                        {recover.isPending ? "Reconnecting…" : "Reconnect"}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onClick={() => setInputIssue(undefined)}>
                        Dismiss
                      </Button>
                    )
                  ) : recover.error ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => recover.mutate()}
                      disabled={recover.isPending}
                    >
                      {recover.isPending ? "Reconnecting…" : "Reconnect"}
                    </Button>
                  ) : undefined
                }
                busy={liveBusy || reconnecting}
                reconnect={() => {
                  recover.mutate();
                }}
                send={send}
                pending={target.isPending}
                reconnecting={reconnecting}
                talkBack={
                  device.data?.platform === "browser"
                    ? {
                        ...talkBack,
                        inspection: {
                          overlayItems: browserAccessibility?.review.items ?? [],
                          bounds: browserAccessibility?.bounds,
                        },
                      }
                    : talkBack
                }
              />
            ) : (
              <RecoveryState
                layout="centered"
                className="min-h-64"
                title={device.data.avdName ? "Emulator is not running" : "Device needs attention"}
                detail="Connect the device to see its screen here."
                action={
                  <Button
                    onClick={() => (device.data?.avdName ? boot.mutate() : recover.mutate())}
                    disabled={boot.isPending || recover.isPending}
                  >
                    {device.data.avdName
                      ? boot.isPending
                        ? "Starting…"
                        : "Start emulator"
                      : recover.isPending
                        ? "Reconnecting…"
                        : "Reconnect"}
                  </Button>
                }
              />
            )}
            {showDeviceControls ? (
              <SheetContent className="gap-0 overflow-hidden data-[side=right]:w-full sm:data-[side=right]:w-96 motion-reduce:transition-none">
                <SheetHeader className="pr-12">
                  <SheetTitle>Open an app</SheetTitle>
                  <SheetDescription>
                    {device.data.platform === "android"
                      ? appLanguagesSupported
                        ? "Choose an app and its supported language."
                        : "Choose an app to open on this device."
                      : "Open an app by name or bundle identifier."}
                  </SheetDescription>
                </SheetHeader>
                <aside
                  className="grid min-h-0 min-w-0 content-start gap-5 overflow-y-auto px-4 pb-6"
                  aria-label="Device controls"
                  tabIndex={0}
                >
                  {appControlsSupported ? (
                    <section className="grid gap-4" aria-label="App controls">
                      <div className="grid gap-4">
                        <div className="grid min-w-0 gap-2 text-sm [&>label]:font-medium">
                          <InstalledAppChoice
                            label="App"
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
                        </div>
                        {appIdentifier && appLanguagesSupported ? (
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
                                <p className="text-sm text-success-foreground" role="status">
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
                  {device.data.platform === "ios" &&
                  device.data.runnable &&
                  deviceService.launchApp ? (
                    <IOSAppLaunchForm
                      deviceName={device.data.name}
                      identifier={iosAppDraft}
                      relaunch={iosRelaunch}
                      pending={iosAppLaunch.isPending}
                      error={iosAppLaunch.error}
                      launched={iosAppLaunch.data}
                      onIdentifierChange={(value) => {
                        if (iosAppLaunch.isPending) return;
                        setIosAppDraft(value);
                        iosAppLaunch.reset();
                      }}
                      onRelaunchChange={setIosRelaunch}
                      onLaunch={() => {
                        if (!iosAppDraft.trim() || iosAppLaunch.isPending) return;
                        forgetNativeAppLaunch(deviceService, device.data!.serial);
                        iosAppLaunch.mutate({
                          service: deviceService,
                          deviceId,
                          serial: device.data!.serial,
                          app: iosAppDraft.trim(),
                          relaunch: iosRelaunch,
                        });
                      }}
                    />
                  ) : null}
                </aside>
              </SheetContent>
            ) : null}
          </div>
        ) : null}
      </WorkbenchPage>
    </Sheet>
  );
}

function friendlyLiveIssue(message: string): string {
  if (/failed to fetch|networkerror|load failed|browser device is not open/iu.test(message)) {
    return "Relay lost the connection. Reconnect to restore the live view.";
  }
  if (/locked|unlock|view only/iu.test(message)) return "Unlock the device, then reconnect.";
  if (/packet|transport|codec|decode|base64|operation|targetid/iu.test(message)) {
    return "Relay could not show the live view. Keep the device connected, then reconnect.";
  }
  return message;
}
