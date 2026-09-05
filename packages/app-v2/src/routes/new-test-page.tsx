/** @jsxImportSource react */
import { ScrollArea } from "@relay/ui-react/components/scroll-area";
import { Alert, AlertAction, AlertDescription, AlertTitle } from "@relay/ui-react/components/alert";
import { Button } from "@relay/ui-react/components/button";
import { Field, FieldDescription, FieldLabel, FieldTitle } from "@relay/ui-react/components/field";
import { RadioGroup, RadioGroupItem } from "@relay/ui-react/components/radio-group";
import { Skeleton } from "@relay/ui-react/components/skeleton";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import {
  AppWindow,
  ArrowLeft,
  Check,
  CircleDot,
  Monitor,
  Play,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { recordingQueryKeys } from "../data/recording-queries";
import { newTestSetupContinuation } from "../data/setup-continuation";
import { LibraryPage } from "../components/page-layout";
import {
  clearWorkflowPointerIfCurrent,
  readWorkflowPointer,
  writeWorkflowPointer,
} from "../data/workflow-pointer";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";
import { LiveTargetCanvas } from "./live-target-canvas";

const NEW_TEST_DRAFT_KEY = "newTestDraft";

export function NewTestPage() {
  const { mapService, platform, productService, queryClient } = useRouteContext({
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
  const noTargets = targets.data?.targetOptions.length === 0;
  const formReady = Boolean(appId && targetId && previewStatus === "streaming" && !begin.isPending);
  const appChoices = (
    <RadioGroup
      className="relay-choice-group relay-choice-group--apps grid gap-2"
      name="app"
      value={appId}
      onValueChange={(app) => {
        setAppId(app);
        void navigate({
          to: "/tests/new",
          replace: true,
          search: { app, ...(targetId ? { target: targetId } : {}) },
        });
      }}
      aria-labelledby="test-app-title"
      required
    >
      {apps.data?.map((app) => (
        <FieldLabel
          key={app.id}
          className="flex min-h-14 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
        >
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0"
            aria-hidden="true"
          >
            <AppWindow />
          </span>
          <span className="grid min-w-0 flex-1 gap-0.5">
            <span className="truncate text-sm font-medium text-foreground">{app.name}</span>
            <span className="truncate text-xs leading-snug text-muted-foreground">Saved App</span>
          </span>
          <RadioGroupItem value={app.id} />
        </FieldLabel>
      ))}
    </RadioGroup>
  );

  return (
    <LibraryPage className="relay-new-test-page">
      <Link
        className="relay-back-link mb-3 mt-[-10px] inline-flex min-h-11 items-center gap-2 text-[13px] font-semibold text-[var(--text-weak)] focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2"
        to="/tests"
      >
        <ArrowLeft aria-hidden="true" /> Tests
      </Link>
      <header className="relay-page-header relay-new-test-header max-w-[650px]">
        <div>
          <h1 className="text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance] text-[clamp(24px,2.4vw,28px)] font-[650] leading-[1.15] tracking-[-0.03em] text-[var(--text-strong)] [text-wrap:balance]">
            Record a Test
          </h1>
          <p className="relay-page-description mt-2.5 max-w-[62ch] text-[15px] leading-[1.55] text-[var(--text-weak)]">
            Interact with your app to capture a Test. Review and name it when you are done.
          </p>
        </div>
      </header>

      {activePointer.data ? (
        <Alert className="relay-resume-recording mt-7 max-w-3xl" variant="default">
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
        <div className="relay-new-test-layout mt-7">
          <form className="relay-recording-form m-0 max-w-none gap-0" onSubmit={submit}>
            <div className="relay-new-test-card">
              <div className="relay-new-test-fields grid grid-cols-[260px_minmax(0,1fr)] items-start gap-6 min-[620px]:max-[1100px]:grid-cols-2 max-[619px]:grid-cols-1">
                {startsFromPath ? (
                  <Alert variant="default">
                    <Check />
                    <AlertTitle>
                      {pathContext.data
                        ? `${pathContext.data.fromTitle} → ${pathContext.data.toTitle ?? "Finish"}`
                        : "Verified path selected"}
                    </AlertTitle>
                    <AlertDescription>
                      Relay will use this known path as the starting context for the recording.
                    </AlertDescription>
                  </Alert>
                ) : null}
                <Field>
                  <div className="relay-choice-heading grid gap-0.5 px-px">
                    <FieldTitle
                      className="text-[13px] font-semibold text-foreground"
                      id="test-app-title"
                    >
                      App
                    </FieldTitle>
                    <FieldDescription className="mt-0">Where this Test belongs</FieldDescription>
                  </div>
                  {noApps ? (
                    <div className="relay-choice-empty grid gap-1.5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      <strong>No apps are available</strong>
                      <p>Add an app before recording a Test.</p>
                      <Link
                        className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                        to="/apps"
                      >
                        Manage apps
                      </Link>
                    </div>
                  ) : (apps.data?.length ?? 0) > 4 ? (
                    <ScrollArea className="relay-choice-scroll h-[196px] mr-[-7px]">
                      {appChoices}
                    </ScrollArea>
                  ) : (
                    appChoices
                  )}
                </Field>

                <Field>
                  <div className="relay-choice-heading grid gap-0.5 px-px">
                    <FieldTitle
                      className="text-[13px] font-semibold text-foreground"
                      id="test-target-title"
                    >
                      Device or browser
                    </FieldTitle>
                    <FieldDescription className="mt-0">Where Relay will record</FieldDescription>
                  </div>
                  {targets.isPending ? (
                    <div
                      className="relay-choice-group relay-choice-group--loading grid gap-2"
                      role="status"
                    >
                      <span className="relay-visually-hidden sr-only">
                        Finding ready devices and browsers…
                      </span>
                      <Skeleton className="min-h-[68px] rounded-[var(--radius-lg)]" />
                      <Skeleton className="min-h-[68px] rounded-[var(--radius-lg)]" />
                    </div>
                  ) : targets.isError ? (
                    <div className="relay-choice-empty grid gap-1.5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      <strong>Targets are not available yet</strong>
                      <p>Use Try again above after the local Relay service is running.</p>
                    </div>
                  ) : noTargets ? (
                    <div className="relay-choice-empty grid gap-1.5 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
                      <strong>Nothing is ready to record</strong>
                      <p>Connect a device or start a managed browser, then try again.</p>
                      <Link
                        className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                        to="/devices"
                        search={{ returnTo: newTestSetupContinuation(appId, targetId) }}
                      >
                        View devices
                      </Link>
                      <Link
                        className="relay-inline-link focus-visible:outline-2 focus-visible:outline-[var(--relay-focus-ring)] focus-visible:outline-offset-2 inline-flex min-h-11 items-center text-[var(--text-interactive-base)] font-semibold underline decoration-[color-mix(in_srgb,currentColor_45%,transparent)] underline-offset-[3px]"
                        to="/environments"
                        search={{ returnTo: newTestSetupContinuation(appId, targetId) }}
                      >
                        Manage browser Spaces
                      </Link>
                    </div>
                  ) : (
                    <RadioGroup
                      className="relay-choice-group grid gap-2"
                      name="target"
                      value={targetId}
                      onValueChange={setTargetId}
                      aria-labelledby="test-target-title"
                      required
                    >
                      {targets.data?.targetOptions.map((target) => {
                        const label = targetLabel(target);
                        return (
                          <FieldLabel
                            key={`${target.kind}:${target.targetId}`}
                            className="flex min-h-14 w-full min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                          >
                            <span
                              className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground [&_svg]:size-4 [&_svg]:shrink-0"
                              aria-hidden="true"
                            >
                              {target.kind === "browser" ? <Monitor /> : <Smartphone />}
                            </span>
                            <span className="grid min-w-0 flex-1 gap-0.5">
                              <span className="truncate text-sm font-medium text-foreground">
                                {label.title}
                              </span>
                              <span className="truncate text-xs leading-snug text-muted-foreground">
                                {label.detail}
                              </span>
                            </span>
                            <RadioGroupItem value={target.targetId} />
                          </FieldLabel>
                        );
                      })}
                    </RadioGroup>
                  )}
                </Field>

                {selectedTarget ? (
                  <section
                    className="relay-prerecord-workspace min-[1101px]:col-start-2 min-[1101px]:row-span-3 min-[1101px]:row-start-1 grid min-w-0 gap-4 rounded-xl border border-border bg-card p-5 max-[1100px]:col-span-full max-[520px]:p-3"
                    aria-labelledby="prerecord-title"
                  >
                    <div className="relay-prerecord-heading flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                          Live preview
                        </p>
                        <h2 id="prerecord-title" className="mt-1 text-base font-semibold">
                          Position your app
                        </h2>
                        <p className="mt-1 max-w-[45ch] text-sm leading-relaxed text-muted-foreground">
                          Nothing is recorded yet. Go to your starting screen, then start recording.
                        </p>
                      </div>
                      <div className="relay-prerecord-actions flex shrink-0 items-center gap-2">
                        <Button type="submit" variant="default" disabled={!formReady}>
                          <Play aria-hidden="true" />
                          {begin.isPending ? "Starting…" : "Start recording"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewAttempt((value) => value + 1)}
                        >
                          <RotateCcw aria-hidden="true" /> Reconnect
                        </Button>
                      </div>
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
                ) : null}
              </div>
              <div className="relay-form-actions mt-5 flex min-h-11 flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <Button nativeButton={false} render={<Link to="/tests" />} variant="ghost">
                  Cancel
                </Button>
                <span
                  className="relay-form-readiness ml-auto inline-flex min-w-0 items-center gap-1.5 text-[11px] text-[var(--text-weaker)]"
                  aria-live="polite"
                >
                  {formReady ? (
                    <>
                      <Check aria-hidden="true" /> Ready to record
                    </>
                  ) : targetId && previewStatus !== "streaming" ? (
                    "Wait for the live view"
                  ) : (
                    "Choose an app and target"
                  )}
                </span>
              </div>
            </div>
          </form>
        </div>
      ) : null}
    </LibraryPage>
  );
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
