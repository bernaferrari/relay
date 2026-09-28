import { NewTestDraftDialog } from "./new-test-draft-dialog";
import { NewTestDetailedSetup } from "./new-test-detailed-setup";
import {
  NEW_TEST_DRAFT_KEY,
  friendlyPreviewIssue,
  readNewTestDraft,
  websiteAccounts,
} from "./new-test-setup-helpers";
import { BrowserSetup, startManagedBrowser } from "./new-test-browser-setup";
import { AuthoringWorkspace } from "./authoring-workspace";
import { AuthoringHeader } from "./authoring-header";
import { RecordingAppChoice } from "./recording-app-choice";
/** @jsxImportSource react */
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { CircleDot, Compass, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { recordingQueryKeys } from "../data/recording-queries";
import { WorkbenchPage } from "../components/page-layout";
import { EmptyState } from "../components/product-patterns";
import {
  clearWorkflowPointerIfCurrent,
  readWorkflowPointer,
  writeWorkflowPointer,
} from "../data/workflow-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";
import { ReviewRecordingPage } from "./review-recording-page";
import { LiveTargetCanvas } from "./live-target-canvas";
import { RecordingDeviceChoice } from "../components/recording-device-choice";
import { InstalledAppChoice } from "../components/installed-app-choice";
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
  const [originApplication, setOriginApplication] = useState(requestedOriginApplication ?? "");
  const [openedApplication, setOpenedApplication] = useState("");
  const [draftRestored, setDraftRestored] = useState(false);
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const previewSession = useRef<LiveTargetSession | undefined>(undefined);
  const [previewStatus, setPreviewStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [previewIssue, setPreviewIssue] = useState<string>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [browserUrl, setBrowserUrl] = useState("");
  const [newBrowserOpen, setNewBrowserOpen] = useState(false);
  const [creatingApp, setCreatingApp] = useState(false);
  const previousTargetId = useRef<string | undefined>(undefined);
  // Most Tests start from a website: ask for that first. A link that already
  // names an app, device, or map path opens the detailed setup instead.
  const [setupMode, setSetupMode] = useState<"website" | "detailed">(
    requestedAppId || requestedTargetId || startsFromPath ? "detailed" : "website",
  );
  const [quickProgress, setQuickProgress] = useState<string>();
  const accounts = useQuery({
    queryKey: ["new-test", "browser-accounts"],
    queryFn: () => appResourcesService.listBrowserAccounts(),
    staleTime: 30_000,
  });
  // The login last used per website, so the daily case is one click.
  const rememberedAccounts = useQuery({
    queryKey: ["new-test", "remembered-accounts", accounts.data?.length ?? 0],
    queryFn: async () => {
      const hosts = [
        ...new Set(
          (accounts.data ?? []).flatMap((item) =>
            (item.fixture.origins ?? []).map((origin) => websiteHost(origin)),
          ),
        ),
      ];
      const entries = await Promise.all(
        hosts.map(
          async (host) =>
            [
              host,
              await Promise.resolve(platform.storage.get(`relay:website-account:${host}`)),
            ] as const,
        ),
      );
      return Object.fromEntries(
        entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"),
      );
    },
    enabled: Boolean(accounts.data?.length),
  });
  const [quickError, setQuickError] = useState<string>();

  const apps = useQuery({
    queryKey: recordingQueryKeys.apps,
    queryFn: () => productService.listApps(),
  });
  const draft = useQuery({
    queryKey: ["recording", "new-test-draft"],
    queryFn: () => readNewTestDraft(platform),
    staleTime: Infinity,
  });
  const targets = useQuery({
    queryKey: recordingQueryKeys.targets,
    queryFn: async () => {
      const state = await productService.connect();
      return { ...state, targetOptions: await productService.presentTargets(state.targets) };
    },
    staleTime: 5_000,
    refetchInterval: (query) =>
      targetId && !query.state.data?.targetOptions.some((target) => target.targetId === targetId)
        ? 5_000
        : false,
  });
  const savedBrowsers = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 10_000,
    retry: false,
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
        (target) => target.targetId === draft.data?.targetId,
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
  ]);
  useEffect(() => {
    if (!draftRestored || targetId || !targets.data || newBrowserOpen) return;
    const available = targets.data.targetOptions;
    const preferred = available.length === 1 ? available[0] : undefined;
    if (preferred) setTargetId(preferred.targetId);
  }, [draftRestored, targetId, targets.data, newBrowserOpen]);
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
  useEffect(() => {
    if (previousTargetId.current && previousTargetId.current !== targetId) {
      setOriginApplication("");
      setOpenedApplication("");
    }
    previousTargetId.current = targetId;
  }, [targetId]);
  const reconnectPreview = useMutation({
    mutationFn: async (serial: string) => deviceService.recover(serial, "connect"),
    onSuccess: (_result, serial) => {
      if (serial === targetId) setPreviewAttempt((value) => value + 1);
    },
    onError: (_error, serial) => {
      if (serial === targetId)
        setPreviewIssue("Could not connect to this device. Keep it running, then try again.");
    },
  });
  useEffect(() => {
    if (search.view === "review") return;
    if (!selectedTarget || !previewCanvas.current || !productService.previewTarget) {
      setPreviewStatus("idle");
      setPreviewIssue(undefined);
      return;
    }
    let disposed = false;
    let unmount: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let session: LiveTargetSession | undefined;
    setPreviewIssue(undefined);
    setPreviewStatus("connecting");
    setBrowserContext(undefined);
    void productService
      .previewTarget(selectedTarget)
      .then((next) => {
        if (disposed || !previewCanvas.current) return next.close();
        session = next;
        previewSession.current = next;
        unsubscribe = next.subscribe((state) => {
          setPreviewStatus(state.status);
          setPreviewIssue(state.issue ? friendlyPreviewIssue(state.issue) : undefined);
          setBrowserContext(state.browserContext);
        });
        unmount = next.mount(previewCanvas.current);
      })
      .catch(() => {
        if (!disposed) {
          setPreviewStatus("degraded");
          setPreviewIssue("The device preview could not connect. Try again to reopen it.");
        }
      });
    return () => {
      disposed = true;
      unmount?.();
      unsubscribe?.();
      if (previewSession.current === session) previewSession.current = undefined;
      session?.close();
    };
  }, [previewAttempt, productService, search.view, selectedTarget?.targetId, setupMode]);

  async function sendPreview(input: Parameters<LiveTargetSession["input"]>[0]) {
    const session = previewSession.current;
    if (!session) {
      setPreviewIssue("The live view is still connecting.");
      return false;
    }
    setPreviewBusy(true);
    setPreviewIssue(undefined);
    try {
      await session.input(input);
      return true;
    } catch {
      setPreviewIssue(
        "The device did not accept that interaction. Try again to reopen the connection.",
      );
      return false;
    } finally {
      setPreviewBusy(false);
    }
  }

  const begin = useMutation({
    mutationFn: async (chosen?: {
      appId: string;
      targetId: string;
      title: string;
      authenticationFixtureId?: string;
    }) => {
      const suggestedName =
        chosen?.title ??
        (pathContext.data
          ? `${pathContext.data.fromTitle} to ${pathContext.data.toTitle ?? "Finish"}`
          : `${apps.data?.find((app) => app.id === appId)?.name ?? "New Test"} recording`);
      const state = await productService.begin({
        title: suggestedName,
        appMapId: chosen?.appId ?? appId,
        targetId: chosen?.targetId ?? targetId,
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
      const typedPath = new URL(url).pathname;
      const saved = savedBrowsers.data?.find(
        (space) =>
          websiteHost(space.startUrl) === host &&
          (typedPath === "/" || new URL(space.startUrl).pathname === typedPath),
      );
      // A saved login belongs to one browser; record in that browser, signed in.
      const browserTargetId = await startManagedBrowser(
        browserSpacesService,
        account?.targetId ?? saved?.id,
        url,
      );
      await Promise.resolve(
        platform.storage.set(`relay:website-account:${host}`, account?.reference ?? ""),
      );
      setQuickProgress("Finding where to save it…");
      const chosenApp = await appForWebsite(host, browserTargetId);
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.apps });
      setAppId(chosenApp);
      setTargetId(browserTargetId);
      setQuickProgress("Starting the recording…");
      await begin.mutateAsync({
        appId: chosenApp,
        targetId: browserTargetId,
        title: `Test on ${host}`,
        ...(account ? { authenticationFixtureId: account.reference } : {}),
      });
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
    if (!appId || !selectedTarget || creatingApp || begin.isPending) return;
    begin.mutate();
  }

  const loading = apps.isPending || activePointer.isPending;
  const noTargets = Boolean(targets.data && targets.data.targetOptions.length === 0);
  const setupOpen =
    !loading && !apps.isError && !targets.isError && !targets.data?.recovery && !blocksNewRecording;
  const formReady = Boolean(
    appId &&
    selectedTarget &&
    !begin.isPending &&
    !creatingApp &&
    !previewIssue &&
    !reconnectPreview.isPending &&
    (!originApplication || openedApplication === originApplication),
  );
  if (search.view === "review") {
    if (activePointer.isPending) return <PageLoading label="Opening the reviewed recording…" />;
    if (activePointer.data) return <ReviewRecordingPage recordingId={activePointer.data} />;
  }

  const startHint = !appId
    ? "Choose an app"
    : creatingApp
      ? "Finish creating your app"
      : previewIssue
        ? "Reconnect the preview before recording"
        : reconnectPreview.isPending
          ? "Reconnecting preview…"
          : !selectedTarget
            ? "Choose a Device or Browser"
            : begin.isPending
              ? "Starting…"
              : originApplication && openedApplication !== originApplication
                ? "Open the selected app first"
                : "Start recording";

  function chooseTarget(nextTargetId: string) {
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
            <Button nativeButton={false} render={<Link to="/tests" />} variant="ghost" size="sm">
              Cancel
            </Button>
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
        <RecordingProblem
          layout={setupOpen ? "compact" : "centered"}
          className={setupOpen ? undefined : "!mt-0 !max-w-none min-h-0 w-full flex-1"}
          error={apps.error ?? targets.error ?? pathContext.error}
          recovery={targets.data?.recovery}
          onRetry={() => {
            if (apps.isError) void apps.refetch();
            if (targets.isError || targets.data?.recovery) void targets.refetch();
            if (pathContext.isError) void pathContext.refetch();
          }}
          retrying={apps.isFetching || targets.isFetching || pathContext.isFetching}
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

        {setupMode === "website" && !loading && !blocksNewRecording ? (
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
            {...(requestedSite ? { initialAddress: requestedSite } : {})}
            {...(requestedAccount
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
            onUseDevice={() => setSetupMode("detailed")}
          />
        ) : null}
        {setupMode === "detailed" &&
        !loading &&
        !apps.isError &&
        !targets.isError &&
        !targets.data?.recovery &&
        !blocksNewRecording ? (
          <NewTestDetailedSetup
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
            onOpened={setOpenedApplication}
            formReady={formReady}
            startHint={startHint}
            beginPending={begin.isPending}
            submit={submit}
            browserContext={browserContext}
            previewIssue={previewIssue}
            reconnecting={reconnectPreview.isPending}
            onReconnect={(id) => reconnectPreview.mutate(id)}
            onRetryPreview={() => setPreviewAttempt((value) => value + 1)}
            previewCanvas={previewCanvas}
            previewStatus={previewStatus}
            previewBusy={previewBusy}
            sendPreview={sendPreview}
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
