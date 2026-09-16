/** @jsxImportSource react */
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";

import { Button } from "@relay/ui-react/components/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@relay/ui-react/components/collapsible";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { CircleAlert, Pencil, RefreshCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { EmptyState } from "../components/product-patterns";
import { sessionQueryKeys, type ProductSessionDetail } from "../data/session-product-service";
import type {
  LiveTargetBrowserContext,
  LiveTargetSession,
  LiveTargetStatus,
} from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, RecordingProblem, errorMessage } from "./recording-shared";
import {
  TalkBackIssueList,
  TalkBackModeSelect,
  TalkBackOverlay,
  useTalkBackReview,
} from "./talkback-review-panel";
import { isActiveSession, sessionStateLabel } from "./sessions-page";

const routeApi = getRouteApi("/sessions/$sessionId");

export function SessionPage() {
  const { sessionId } = routeApi.useParams();
  const { sessionService, productService, queryClient, platform } = useRouteContext({
    from: "__root__",
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<LiveTargetSession | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [browserContext, setBrowserContext] = useState<LiveTargetBrowserContext>();
  const [liveIssue, setLiveIssue] = useState<string>();
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [talkBackRefresh, setTalkBackRefresh] = useState(0);
  const [endOpen, setEndOpen] = useState(false);
  const session = useQuery({
    queryKey: sessionQueryKeys.session(sessionId),
    queryFn: () => sessionService.get(sessionId),
    retry: false,
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });
  const refresh = useMutation({
    mutationFn: () => sessionService.refresh(sessionId),
    onSuccess: (value) => queryClient.setQueryData(sessionQueryKeys.session(sessionId), value),
  });
  const end = useMutation({
    mutationFn: () => sessionService.end(sessionId),
    onSuccess: async (value) => {
      queryClient.setQueryData(sessionQueryKeys.session(sessionId), value);
      await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.sessionLists });
      setEndOpen(false);
    },
  });
  const value = session.data;
  const talkBack = useTalkBackReview({
    enabled: Boolean(value?.target.targetId),
    serial: value?.target.targetId,
    capture: productService.reviewTalkBack,
    refreshKey: talkBackRefresh,
    platform,
  });
  const canControl = Boolean(
    value &&
    isActiveSession(value) &&
    value.lease?.status === "leased" &&
    value.lease.expiresAt > Date.now(),
  );

  useEffect(() => {
    if (!canControl || !canvas.current) return;
    let disposed = false;
    let unmount: (() => void) | undefined;
    let unsubscribe: (() => void) | undefined;
    let mounted: LiveTargetSession | undefined;
    setLiveStatus("connecting");
    setLiveIssue(undefined);
    setBrowserContext(undefined);
    void sessionService
      .live(sessionId)
      .then((next) => {
        if (disposed || !canvas.current) {
          next.close();
          return;
        }
        mounted = next;
        live.current = next;
        unsubscribe = next.subscribe((snapshot) => {
          setLiveStatus(snapshot.status);
          setLiveIssue(snapshot.issue);
          setBrowserContext(snapshot.browserContext);
        });
        unmount = next.mount(canvas.current);
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setLiveStatus("degraded");
          setLiveIssue(errorMessage(error));
        }
      });
    return () => {
      disposed = true;
      unmount?.();
      unsubscribe?.();
      if (live.current === mounted) live.current = undefined;
      mounted?.close();
    };
  }, [canControl, liveAttempt, sessionId, sessionService]);

  async function send(input: Parameters<LiveTargetSession["input"]>[0]): Promise<boolean> {
    if (!live.current) {
      setLiveIssue("The live Session is still connecting.");
      return false;
    }
    setLiveBusy(true);
    setLiveIssue(undefined);
    try {
      await live.current.input(input);
      setTalkBackRefresh((count) => count + 1);
      return true;
    } catch (error) {
      setLiveIssue(errorMessage(error));
      return false;
    } finally {
      setLiveBusy(false);
    }
  }

  return (
    <LibraryPage className="max-w-[1120px]">
      {value ? (
        <PageHeader
          crumbs={[{ label: "Live", to: "/sessions" }, { label: value.title }]}
          title={value.title}
          description={`${targetLabel(value)} · ${value.actorKind === "agent" ? "Agent" : "Manual"} · ${sessionStateLabel(value.state)}`}
          actions={
            <>
              {isActiveSession(value) && !canControl ? (
                <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                  <RefreshCcw aria-hidden="true" />
                  {refresh.isPending ? "Reconnecting…" : "Reconnect"}
                </Button>
              ) : null}
              {canControl ? (
                <Button
                  variant="outline"
                  onClick={() => refresh.mutate()}
                  disabled={refresh.isPending}
                >
                  <RefreshCcw aria-hidden="true" />
                  {refresh.isPending ? "Refreshing…" : "Refresh target"}
                </Button>
              ) : null}
              {canControl && value.committedTestId ? (
                <Button
                  variant="default"
                  nativeButton={false}
                  render={
                    <Link
                      to="/tests/$testId/edit"
                      params={{ testId: value.committedTestId }}
                      search={{ session: value.id }}
                    />
                  }
                >
                  <Pencil aria-hidden="true" /> Edit Test live
                </Button>
              ) : null}
              {isActiveSession(value) ? (
                <>
                  <Button variant="ghost" onClick={() => setEndOpen(true)}>
                    End session
                  </Button>
                  <Dialog open={endOpen} onOpenChange={setEndOpen}>
                    <DialogContent showCloseButton={false}>
                      <DialogTitle>End this Live session?</DialogTitle>
                      <DialogDescription>
                        The device is released. Saved evidence stays.
                      </DialogDescription>
                      <div className="relay-form-actions flex flex-wrap items-center gap-2.5 relay-form-actions--end">
                        <DialogClose render={<Button variant="ghost">Keep session</Button>} />
                        <Button
                          className="relay-session-end-button"
                          variant="outline"
                          onClick={() => end.mutate()}
                          disabled={end.isPending}
                        >
                          {end.isPending ? "Ending…" : "End session"}
                        </Button>
                      </div>
                    </DialogContent>
                  </Dialog>
                </>
              ) : null}
            </>
          }
        />
      ) : null}

      {session.isPending ? <PageLoading label="Loading Session…" /> : null}
      {session.isError && !value ? (
        <section
          className="mt-10 flex max-w-xl flex-col items-start"
          role="alert"
          aria-labelledby="session-load-error-title"
        >
          <div className="grid size-9 place-items-center rounded-lg bg-destructive/10 text-destructive">
            <CircleAlert className="size-4" aria-hidden="true" />
          </div>
          <h1
            id="session-load-error-title"
            className="mt-5 text-2xl font-semibold tracking-tight text-foreground"
          >
            Couldn’t load this Session
          </h1>
          <p className="mt-2 max-w-[48ch] text-sm leading-6 text-muted-foreground">
            Relay couldn’t retrieve this session. It may have expired or the link may no longer be
            valid.
          </p>
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Button nativeButton={false} render={<Link to="/sessions" />}>
              Back to Live
            </Button>
            <Button
              variant="outline"
              onClick={() => void session.refetch()}
              disabled={session.isFetching}
            >
              <RefreshCcw aria-hidden="true" />
              {session.isFetching ? "Trying again…" : "Try again"}
            </Button>
          </div>
        </section>
      ) : null}
      {value ? (
        <RecordingProblem
          className="mt-4 max-w-2xl"
          error={refresh.error ?? end.error}
          onRetry={() => void session.refetch()}
          retrying={session.isFetching}
        />
      ) : null}

      {!session.isPending && !session.isError && !value ? (
        <EmptyState
          title="This Session is not available"
          detail="It may belong to another project or may have been removed. Return to Live to continue available work."
          action={
            <Button nativeButton={false} variant="default" render={<Link to="/sessions" />}>
              View Live
            </Button>
          }
        />
      ) : null}

      {value ? (
        <div className="mt-6 grid items-start gap-6 max-[879px]:grid-cols-1 min-[880px]:grid-cols-[minmax(0,1fr)_300px]">
          <section
            className="flex min-h-[min(72dvh,760px)] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card min-[880px]:sticky min-[880px]:top-4"
            aria-labelledby="session-stage-title"
            data-slot="live-device-rail"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border px-3.5 py-2.5">
              <h2 id="session-stage-title" className="text-[13px] font-medium">
                {canControl ? "Live target" : "Target unavailable"}
              </h2>
              {canControl && liveStatus === "degraded" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setLiveAttempt((attempt) => attempt + 1)}
                >
                  Reconnect
                </Button>
              ) : null}
            </div>
            {canControl ? (
              <div className="flex min-h-0 flex-1 flex-col">
                <LiveTargetCanvas
                  canvasRef={canvas}
                  status={liveStatus}
                  issue={liveIssue}
                  busy={liveBusy}
                  targetTitle={targetLabel(value)}
                  targetDetail={`${value.target.kind === "browser" ? "Browser" : "Device"} · ${value.actorKind === "agent" ? "Agent" : "Manual"}`}
                  browserContext={browserContext}
                  send={send}
                  recording={false}
                  layout="rail"
                  helpText="Tap, type, or scroll. Not recorded."
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
                {talkBack.on ? (
                  <div className="border-t border-border px-3 py-3">
                    <TalkBackIssueList
                      review={talkBack.inspection.review}
                      inspectable={talkBack.inspection.inspectable}
                      message={talkBack.issue ?? talkBack.inspection.message}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="grid min-h-[280px] flex-1 place-items-center content-center gap-4 px-5 py-8 text-center text-sm leading-relaxed text-muted-foreground">
                <p className="max-w-[46ch]">{sessionAvailability(value)}</p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {isActiveSession(value) ? (
                    <Button onClick={() => refresh.mutate()} disabled={refresh.isPending}>
                      <RefreshCcw aria-hidden="true" />
                      {refresh.isPending ? "Reconnecting…" : "Reconnect"}
                    </Button>
                  ) : null}
                  {value.state === "reviewing" ? (
                    <Button
                      variant="default"
                      nativeButton={false}
                      render={
                        <Link
                          to="/recordings/$recordingId/review"
                          params={{ recordingId: value.id }}
                        />
                      }
                    >
                      Review recording
                    </Button>
                  ) : value.committedTestId ? (
                    <Button
                      variant="outline"
                      nativeButton={false}
                      render={
                        <Link to="/tests/$testId" params={{ testId: value.committedTestId }} />
                      }
                    >
                      Open saved Test
                    </Button>
                  ) : null}
                </div>
              </div>
            )}
          </section>
          <aside className="grid min-w-0 gap-6" aria-label="Session context">
            {canControl ? (
              <p className="max-w-[52ch] text-sm leading-6 text-muted-foreground">
                {value.state === "recording"
                  ? "Recording · captured actions are saved"
                  : "Live · Not recording"}
              </p>
            ) : null}
            <section className="rounded-xl border border-border bg-card p-5">
              <h2 className="mb-4 text-sm font-semibold">Session details</h2>
              <dl className="grid grid-cols-2 gap-4 min-[881px]:grid-cols-1">
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">Target</dt>
                  <dd className="break-words text-sm font-medium">{targetLabel(value)}</dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">Workspace mode</dt>
                  <dd className="break-words text-sm font-medium">
                    {value.state === "recording" ? "Recording" : "Not recording"}
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">App</dt>
                  <dd className="break-words text-sm font-medium">
                    {value.appName ?? "Saved app"}
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">Owner</dt>
                  <dd className="break-words text-sm font-medium">
                    {value.actorKind === "agent" ? "Agent" : "Human"}
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">Actions</dt>
                  <dd className="break-words text-sm font-medium">
                    {value.take?.actionCount ?? 0}
                  </dd>
                </div>
                <div className="grid gap-0.5">
                  <dt className="text-xs text-muted-foreground">Evidence</dt>
                  <dd className="break-words text-sm font-medium">
                    {value.take?.evidenceCount ?? 0}
                  </dd>
                </div>
              </dl>
              <Collapsible className="mt-[18px]">
                <CollapsibleTrigger className="flex w-full items-center justify-between gap-2 py-2 text-left text-sm font-medium text-muted-foreground transition-colors hover:text-foreground">
                  Audit details
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-3 border-t pt-3 text-sm">
                  <dl className="grid gap-3">
                    <div className="grid gap-0.5">
                      <dt className="text-xs text-muted-foreground">Map ID</dt>
                      <dd className="break-words text-sm font-medium">{value.appMapId}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-xs text-muted-foreground">Actor ID</dt>
                      <dd className="break-words text-sm font-medium">{value.actorId}</dd>
                    </div>
                    <div className="grid gap-0.5">
                      <dt className="text-xs text-muted-foreground">Device reservation status</dt>
                      <dd className="break-words text-sm font-medium">
                        {value.lease?.status ?? "Unavailable"}
                      </dd>
                    </div>
                  </dl>
                </CollapsibleContent>
              </Collapsible>
            </section>
            <section
              className="rounded-xl border border-border bg-card p-5"
              aria-labelledby="session-activity-title"
            >
              <p className="relay-section-label text-[11px] font-semibold uppercase tracking-[0.04em] text-[var(--text-weaker)]">
                Activity
              </p>
              <h2 id="session-activity-title">Recent operations</h2>
              {value.activity.length ? (
                <ol className="mt-4 grid list-none gap-3 p-0">
                  {[...value.activity]
                    .reverse()
                    .slice(0, 12)
                    .map((item) => (
                      <li
                        className="grid grid-cols-[8px_minmax(0,1fr)] items-start gap-3"
                        key={item.activityId}
                      >
                        <span
                          className="mt-1.5 size-2 rounded-full bg-primary"
                          aria-hidden="true"
                        />
                        <div className="grid min-w-0 gap-0.5">
                          <strong className="break-words text-sm font-medium">
                            {item.summary}
                          </strong>
                          <small className="text-xs text-muted-foreground">
                            {new Date(item.timestamp).toLocaleString()}
                          </small>
                        </div>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="-empty">No project activity is available to this role.</p>
              )}
            </section>
          </aside>
        </div>
      ) : null}
    </LibraryPage>
  );
}

function targetLabel(session: ProductSessionDetail): string {
  const platform =
    session.target.platform === "browser"
      ? "Browser"
      : session.target.platform === "ios"
        ? "iOS"
        : "Android";
  return `${platform} · ${session.target.targetId}`;
}

function sessionAvailability(session: ProductSessionDetail): string {
  if (!isActiveSession(session)) return "This session has ended. Saved evidence stays.";
  if (!session.lease) return "Reservation unavailable.";
  if (session.lease.status !== "leased") return "The device is no longer reserved.";
  if (session.lease.expiresAt <= Date.now()) return "Reservation expired.";
  return "The device is not available.";
}
