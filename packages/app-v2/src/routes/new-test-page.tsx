/** @jsxImportSource react */
import {
  Alert,
  AlertActions,
  AlertDescription,
  AlertIcon,
  AlertTitle,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  RadioCard,
  RadioGroup,
  ScrollArea,
  Skeleton,
} from "@relay/ui-react";
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
import type { LiveTargetSession, LiveTargetStatus } from "../data/live-target-session";
import { recordingQueryKeys } from "../data/recording-queries";
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
  const startsFromPath = search.view === "path" && Boolean(requestedAppId && requestedPathId);
  const navigate = useNavigate();
  const [appId, setAppId] = useState(requestedAppId ?? "");
  const [targetId, setTargetId] = useState("");
  const previewCanvas = useRef<HTMLCanvasElement>(null);
  const previewSession = useRef<LiveTargetSession | undefined>(undefined);
  const [previewStatus, setPreviewStatus] = useState<LiveTargetStatus>("idle");
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
    if (!targetId && draft.data.targetId) setTargetId(draft.data.targetId);
  }, [appId, draft.data, requestedAppId, targetId]);
  const activePointer = useQuery({
    queryKey: recordingQueryKeys.pointer,
    queryFn: async () => {
      const workflowId = await readWorkflowPointer(platform);
      if (!workflowId) return null;
      const current = await productService.inspect(workflowId);
      const stage = current.snapshot?.stage;
      if (!current.recovery && (stage === "cancelled" || stage === "committed")) {
        await clearWorkflowPointerIfCurrent(platform, workflowId);
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
    void productService
      .previewTarget(selectedTarget)
      .then((next) => {
        if (disposed || !previewCanvas.current) return next.close();
        session = next;
        previewSession.current = next;
        unsubscribe = next.subscribe((state) => {
          setPreviewStatus(state.status);
          setPreviewIssue(state.issue ? friendlyPreviewIssue(state.issue) : undefined);
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
      return;
    }
    setPreviewBusy(true);
    setPreviewIssue(undefined);
    try {
      await session.input(input);
    } catch {
      setPreviewIssue("Relay could not send that interaction. Reconnect, then try again.");
    } finally {
      setPreviewBusy(false);
    }
  }

  const begin = useMutation({
    mutationFn: async () => {
      const suggestedName = pathContext.data
        ? `${pathContext.data.fromTitle} to ${pathContext.data.toTitle ?? "Finish"}`
        : "Untitled recording";
      const state = await productService.begin({ title: suggestedName, appMapId: appId, targetId });
      const workflowId = state.snapshot?.workflow?.workflowId;
      if (workflowId) {
        await writeWorkflowPointer(platform, workflowId);
        queryClient.setQueryData<string | null>(recordingQueryKeys.pointer, workflowId);
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
      await navigate({ to: "/tests/$testId/record", params: { testId: workflowId } });
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
      className="relay-choice-group relay-choice-group--apps"
      name="app"
      value={appId}
      onValueChange={setAppId}
      aria-labelledby="test-app-title"
      required
    >
      {apps.data?.map((app) => (
        <RadioCard
          key={app.id}
          value={app.id}
          title={app.name}
          description="Saved App"
          leading={<AppWindow />}
        />
      ))}
    </RadioGroup>
  );

  return (
    <section className="relay-page relay-new-test-page">
      <Link className="relay-back-link" to="/tests">
        <ArrowLeft aria-hidden="true" /> Tests
      </Link>
      <header className="relay-page-header relay-new-test-header">
        <div>
          <h1>Record a Test</h1>
          <p className="relay-page-description">
            Choose one recognizable journey and where to record it. Relay handles the technical
            setup.
          </p>
        </div>
      </header>

      {activePointer.data ? (
        <Alert className="relay-resume-recording" variant="info">
          <AlertIcon>
            <CircleDot />
          </AlertIcon>
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
          <AlertActions>
            <Button
              size="small"
              onClick={() =>
                void navigate({
                  to: "/tests/$testId/record",
                  params: { testId: activePointer.data! },
                })
              }
            >
              Open recording
            </Button>
          </AlertActions>
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
        <div className="relay-new-test-layout">
          <form className="relay-recording-form" onSubmit={submit}>
            <Card className="relay-new-test-card">
              <CardHeader>
                <CardTitle>Choose where to record</CardTitle>
                <CardDescription>
                  Position the app first. You will name the Test after recording.
                </CardDescription>
              </CardHeader>
              <CardContent className="relay-new-test-fields">
                {startsFromPath ? (
                  <Alert variant="info">
                    <AlertIcon>
                      <Check />
                    </AlertIcon>
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
                  <div className="relay-choice-heading">
                    <div className="relay-field-label" id="test-app-title">
                      App
                    </div>
                    <FieldDescription>Where this Test belongs</FieldDescription>
                  </div>
                  {noApps ? (
                    <div className="relay-choice-empty">
                      <strong>No apps are available</strong>
                      <p>Add an app before recording a Test.</p>
                      <Link className="relay-inline-link" to="/apps">
                        Manage apps
                      </Link>
                    </div>
                  ) : (apps.data?.length ?? 0) > 4 ? (
                    <ScrollArea className="relay-choice-scroll">{appChoices}</ScrollArea>
                  ) : (
                    appChoices
                  )}
                </Field>

                <Field>
                  <div className="relay-choice-heading">
                    <div className="relay-field-label" id="test-target-title">
                      Device or browser
                    </div>
                    <FieldDescription>Where Relay will record</FieldDescription>
                  </div>
                  {targets.isPending ? (
                    <div className="relay-choice-group relay-choice-group--loading" role="status">
                      <span className="relay-visually-hidden">
                        Finding ready devices and browsers…
                      </span>
                      <Skeleton />
                      <Skeleton />
                    </div>
                  ) : targets.isError ? (
                    <div className="relay-choice-empty">
                      <strong>Targets are not available yet</strong>
                      <p>Use Try again above after the local Relay service is running.</p>
                    </div>
                  ) : noTargets ? (
                    <div className="relay-choice-empty">
                      <strong>Nothing is ready to record</strong>
                      <p>Connect a device or start a managed browser, then try again.</p>
                      <Link className="relay-inline-link" to="/devices">
                        View devices
                      </Link>
                    </div>
                  ) : (
                    <RadioGroup
                      className="relay-choice-group"
                      name="target"
                      value={targetId}
                      onValueChange={setTargetId}
                      aria-labelledby="test-target-title"
                      required
                    >
                      {targets.data?.targetOptions.map((target) => {
                        const label = targetLabel(target);
                        return (
                          <RadioCard
                            key={`${target.kind}:${target.targetId}`}
                            value={target.targetId}
                            title={label.title}
                            description={label.detail}
                            leading={target.kind === "browser" ? <Monitor /> : <Smartphone />}
                          />
                        );
                      })}
                    </RadioGroup>
                  )}
                </Field>

                {selectedTarget ? (
                  <section className="relay-prerecord-workspace" aria-labelledby="prerecord-title">
                    <div className="relay-prerecord-heading">
                      <div>
                        <p className="relay-section-label">Starting point</p>
                        <h2 id="prerecord-title">Put the app where recording should begin</h2>
                      </div>
                      <div className="relay-prerecord-actions">
                        <Button type="submit" variant="primary" size="small" disabled={!formReady}>
                          <Play aria-hidden="true" />
                          {begin.isPending ? "Starting…" : "Start recording"}
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="small"
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
                      send={sendPreview}
                      recording={false}
                    />
                  </section>
                ) : null}
              </CardContent>
              <CardFooter className="relay-form-actions">
                <Button render={<Link to="/tests" />} variant="ghost">
                  Cancel
                </Button>
                <span className="relay-form-readiness" aria-live="polite">
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
              </CardFooter>
            </Card>
          </form>
        </div>
      ) : null}
    </section>
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
