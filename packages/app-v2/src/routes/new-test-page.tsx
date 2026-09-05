/** @jsxImportSource react */
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Card, CardContent } from "@relay/ui-react/components/card";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, CircleDot, Globe, Play, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import type { BrowserSpacesProductService } from "../data/browser-spaces-product-service";
import { recordingQueryKeys } from "../data/recording-queries";
import { SelectField } from "../components/filter-select";
import { PageHeader, WorkbenchPage } from "../components/page-layout";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import {
  clearWorkflowPointerIfCurrent,
  readWorkflowPointer,
  writeWorkflowPointer,
} from "../data/workflow-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";
import { LiveTargetCanvas } from "./live-target-canvas";

const NEW_TEST_DRAFT_KEY = "newTestDraft";

export function NewTestPage() {
  const { mapService, platform, productService, browserSpacesService, queryClient } =
    useRouteContext({
      from: "__root__",
    });
  const rawSearch = useLocation({ select: (state) => state.search });
  const search = rawSearch as Readonly<Record<string, unknown>>;
  const requestedAppId = typeof search.app === "string" ? search.app : undefined;
  const requestedPathId = typeof search.path === "string" ? search.path : undefined;
  const requestedTargetId = typeof search.target === "string" ? search.target : undefined;
  const startsFromPath = search.view === "path" && Boolean(requestedAppId && requestedPathId);
  const navigate = useNavigate();
  const [fallbackAppId, setAppId] = useState(requestedAppId ?? "");
  const appId = requestedAppId ?? fallbackAppId;
  const [targetId, setTargetId] = useState(requestedTargetId ?? "");
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const previewSession = useRef<LiveTargetSession | undefined>(undefined);
  const [previewStatus, setPreviewStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [previewIssue, setPreviewIssue] = useState<string>();
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const [browserUrl, setBrowserUrl] = useState("");
  const [newBrowserOpen, setNewBrowserOpen] = useState(false);

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
  });
  const savedBrowsers = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: async () => {
      try {
        return await browserSpacesService.listSpaces();
      } catch {
        return [];
      }
    },
    staleTime: 10_000,
    retry: false,
  });
  async function adoptBrowser(targetId: string) {
    setTargetId(targetId);
    await queryClient.invalidateQueries({ queryKey: recordingQueryKeys.targets });
    await targets.refetch();
  }
  const startBrowser = useMutation({
    mutationFn: async (spaceId?: string) =>
      startManagedBrowser(browserSpacesService, spaceId, browserUrl),
    onSuccess: async (nextTargetId) => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      await adoptBrowser(nextTargetId);
    },
  });
  useEffect(() => {
    if (!appId && apps.data?.length === 1) setAppId(apps.data[0]!.id);
  }, [appId, apps.data]);
  useEffect(() => {
    if (!targetId && targets.data?.targetOptions.length === 1) {
      setTargetId(targets.data.targetOptions[0]!.targetId);
    }
  }, [targetId, targets.data?.targetOptions]);
  useEffect(() => {
    if (!draft.data) return;
    if (!requestedAppId && !appId && draft.data.appId) setAppId(draft.data.appId);
    if (!requestedTargetId && !targetId && draft.data.targetId) setTargetId(draft.data.targetId);
  }, [appId, draft.data, requestedAppId, requestedTargetId, targetId]);
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
    if (!draft.isFetched) return;
    void Promise.resolve(
      platform.storage.set(NEW_TEST_DRAFT_KEY, JSON.stringify({ appId, targetId })),
    );
  }, [appId, draft.isFetched, platform, targetId]);

  const selectedTarget = targets.data?.targetOptions.find((target) => target.targetId === targetId);
  useEffect(() => {
    if (!selectedTarget || !previewCanvas.current || !productService.previewTarget) {
      setPreviewStatus("idle");
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
          setPreviewIssue("Relay could not open the live view. Check the target, then reconnect.");
        }
      });
    return () => {
      disposed = true;
      unmount?.();
      unsubscribe?.();
      if (previewSession.current === session) previewSession.current = undefined;
      session?.close();
    };
  }, [previewAttempt, productService, selectedTarget?.targetId]);

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
      setPreviewIssue("Relay could not send that interaction. Reconnect, then try again.");
      return false;
    } finally {
      setPreviewBusy(false);
    }
  }

  const begin = useMutation({
    mutationFn: async () => {
      const suggestedName = pathContext.data
        ? `${pathContext.data.fromTitle} to ${pathContext.data.toTitle ?? "Finish"}`
        : "Untitled recording";
      const state = await productService.begin({
        title: suggestedName,
        appMapId: appId,
        targetId,
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!appId || !targetId || previewStatus !== "streaming" || begin.isPending) return;
    begin.mutate();
  }

  const loading = apps.isPending || activePointer.isPending;
  const noApps = apps.data?.length === 0;
  const noTargets = Boolean(targets.data && targets.data.targetOptions.length === 0);
  const setupOpen =
    !loading && !apps.isError && !targets.isError && !targets.data?.recovery && !activePointer.data;
  const formReady = Boolean(appId && targetId && previewStatus === "streaming" && !begin.isPending);
  const startHint = !appId
    ? "Choose an app"
    : !targetId
      ? "Connect a device"
      : previewStatus !== "streaming"
        ? "Wait for the live view"
        : begin.isPending
          ? "Starting…"
          : "Start recording";

  function chooseApp(nextAppId: string) {
    setAppId(nextAppId);
    void navigate({
      to: "/tests/new",
      replace: true,
      search: { app: nextAppId, ...(targetId ? { target: targetId } : {}) },
    });
  }

  return (
    <WorkbenchPage className="relay-new-test-page flex min-h-0 flex-col">
      <form id="new-test-form" className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
        <Breadcrumbs items={[{ label: "Tests", to: "/tests" }, { label: "Record" }]} />
        <PageHeader
          context="Tests"
          title="Record a Test"
          description="Choose an app and a device, then start."
          actions={
            setupOpen ? (
              <>
                <Button nativeButton={false} render={<Link to="/tests" />} variant="ghost">
                  Cancel
                </Button>
                {selectedTarget ? (
                  <Button type="submit" disabled={!formReady} title={startHint}>
                    <Play aria-hidden="true" />
                    {begin.isPending ? "Starting…" : "Start recording"}
                  </Button>
                ) : null}
              </>
            ) : null
          }
        />

        {activePointer.data ? (
          <Alert className="relay-resume-recording max-w-3xl" variant="default">
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
          error={apps.error ?? targets.error ?? pathContext.error ?? begin.error}
          recovery={begin.data?.recovery ?? targets.data?.recovery}
          onRetry={
            begin.data?.recovery && activePointer.data
              ? undefined
              : () => {
                  void apps.refetch();
                  void targets.refetch();
                }
          }
          retrying={apps.isFetching || targets.isFetching}
        />

        {!loading &&
        !apps.isError &&
        !targets.isError &&
        !targets.data?.recovery &&
        !activePointer.data ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4">
            {startsFromPath ? (
              <p className="text-sm text-muted-foreground">
                Starting from{" "}
                <strong className="font-medium text-foreground">
                  {pathContext.data
                    ? `${pathContext.data.fromTitle} → ${pathContext.data.toTitle ?? "Finish"}`
                    : "the selected path"}
                </strong>
              </p>
            ) : null}
            <div className="flex flex-wrap items-end gap-3">
              <SelectField
                label="App"
                value={appId}
                placeholder="Choose an app"
                className="min-w-[200px] max-w-xs flex-1"
                options={(apps.data ?? []).map((app) => ({ value: app.id, label: app.name }))}
                onValueChange={chooseApp}
              />
              {noTargets ? null : (
                <SelectField
                  label="Record on"
                  value={targetId}
                  placeholder={targets.isPending ? "Finding devices…" : "Choose a device"}
                  className="min-w-[220px] max-w-sm flex-1"
                  options={(targets.data?.targetOptions ?? []).map((target) => {
                    const label = targetLabel(target);
                    return {
                      value: target.targetId,
                      label: label.detail ? `${label.title} · ${label.detail}` : label.title,
                    };
                  })}
                  onValueChange={setTargetId}
                />
              )}
            </div>

            <Card className="relay-prerecord-workspace flex min-h-[360px] flex-1">
              <CardContent className="flex flex-1 flex-col p-4">
                {selectedTarget ? (
                  <section className="grid min-h-0 flex-1 gap-3" aria-labelledby="prerecord-title">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <h2 id="prerecord-title" className="text-sm font-semibold">
                          Live preview
                        </h2>
                        <p className="text-sm text-muted-foreground">
                          Nothing is recorded yet. Get to the starting screen, then start.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewAttempt((value) => value + 1)}
                      >
                        <RotateCcw aria-hidden="true" /> Reconnect
                      </Button>
                    </div>
                    <LiveTargetCanvas
                      canvasRef={previewCanvas}
                      status={previewStatus}
                      issue={previewIssue}
                      busy={previewBusy}
                      targetTitle={targetLabel(selectedTarget).title}
                      targetDetail={targetLabel(selectedTarget).detail}
                      browserContext={browserContext}
                      send={sendPreview}
                      recording={false}
                    />
                  </section>
                ) : noApps ? (
                  <EmptyState
                    title="Add an app first"
                    detail="Relay needs an app so this Test has a home."
                    action={
                      <Button nativeButton={false} render={<Link to="/apps" />}>
                        Add an app
                      </Button>
                    }
                  />
                ) : noTargets ? (
                  <BrowserSetup
                    browsers={savedBrowsers.data ?? []}
                    browserUrl={browserUrl}
                    newBrowserOpen={newBrowserOpen || !(savedBrowsers.data?.length ?? 0)}
                    pending={startBrowser.isPending}
                    checking={targets.isFetching}
                    error={startBrowser.error}
                    onBrowserUrlChange={setBrowserUrl}
                    onToggleNewBrowser={() => setNewBrowserOpen((open) => !open)}
                    onStart={(spaceId) => startBrowser.mutate(spaceId)}
                    onCheckAgain={() => void targets.refetch()}
                  />
                ) : (
                  <EmptyState
                    title="Choose where to record"
                    detail="Pick a device or browser above. The live view will open here."
                  />
                )}
              </CardContent>
            </Card>
          </div>
        ) : null}
      </form>
    </WorkbenchPage>
  );
}

function BrowserSetup({
  browsers,
  browserUrl,
  newBrowserOpen,
  pending,
  checking,
  error,
  onBrowserUrlChange,
  onToggleNewBrowser,
  onStart,
  onCheckAgain,
}: {
  browsers: readonly { id: string; name: string; startUrl: string }[];
  browserUrl: string;
  newBrowserOpen: boolean;
  pending: boolean;
  checking: boolean;
  error: unknown;
  onBrowserUrlChange(value: string): void;
  onToggleNewBrowser(): void;
  onStart(spaceId?: string): void;
  onCheckAgain(): void;
}) {
  return (
    <div className="grid flex-1 place-items-center px-4 py-8">
      <div className="grid w-full max-w-md gap-5">
        <div className="grid gap-1">
          <h2 className="text-base font-semibold tracking-tight">
            {browsers.length ? "Choose a browser" : "Start a browser to record"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {browsers.length
              ? "Open one of your browsers, or start a new one."
              : "Enter a website. The live view will open here."}
          </p>
        </div>
        {browsers.length ? (
          <ul className="overflow-hidden rounded-xl border border-border bg-background">
            {browsers.map((space) => (
              <li key={space.id} className="border-b border-border last:border-b-0">
                <button
                  type="button"
                  className="flex min-h-14 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:opacity-60"
                  disabled={pending}
                  onClick={() => onStart(space.id)}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <Globe className="size-4" aria-hidden="true" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm font-medium text-foreground">
                      {space.name}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {websiteHost(space.startUrl)}
                    </span>
                  </span>
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden="true"
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {browsers.length && !newBrowserOpen ? (
          <button
            type="button"
            className="justify-self-start text-sm font-medium text-foreground underline-offset-4 hover:underline"
            onClick={onToggleNewBrowser}
          >
            New website
          </button>
        ) : (
          <div className="grid gap-2">
            {browsers.length ? (
              <Label htmlFor="record-browser-url">New website</Label>
            ) : (
              <Label htmlFor="record-browser-url">Website</Label>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="record-browser-url"
                type="url"
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="off"
                placeholder="https://app.example.com"
                value={browserUrl}
                onChange={(event) => onBrowserUrlChange(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  if (normalizeWebsite(browserUrl)) onStart();
                }}
              />
              <Button
                type="button"
                className="sm:w-auto"
                disabled={!normalizeWebsite(browserUrl) || pending}
                onClick={() => onStart()}
              >
                {pending ? "Starting…" : "Start a browser"}
              </Button>
            </div>
          </div>
        )}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {friendlyBrowserError(error)}
          </p>
        ) : null}
        <button
          type="button"
          className="justify-self-start text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          disabled={checking}
          onClick={onCheckAgain}
        >
          {checking ? "Checking for a phone…" : "Using a phone? Check again"}
        </button>
      </div>
    </div>
  );
}

async function startManagedBrowser(
  service: BrowserSpacesProductService,
  spaceId: string | undefined,
  browserUrl: string,
): Promise<string> {
  const open =
    typeof service.openSpace === "function" ? service.openSpace.bind(service) : undefined;
  const create =
    typeof service.createSpace === "function" ? service.createSpace.bind(service) : undefined;
  if (spaceId) {
    if (open) return (await open(spaceId)).targetId;
    return spaceId;
  }
  if (!create) throw new TypeError("Relay could not start a browser in this host.");
  const startUrl = normalizeWebsite(browserUrl);
  const created = await create({
    name: websiteName(startUrl),
    startUrl,
    profileRetention: "ephemeral",
  });
  if (open) return (await open(created.id)).targetId;
  return created.id;
}

function friendlyBrowserError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (/is not a function|cannot read|undefined/iu.test(message)) {
    return "Relay could not open that browser. Try again, or start a new one.";
  }
  if (message.trim()) return message;
  return "Relay could not start a browser.";
}

function websiteHost(url: string): string {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
}

function normalizeWebsite(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed.includes("://") ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    if (!url.hostname) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function websiteName(url: string): string {
  try {
    return new URL(url).hostname || "Browser";
  } catch {
    return "Browser";
  }
}

function friendlyPreviewIssue(message: string): string {
  if (/view only|locked|unlock/iu.test(message)) {
    return "Keep the target connected and unlocked, then reconnect.";
  }
  if (/packet|transport|codec|decode|base64|operation|targetid/iu.test(message)) {
    return "Relay could not show the live view. Check the target, then reconnect.";
  }
  return message;
}

async function readNewTestDraft(platform: {
  storage: { get(key: string): string | null | Promise<string | null> };
}): Promise<{
  appId?: string;
  targetId?: string;
}> {
  try {
    const stored = await Promise.resolve(platform.storage.get(NEW_TEST_DRAFT_KEY));
    const parsed = JSON.parse(stored ?? "null") as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const value = parsed as Record<string, unknown>;
    return {
      ...(typeof value.appId === "string" ? { appId: value.appId } : {}),
      ...(typeof value.targetId === "string" ? { targetId: value.targetId } : {}),
    };
  } catch {
    return {};
  }
}
