/** @jsxImportSource react */
import { Badge, Button, Dialog, Disclosure } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { Pencil, RefreshCcw, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { sessionQueryKeys, type ProductSessionDetail } from "../data/session-product-service";
import type { LiveTargetSession, LiveTargetStatus } from "../data/live-target-session";
import { LiveTargetCanvas } from "./live-target-canvas";
import { PageLoading, RecordingProblem, errorMessage } from "./recording-shared";
import { isActiveSession, sessionStateLabel } from "./sessions-page";

const routeApi = getRouteApi("/sessions/$sessionId");

export function SessionPage() {
  const { sessionId } = routeApi.useParams();
  const { sessionService, queryClient } = useRouteContext({ from: "__root__" });
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef<LiveTargetSession | undefined>(undefined);
  const [liveStatus, setLiveStatus] = useState<LiveTargetStatus>("idle");
  const [liveIssue, setLiveIssue] = useState<string>();
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveAttempt, setLiveAttempt] = useState(0);
  const [endOpen, setEndOpen] = useState(false);
  const session = useQuery({
    queryKey: sessionQueryKeys.session(sessionId),
    queryFn: () => sessionService.get(sessionId),
    staleTime: 2_000,
    refetchInterval: (state) =>
      state.state.data && isActiveSession(state.state.data) ? 3_000 : false,
  });
  const refresh = useMutation({
    mutationFn: () => sessionService.refresh(sessionId),
    onSuccess: (value) => queryClient.setQueryData(sessionQueryKeys.session(sessionId), value),
  });
  const end = useMutation({
    mutationFn: () => sessionService.end(sessionId),
    onSuccess: async (value) => {
      queryClient.setQueryData(sessionQueryKeys.session(sessionId), value);
      await queryClient.invalidateQueries({ queryKey: sessionQueryKeys.sessions });
      setEndOpen(false);
    },
  });
  const value = session.data;
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

  async function send(input: Parameters<LiveTargetSession["input"]>[0]) {
    if (!live.current) {
      setLiveIssue("The live Session is still connecting.");
      return;
    }
    setLiveBusy(true);
    setLiveIssue(undefined);
    try {
      await live.current.input(input);
    } catch (error) {
      setLiveIssue(errorMessage(error));
    } finally {
      setLiveBusy(false);
    }
  }

  return (
    <section className="relay-page relay-session-page">
      <Breadcrumbs
        items={[{ label: "Sessions", to: "/sessions" }, { label: value?.title ?? "Session" }]}
      />
      <header className="relay-page-header relay-session-detail-header">
        <div>
          <p className="relay-eyebrow">Session</p>
          <h1>{value?.title ?? "Session"}</h1>
          <p className="relay-page-description">
            {value
              ? `${targetLabel(value)} · ${value.actorKind === "agent" ? "Agent-owned" : "Human-owned"}`
              : "Durable live target context"}
          </p>
        </div>
        {value ? (
          <div className="relay-session-actions">
            <Badge
              variant={
                value.state === "failed"
                  ? "warning"
                  : isActiveSession(value)
                    ? "success"
                    : "secondary"
              }
            >
              {sessionStateLabel(value.state)}
            </Badge>
            {canControl ? (
              <Button
                variant="secondary"
                onClick={() => refresh.mutate()}
                disabled={refresh.isPending}
              >
                <RefreshCcw aria-hidden="true" />
                {refresh.isPending ? "Refreshing…" : "Refresh target"}
              </Button>
            ) : null}
            {canControl && value.committedTestId ? (
              <Button
                variant="primary"
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
              <Dialog.Root open={endOpen} onOpenChange={setEndOpen}>
                <Dialog.Trigger render={<Button variant="ghost" />}>
                  <Square aria-hidden="true" /> End Session
                </Dialog.Trigger>
                <Dialog.Portal>
                  <Dialog.Backdrop className="relay-dialog-backdrop" />
                  <Dialog.Viewport className="relay-dialog-viewport">
                    <Dialog.Popup className="relay-overlay-popup relay-dialog-popup">
                      <Dialog.Title>End this Session?</Dialog.Title>
                      <Dialog.Description>
                        Relay will stop this active authoring Session. Saved evidence and its
                        history remain available.
                      </Dialog.Description>
                      <div className="relay-form-actions relay-form-actions--end">
                        <Dialog.Close render={<Button variant="ghost">Keep Session</Button>} />
                        <Button
                          className="relay-session-end-button"
                          variant="secondary"
                          onClick={() => end.mutate()}
                          disabled={end.isPending}
                        >
                          {end.isPending ? "Ending…" : "End Session"}
                        </Button>
                      </div>
                    </Dialog.Popup>
                  </Dialog.Viewport>
                </Dialog.Portal>
              </Dialog.Root>
            ) : null}
          </div>
        ) : null}
      </header>

      {session.isPending ? <PageLoading label="Loading Session…" /> : null}
      <RecordingProblem
        error={session.error ?? refresh.error ?? end.error}
        onRetry={() => void session.refetch()}
        retrying={session.isFetching}
      />

      {!session.isPending && !session.isError && !value ? (
        <EmptyState
          title="This Session is not available"
          detail="It may belong to another project or may have been removed. Return to Sessions to continue available work."
          action={
            <Button variant="primary" render={<Link to="/sessions" />}>
              View Sessions
            </Button>
          }
        />
      ) : null}

      {value ? (
        <div className="relay-session-workspace">
          <section className="relay-session-stage" aria-labelledby="session-stage-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">Live target</p>
                <h2 id="session-stage-title">
                  {canControl ? "Continue where you left off" : "Target unavailable for control"}
                </h2>
              </div>
              {canControl && liveStatus === "degraded" ? (
                <Button
                  size="small"
                  variant="secondary"
                  onClick={() => setLiveAttempt((attempt) => attempt + 1)}
                >
                  Reconnect view
                </Button>
              ) : null}
            </div>
            {canControl ? (
              <LiveTargetCanvas
                canvasRef={canvas}
                status={liveStatus}
                issue={liveIssue}
                busy={liveBusy}
                targetTitle={targetLabel(value)}
                targetDetail={`Owned by ${value.actorId}`}
                send={send}
                recording={false}
                helpText="Click, drag, scroll, or type to inspect this live Session. These controls do not add actions to the recorded Test."
              />
            ) : (
              <div className="relay-session-unavailable">
                <p>{sessionAvailability(value)}</p>
                {value.state === "reviewing" ? (
                  <Button
                    variant="primary"
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
                    variant="primary"
                    render={<Link to="/tests/$testId" params={{ testId: value.committedTestId }} />}
                  >
                    Open saved Test
                  </Button>
                ) : null}
              </div>
            )}
          </section>

          <aside className="relay-session-context" aria-label="Session context">
            <section>
              <p className="relay-section-label">At a glance</p>
              <h2>Session details</h2>
              <dl>
                <div>
                  <dt>Target</dt>
                  <dd>{targetLabel(value)}</dd>
                </div>
                <div>
                  <dt>App</dt>
                  <dd>{value.appName ?? "Saved app"}</dd>
                </div>
                <div>
                  <dt>Owner</dt>
                  <dd>{value.actorKind === "agent" ? "Agent" : "Human"}</dd>
                </div>
                <div>
                  <dt>Actions</dt>
                  <dd>{value.take?.actionCount ?? 0}</dd>
                </div>
                <div>
                  <dt>Evidence</dt>
                  <dd>{value.take?.evidenceCount ?? 0}</dd>
                </div>
              </dl>
              <Disclosure.Root className="relay-session-audit">
                <Disclosure.Trigger>Audit details</Disclosure.Trigger>
                <Disclosure.Panel>
                  <dl>
                    <div>
                      <dt>App Map ID</dt>
                      <dd>{value.appMapId}</dd>
                    </div>
                    <div>
                      <dt>Actor ID</dt>
                      <dd>{value.actorId}</dd>
                    </div>
                    <div>
                      <dt>Lease status</dt>
                      <dd>{value.lease?.status ?? "Unavailable"}</dd>
                    </div>
                  </dl>
                </Disclosure.Panel>
              </Disclosure.Root>
            </section>
            <section className="relay-session-activity" aria-labelledby="session-activity-title">
              <p className="relay-section-label">Activity</p>
              <h2 id="session-activity-title">Recent operations</h2>
              {value.activity.length ? (
                <ol>
                  {[...value.activity]
                    .reverse()
                    .slice(0, 12)
                    .map((item) => (
                      <li key={item.activityId}>
                        <span aria-hidden="true" />
                        <div>
                          <strong>{item.summary}</strong>
                          <small>{new Date(item.timestamp).toLocaleString()}</small>
                        </div>
                      </li>
                    ))}
                </ol>
              ) : (
                <p className="relay-session-activity-empty">
                  No project activity is available to this role.
                </p>
              )}
            </section>
          </aside>
        </div>
      ) : null}
    </section>
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
  if (!isActiveSession(session))
    return "This Session has ended. Its evidence and operation history remain available.";
  if (!session.lease)
    return "Relay cannot prove the original target lease. Live control stays disabled.";
  if (session.lease.status !== "leased")
    return `The target lease is ${session.lease.status}. Live control stays disabled.`;
  if (session.lease.expiresAt <= Date.now())
    return "The target lease has expired. Live control stays disabled.";
  return "The target is not available for live control.";
}
