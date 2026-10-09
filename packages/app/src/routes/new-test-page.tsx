import { useNewTestPreviewSession } from "./use-new-test-preview-session";
import { createRecordingSetupAdmission } from "../data/recording-setup-admission";
import { useNativeAppStartContext } from "./use-native-app-start-context";
import { useNewTestPreviewInput } from "./use-new-test-preview-input";
import { useNewTestSetup, useNewTestTargets } from "./use-new-test-setup";
import { NewTestSetupProblem, useNewTestDeviceRecovery } from "./use-new-test-device-recovery";
import { NewTestDraftDialog } from "./new-test-draft-dialog";
import { NewTestDetailedSetup } from "./new-test-detailed-setup";
import { NewTestTargetMode } from "./new-test-target-mode";
import { useWebsiteAccountPreference } from "./use-website-account-preference";
import {
  NEW_TEST_DRAFT_KEY,
  friendlyPreviewIssue,
  readNewTestDraft,
  recordingStartHint,
  websiteAccounts,
} from "./new-test-setup-helpers";
import { startManagedBrowser } from "./new-test-browser-setup";
import { AuthoringHeader } from "./authoring-header";
/** @jsxImportSource react */
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { CircleDot } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { recordingQueryKeys } from "../data/recording-queries";
import { WorkbenchPage } from "../components/page-layout";
import {
  clearWorkflowPointerIfCurrent,
  readWorkflowPointer,
  writeWorkflowPointer,
} from "../data/workflow-pointer";
import { PageLoading, RecordingProblem } from "./recording-shared";
import { ReviewRecordingPage } from "./review-recording-page";
import {
  NewTestQuickStart,
  recentWebsites,
  websiteHost,
  type WebsiteAccount,
} from "./new-test-quick-start";

export function NewTestPage() {
  const {
    mapService,
    appResourcesService,
    platform,
    productService,
    browserSpacesService,
    deviceService,
    queryClient,
    catalogService,
  } = useRouteContext({
    from: "__root__",
  });
  const rawSearch = useLocation({ select: (state) => state.search });
  const search = rawSearch as Readonly<Record<string, unknown>>;
  const requestedAppId = typeof search.app === "string" ? search.app : undefined;
  const requestedPathId = typeof search.path === "string" ? search.path : undefined;
  const requestedTargetId = typeof search.target === "string" ? search.target : undefined;
  // "New test as this account" from Accounts: the website and the login to use.
  const requestedSite = typeof search.site === "string" ? search.site : undefined;
  const requestedAccount = typeof search.account === "string" ? search.account : undefined;
  const requestedOriginApplication =
    typeof search.originApplication === "string" ? search.originApplication : undefined;
  const startsFromPath = search.view === "path" && Boolean(requestedAppId && requestedPathId);
  const navigate = useNavigate();
  const [fallbackAppId, setAppId] = useState(requestedAppId ?? "");
  const appId = requestedAppId ?? fallbackAppId;
  const [targetId, setTargetId] = useState(requestedTargetId ?? "");
  const [draftRestored, setDraftRestored] = useState(false);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const previewSession = useRef<LiveTargetSession | undefined>(undefined);
  const [previewStatus, setPreviewStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [previewIssue, setPreviewIssue] = useState<string>();
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [newBrowserOpen, setNewBrowserOpen] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const [startup] = useState(createRecordingSetupAdmission);
  const [quickProgress, setQuickProgress] = useState<string>();
  const [wantsDevice, setWantsDevice] = useState(
    search.targetKind === "device" ||
      Boolean(requestedOriginApplication && !/^https?:\/\//iu.test(requestedOriginApplication)),
  );
  const accounts = useQuery({
    queryKey: ["new-test", "browser-accounts"],
    queryFn: () => appResourcesService.listBrowserAccounts(),
    staleTime: 30_000,
  });
  const rememberedAccounts = useWebsiteAccountPreference(platform, accounts.data);
  const [quickError, setQuickError] = useState<string>();

  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
  });
  const app = apps.data?.find((app) => app.id === appId);
  const draft = useQuery({
    queryKey: ["recording", "new-test-draft"],
    queryFn: () => readNewTestDraft(platform),
    staleTime: Infinity,
  });
  const savedBrowsers = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 10_000,
    retry: false,
  });
  const { setupMode, setSetupMode, browserUrl, setBrowserUrl } = useNewTestSetup({
    app,
    requestedAppId,
    requestedTargetId,
    startsFromPath,
    requestedSite,
    spaces: savedBrowsers.data,
  });
  const deviceOnly =
    wantsDevice ||
    (setupMode === "detailed" &&
      !requestedTargetId &&
      (app?.platform === "ios" || app?.platform === "android"));
  const targetKind =
    deviceOnly || app?.platform === "ios" || app?.platform === "android"
      ? "device"
      : !requestedTargetId || app?.platform === "web"
        ? "browser"
        : undefined;
  const targets = useNewTestTargets({
    service: productService,
    enabled: apps.isSuccess && setupMode === "detailed",
    targetKind,
    requestedTargetId,
    selectedTargetId: targetId,
  });
  async function adoptBrowser(targetId: string) {
    chooseTarget(targetId);
    setNewBrowserOpen(false);
    await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.targets });
    await targets.refetch();
  }
  const browserStartInFlight = useRef(false);
  const startBrowser = useMutation({
    mutationFn: async (spaceId?: string) =>
      startManagedBrowser(browserSpacesService, spaceId, browserUrl),
    onSuccess: async (nextTargetId) => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      await adoptBrowser(nextTargetId);
    },
  });
  function requestBrowserStart(spaceId?: string) {
    if (browserStartInFlight.current) return;
    browserStartInFlight.current = true;
    void startBrowser
      .mutateAsync(spaceId)
      .catch(() => undefined)
      .finally(() => {
        browserStartInFlight.current = false;
      });
  }
  useEffect(() => {
    if (!appId && apps.data?.length === 1) setAppId(apps.data[0]!.id);
  }, [appId, apps.data]);
  useEffect(() => {
    if (draftRestored || !draft.isFetched || !targets.isSuccess) return;
    if (!requestedAppId && !appId && draft.data?.appId) setAppId(draft.data.appId);
    // A remembered device is a convenience, not an explicit request to wait
    // for hardware that may no longer be connected.
    if (!requestedTargetId && !targetId) {
      const saved = targets.data.targetOptions.find(
        (target) =>
          target.targetId === draft.data?.targetId && (!deviceOnly || target.kind === "device"),
      );
      if (saved) setTargetId(saved.targetId);
    }
    setDraftRestored(true);
  }, [
    appId,
    draft.data,
    draft.isFetched,
    draftRestored,
    requestedAppId,
    requestedTargetId,
    targetId,
    targets.data,
    targets.isSuccess,
    deviceOnly,
  ]);
  useEffect(() => {
    if (!draftRestored || targetId || !targets.data || newBrowserOpen) return;
    const available = targets.data.targetOptions.filter(
      (target) => !deviceOnly || target.kind === "device",
    );
    const preferred = available.length === 1 ? available[0] : undefined;
    if (preferred) setTargetId(preferred.targetId);
  }, [draftRestored, targetId, targets.data, newBrowserOpen, deviceOnly]);
  const activePointer = useQuery({
    queryKey: recordingQueryKeys.reconciledPointer,
    queryFn: async () => {
      const workflowId = await readWorkflowPointer(platform);
      if (!workflowId) return null;
      const current = await productService.inspect(workflowId);
      const stage = current.snapshot?.stage;
      if (!current.recovery && (stage === "cancelled" || stage === "committed")) {
        await clearWorkflowPointerIfCurrent(platform, workflowId);
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, null);
        return null;
      }
      return workflowId;
    },
    staleTime: Infinity,
  });
  const activeRecording = useQuery({
    queryKey: recordingQueryKeys.workflow(activePointer.data ?? ""),
    queryFn: () => productService.inspect(activePointer.data!),
    enabled: Boolean(activePointer.data),
  });
  const blocksNewRecording = Boolean(
    activePointer.data && activeRecording.data?.snapshot?.stage !== "reviewing",
  );
  const pathContext = useQuery({
    queryKey: ["map", requestedAppId, "recording-path", requestedPathId],
    queryFn: async () => {
      const map = await mapService.get(requestedAppId!);
      return map.paths.find((path) => path.id === requestedPathId) ?? null;
    },
    enabled: startsFromPath,
    staleTime: 15_000,
  });

  useEffect(() => {
    if (!draftRestored) return;
    void Promise.resolve(
      platform.storage.set(NEW_TEST_DRAFT_KEY, JSON.stringify({ appId, targetId })),
    );
  }, [appId, draftRestored, platform, targetId]);

  const selectedTarget = targets.data?.targetOptions.find((target) => target.targetId === targetId);
  const { originApplication, setOriginApplication, openedApplication, markOpened } =
    useNativeAppStartContext({
      service: deviceService,
      target: selectedTarget,
      targetId,
      requestedOriginApplication,
    });
  const reconnectPreview = useNewTestDeviceRecovery({
    deviceService,
    targetId,
    admission: startup,
    refetchTargets: () => targets.refetch(),
    onRecovered: () => setPreviewAttempt((value) => value + 1),
    onError: () =>
      setPreviewIssue("Could not connect to this device. Keep it running, then try again."),
  });
  useNewTestPreviewSession({
    target: selectedTarget,
    canvas: previewCanvas,
    sessionRef: previewSession,
    service: productService,
    attempt: previewAttempt,
    mode: setupMode,
    enabled: search.view !== "review",
    onSnapshot: (state) => {
      setPreviewStatus(state.status);
      setPreviewIssue(
        state.issue
          ? friendlyPreviewIssue(state.issue)
          : state.status === "offline" || state.status === "closed" || state.status === "degraded"
            ? "The live preview stopped. Reopen it to continue."
            : undefined,
      );
      setBrowserContext(state.browserContext);
    },
  });
  function openedApp(application: string) {
    markOpened(application);
    if (!application) return;
    // Launch succeeded; retain input uncertainty while reopening observation only.
    setPreviewStatus("connecting");
    setPreviewIssue(undefined);
    setPreviewAttempt((value) => value + 1);
  }

  const previewInput = useNewTestPreviewInput({
    target: selectedTarget,
    session: previewSession,
    storage: platform.storage,
    service: productService,
    attempt: previewAttempt,
  });

  const begin = useMutation({
    mutationFn: async (chosen?: {
      appId: string;
      targetId: string;
      targetKind?: "device" | "browser";
      title: string;
      authenticationFixtureId?: string;
    }) => {
      const recordingTargetKind = chosen?.targetKind ?? selectedTarget?.kind;
      const suggestedName =
        chosen?.title ??
        (pathContext.data
          ? `${pathContext.data.fromTitle} to ${pathContext.data.toTitle ?? "Finish"}`
          : `${apps.data?.find((app) => app.id === appId)?.name ?? "New Test"} recording`);
      const state = await productService.begin({
        title: suggestedName,
        appMapId: chosen?.appId ?? appId,
        targetId: chosen?.targetId ?? targetId,
        ...(recordingTargetKind ? { targetKind: recordingTargetKind } : {}),
        ...(chosen?.authenticationFixtureId
          ? { authenticationFixtureId: chosen.authenticationFixtureId }
          : {}),
        ...(originApplication.trim() ? { originApplication: originApplication.trim() } : {}),
        ...(pathContext.data
          ? {
              sourceScreenId: pathContext.data.fromScreenId,
              pendingConnectionId: pathContext.data.id,
            }
          : {}),
      });
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (workflowId) {
        await writeWorkflowPointer(platform, workflowId);
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, workflowId);
        queryClient.setQueryData<string | null>(recordingQueryKeys.reconciledPointer, workflowId);
      } else if (!state.recovery) {
        throw new TypeError("Relay could not start this recording.");
      }
      return state;
    },
    onSuccess: async (state) => {
      if (state.recovery) return;
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (!workflowId) return;
      await Promise.resolve(platform.storage.remove?.(NEW_TEST_DRAFT_KEY));
      await navigate({ to: "/recordings/$recordingId", params: { recordingId: workflowId } });
    },
  });

  /** The app a website's Tests belong to: remembered, else where this browser's
   * runs were filed, else an app named after the site, else a new one. */
  async function appForWebsite(host: string, browserTargetId: string): Promise<string> {
    if (
      requestedAppId &&
      apps.data?.some(
        (app) => app.id === requestedAppId && app.platform !== "android" && app.platform !== "ios",
      )
    )
      return requestedAppId;
    const key = `relay:website-app:${host}`;
    const known = new Set((apps.data ?? []).map((app) => app.id));
    const remembered = await Promise.resolve(platform.storage.get(key));
    if (remembered && known.has(remembered)) return remembered;
    const runs = await catalogService.listRuns().catch(() => []);
    const fromRuns = runs.find(
      (run) =>
        run.executionIdentity?.deviceId === browserTargetId &&
        run.executionIdentity.appMapId &&
        known.has(run.executionIdentity.appMapId),
    )?.executionIdentity?.appMapId;
    const bare = host.replace(/^www\./, "").toLowerCase();
    const named = apps.data?.find((app) => app.name.toLowerCase().includes(bare))?.id;
    const appId = fromRuns ?? named ?? (await appResourcesService.createApp(bare)).id;
    await Promise.resolve(platform.storage.set(key, appId));
    return appId;
  }

  async function startWebsiteTest(url: string, account?: WebsiteAccount) {
    const host = websiteHost(url);
    setQuickError(undefined);
    try {
      if (!accounts.isSuccess || !savedBrowsers.isSuccess) {
        throw new Error(
          "Saved accounts or browsers are unavailable. Check the connection and retry.",
        );
      }
      setQuickProgress(account ? `Opening ${host} as ${account.name}…` : `Opening ${host}…`);
      // Guest starts with an empty browser: even an unsaved login can leave cookies
      // and a different current page in a previously used browser.
      const browserTargetId = await startManagedBrowser(
        browserSpacesService,
        account?.targetId,
        url,
      );
      setQuickProgress("Preparing recording…");
      await Promise.resolve(
        platform.storage.set(`relay:website-account:${host}`, account?.reference ?? ""),
      );
      const chosenApp = await appForWebsite(host, browserTargetId);
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.apps });
      setAppId(chosenApp);
      setTargetId(browserTargetId);
      await startup.run(() =>
        begin.mutateAsync({
          appId: chosenApp,
          targetId: browserTargetId,
          targetKind: "browser",
          title: `Test on ${host}`,
          ...(account ? { authenticationFixtureId: account.reference } : {}),
        }),
      );
    } catch (error) {
      setQuickError(
        error instanceof Error && error.message
          ? `Relay could not start ${host}: ${error.message}`
          : `Relay could not start ${host}. Try again.`,
      );
    } finally {
      setQuickProgress(undefined);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!formReady) return;
    void startup.run(() => begin.mutateAsync()).catch(() => undefined);
  }

  const loading = apps.isPending || activePointer.isPending;
  const noTargets = Boolean(targets.data && targets.data.targetOptions.length === 0);
  const targetError = setupMode === "detailed" ? targets.error : undefined;
  const targetRecovery = setupMode === "detailed" ? targets.data?.recovery : undefined;
  const nativeTargetRecovery = reconnectPreview.canReconnect(targetRecovery, targetKind);
  const setupOpen =
    !loading &&
    !apps.isError &&
    !targetError &&
    (!targetRecovery || nativeTargetRecovery) &&
    !blocksNewRecording;
  const formReady = Boolean(
    appId &&
    selectedTarget &&
    !targetError &&
    !targetRecovery &&
    !begin.isPending &&
    !creatingApp &&
    (previewStatus === "streaming" || !productService.previewTarget) &&
    !previewIssue &&
    !previewInput.busy &&
    !previewInput.issue &&
    !reconnectPreview.isPending &&
    (!originApplication || openedApplication === originApplication),
  );
  if (search.view === "review") {
    if (activePointer.isPending) return <PageLoading label="Opening the reviewed recording…" />;
    if (activePointer.data) return <ReviewRecordingPage recordingId={activePointer.data} />;
  }

  const startHint = recordingStartHint({
    app: Boolean(appId),
    creatingApp,
    inputFailed: Boolean(previewInput.failure),
    previewProblem: Boolean(previewIssue || previewInput.issue),
    checkingInput: previewInput.busy,
    reconnecting: reconnectPreview.isPending,
    target: Boolean(selectedTarget),
    starting: begin.isPending,
    appNotOpened: Boolean(originApplication && openedApplication !== originApplication),
  });

  function chooseTarget(nextTargetId: string) {
    if (!startup.mayEdit()) return;
    setTargetId(nextTargetId);
    void navigate({
      to: "/tests/new",
      replace: true,
      search: {
        ...search,
        target: nextTargetId || undefined,
      },
    });
  }

  function chooseApp(nextAppId: string) {
    if (!startup.mayEdit()) return;
    setAppId(nextAppId);
    void navigate({
      to: "/tests/new",
      replace: true,
      search: {
        app: nextAppId,
        ...(targetId ? { target: targetId } : {}),
        ...(originApplication ? { originApplication } : {}),
      },
    });
  }

  return (
    <WorkbenchPage className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-card !p-0">
      <div className="flex min-h-0 flex-1 flex-col">
        <AuthoringHeader
          phase="setup"
          title="New test"
          actions={
            <Button
              nativeButton={false}
              render={<Link to="/tests" search={{ app: requestedAppId }} />}
              variant="ghost"
              size="sm"
            >
              Cancel
            </Button>
          }
          center={
            !startsFromPath && !blocksNewRecording ? (
              <NewTestTargetMode
                device={
                  setupMode === "detailed" && (deviceOnly || selectedTarget?.kind === "device")
                }
                disabled={begin.isPending || reconnectPreview.isPending || Boolean(quickProgress)}
                onChange={(device) => {
                  if (!startup.mayEdit()) return;
                  setWantsDevice(device);
                  setSetupMode(device ? "detailed" : "website");
                  if (device && selectedTarget?.kind === "browser") chooseTarget("");
                }}
              />
            ) : null
          }
        />

        {blocksNewRecording ? (
          <Alert className="max-w-3xl" variant="default">
            <CircleDot />
            <AlertTitle>
              {begin.data?.recovery
                ? "Recording status needs review"
                : "A recording is already in progress"}
            </AlertTitle>
            <AlertDescription>
              <p>
                {begin.data?.recovery
                  ? "Open the saved recording to inspect its latest server state."
                  : "Continue the recording you started before creating another Test."}
              </p>
            </AlertDescription>
            <AlertAction>
              <Button
                size="sm"
                onClick={() =>
                  void navigate({
                    to: "/recordings/$recordingId",
                    params: { recordingId: activePointer.data! },
                  })
                }
              >
                Open recording
              </Button>
            </AlertAction>
          </Alert>
        ) : null}

        {loading ? <PageLoading label="Finding your apps and ready devices…" /> : null}
        <NewTestSetupProblem
          open={setupOpen}
          apps={apps}
          targets={targets}
          path={pathContext}
          detailed={setupMode === "detailed"}
          onReconnect={nativeTargetRecovery ? () => reconnectPreview.mutate(targetId) : undefined}
          reconnecting={reconnectPreview.isPending}
        />
        <RecordingProblem
          error={begin.error}
          recovery={begin.data?.recovery}
          action={
            begin.error || begin.data?.recovery?.code === "mutation-outcome-unknown" ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  void navigate(
                    activePointer.data
                      ? {
                          to: "/recordings/$recordingId",
                          params: { recordingId: activePointer.data },
                        }
                      : { to: "/sessions" },
                  )
                }
              >
                Check recording status
              </Button>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => begin.reset()}>
                Review recording setup
              </Button>
            )
          }
        />

        {setupMode === "website" && setupOpen ? (
          <NewTestQuickStart
            recent={recentWebsites(savedBrowsers.data ?? [])}
            setupStatus={
              accounts.isError || savedBrowsers.isError
                ? "unavailable"
                : accounts.isSuccess && savedBrowsers.isSuccess
                  ? "ready"
                  : "loading"
            }
            onRetrySetup={() => {
              void accounts.refetch();
              void savedBrowsers.refetch();
            }}
            manualAction={<NewTestDraftDialog />}
            {...(quickProgress ? { progress: quickProgress } : {})}
            {...(quickError ? { error: quickError } : {})}
            accountsFor={(url) => websiteAccounts(accounts.data ?? [], url)}
            rememberedAccount={(url) => rememberedAccounts.data?.[websiteHost(url)]}
            address={browserUrl}
            onAddressChange={setBrowserUrl}
            {...(requestedAccount !== undefined
              ? {
                  initialAccount:
                    (accounts.data ?? []).find(
                      (item) =>
                        item.fixture.id === requestedAccount ||
                        item.fixture.reference === requestedAccount,
                    )?.fixture.reference ?? requestedAccount,
                }
              : {})}
            onStart={(url, account) => void startWebsiteTest(url, account)}
          />
        ) : null}
        {setupMode === "detailed" && setupOpen ? (
          <NewTestDetailedSetup
            deviceOnly={deviceOnly}
            startsFromPath={startsFromPath}
            pathSummary={pathContext.data ?? undefined}
            apps={apps.data ?? []}
            appId={appId}
            chooseApp={chooseApp}
            onCreatingChange={setCreatingApp}
            createApp={(name) => appResourcesService.createApp(name)}
            onAppCreated={(app) => {
              queryClient.setQueryData(recordingQueryKeys.apps, [...(apps.data ?? []), app]);
              chooseApp(app.id);
              void queryClient.invalidateQueries({ queryKey: ["app-maps"] });
            }}
            deviceService={deviceService}
            targetId={targetId}
            targetOptions={targets.data?.targetOptions ?? []}
            onRefreshTargets={async () => {
              await targets.refetch();
            }}
            chooseTarget={chooseTarget}
            onNewBrowserOpen={setNewBrowserOpen}
            selectedTarget={selectedTarget}
            originApplication={originApplication}
            onOriginChange={setOriginApplication}
            onOpened={openedApp}
            formReady={formReady}
            startHint={startHint}
            admission={reconnectPreview.admission}
            submit={submit}
            browserContext={browserContext}
            previewIssue={previewInput.issue ?? previewIssue}
            reconnecting={reconnectPreview.isPending}
            onReconnect={(id) => reconnectPreview.mutate(id)}
            onRetryPreview={() => setPreviewAttempt((value) => value + 1)}
            previewCanvas={previewCanvas}
            previewStatus={previewStatus}
            previewBusy={previewInput.busy}
            sendPreview={previewInput.send}
            inputFailure={previewInput.failure}
            inputRecoveryBusy={previewInput.recoveryBusy}
            onObserveInput={previewInput.observe}
            onExploreUrl={(url) => void navigate({ to: "/goals", search: { url } })}
            targetFetching={targets.isFetching}
            browsersUnavailable={savedBrowsers.isError}
            savedBrowsers={savedBrowsers.data ?? []}
            onRetryBrowsers={() => void savedBrowsers.refetch()}
            noTargets={noTargets}
            newBrowserOpen={newBrowserOpen}
            browserUrl={browserUrl}
            browserStarting={startBrowser.isPending}
            browserStartError={startBrowser.error}
            onBrowserUrlChange={setBrowserUrl}
            onToggleNewBrowser={() => setNewBrowserOpen((open) => !open)}
            onBrowserStart={requestBrowserStart}
          />
        ) : null}
      </div>
    </WorkbenchPage>
  );
}
