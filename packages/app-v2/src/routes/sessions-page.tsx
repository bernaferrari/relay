/** @jsxImportSource react */
import {
  Badge,
  Button,
  Input,
  Item,
  Tabs,
  TabsIndicator,
  TabsList,
  TabsTrigger,
} from "@relay/ui-react";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, Monitor, Smartphone } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { EmptyState } from "../components/product-patterns";
import { sessionQueryKeys, type ProductSessionSummary } from "../data/session-product-service";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/sessions");
type SessionView = "active" | "history" | "all";

export function isActiveSession(session: ProductSessionSummary): boolean {
  return ["preparing", "ready", "recording", "reviewing", "committing"].includes(session.state);
}

export function SessionsPage() {
  const { sessionService } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate({ from: "/sessions" });
  const search = routeApi.useSearch() as { status?: unknown; target?: unknown };
  const view: SessionView =
    search.status === "history" || search.status === "all" ? search.status : "active";
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const [now, setNow] = useState(Date.now);
  const sessions = useQuery({
    queryKey: sessionQueryKeys.sessionList({ includeHistory: true }),
    queryFn: () => sessionService.list({ includeHistory: true }),
    staleTime: 3_000,
    refetchInterval: (state) => (state.state.data?.some(isActiveSession) ? 3_000 : false),
  });

  useEffect(() => {
    if (!sessions.data?.some(isActiveSession)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [sessions.data]);

  const visible = useMemo(
    () =>
      (sessions.data ?? [])
        .filter((session) => {
          const active = isActiveSession(session);
          if (view === "active" && !active) return false;
          if (view === "history" && active) return false;
          if (typeof search.target === "string" && session.target.targetId !== search.target) {
            return false;
          }
          return (
            !deferredQuery ||
            `${session.title} ${session.target.targetId} ${session.state} ${session.actorId}`
              .toLocaleLowerCase()
              .includes(deferredQuery)
          );
        })
        .sort(
          (left, right) =>
            right.updatedAt - left.updatedAt || left.title.localeCompare(right.title),
        ),
    [deferredQuery, search.target, sessions.data, view],
  );

  function setView(next: SessionView) {
    void navigate({
      search: (previous) => ({
        ...previous,
        status: next === "active" ? undefined : next,
      }),
    });
  }

  return (
    <section className="relay-page relay-library-page relay-sessions-page">
      <header className="relay-library-header">
        <div>
          <p className="relay-eyebrow">Workspace</p>
          <h1>Sessions</h1>
          <p className="relay-page-description">
            Return to durable browser and device work without losing its target, evidence, or owner.
          </p>
        </div>
        <Button size="small" onClick={() => void sessions.refetch()} disabled={sessions.isFetching}>
          {sessions.isFetching ? "Checking…" : "Check again"}
        </Button>
      </header>

      <Tabs value={view} onValueChange={(value) => setView(value as SessionView)}>
        <TabsList variant="line" aria-label="Session view">
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
          <TabsIndicator />
        </TabsList>
      </Tabs>

      <div className="relay-session-toolbar">
        <label htmlFor="session-search">Search Sessions</label>
        <Input
          id="session-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search by name, target, or owner"
          autoComplete="off"
          spellCheck="false"
        />
      </div>

      {sessions.isPending ? <PageLoading label="Loading Sessions…" /> : null}
      <RecordingProblem
        error={sessions.error}
        onRetry={() => void sessions.refetch()}
        retrying={sessions.isFetching}
        layout="centered"
      />

      {!sessions.isPending && !sessions.isError && visible.length ? (
        <section className="relay-library-results" aria-labelledby="session-results-title">
          <div className="relay-library-results-heading">
            <h2 id="session-results-title">
              {visible.length === 1 ? "1 Session" : `${visible.length} Sessions`}
            </h2>
            <span aria-live="polite">
              {view === "active" ? "Ready to continue" : "Durable history"}
            </span>
          </div>
          <ul className="relay-library-list relay-session-list">
            {visible.map((session) => (
              <li key={session.id}>
                <SessionRow session={session} now={now} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!sessions.isPending && !sessions.isError && !visible.length ? (
        <EmptyState
          title={sessions.data?.length ? "No Sessions match this view" : "No Sessions yet"}
          detail={
            sessions.data?.length
              ? "Choose another view or clear the search. Existing Sessions remain unchanged."
              : "Start recording a Test or open a live target. Relay will keep that work available here."
          }
          action={
            sessions.data?.length ? (
              <Button
                variant="secondary"
                onClick={() => {
                  setQuery("");
                  setView("active");
                }}
              >
                Show active Sessions
              </Button>
            ) : (
              <Button variant="primary" render={<Link to="/tests/new" />}>
                Start a new Test
              </Button>
            )
          }
        />
      ) : null}
    </section>
  );
}

function SessionRow({ session, now }: { session: ProductSessionSummary; now: number }) {
  const active = isActiveSession(session);
  const Icon = session.target.platform === "browser" ? Monitor : Smartphone;
  return (
    <Item
      className="relay-library-row relay-session-row"
      render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} />}
    >
      <span className="relay-session-row-icon">
        <Icon aria-hidden="true" />
      </span>
      <span className="relay-library-row-main">
        <strong>{session.title}</strong>
        <span>
          {session.target.targetId} · {session.actorKind === "agent" ? "Agent" : "Human"}
        </span>
      </span>
      <span className="relay-library-row-status">
        <Badge variant={sessionVariant(session)}>{sessionStateLabel(session.state)}</Badge>
      </span>
      <span className="relay-library-row-recent">
        <strong>
          {active ? formatElapsed(now - session.createdAt) : relativeTime(session.updatedAt, now)}
        </strong>
        <small>
          {active ? "elapsed" : session.take ? `${session.take.actionCount} actions` : "No take"}
        </small>
      </span>
      <ChevronRight className="relay-library-row-arrow" aria-hidden="true" />
    </Item>
  );
}

export function sessionStateLabel(state: ProductSessionSummary["state"]): string {
  if (state === "preparing") return "Preparing";
  if (state === "ready") return "Ready";
  if (state === "recording") return "Recording";
  if (state === "reviewing") return "Reviewing";
  if (state === "committing") return "Saving";
  if (state === "committed") return "Completed";
  if (state === "failed") return "Needs attention";
  return "Ended";
}

function sessionVariant(
  session: ProductSessionSummary,
): "success" | "warning" | "danger" | "secondary" {
  if (session.state === "recording") return "danger";
  if (session.state === "ready" || session.state === "committed") return "success";
  if (session.state === "failed" || (!session.lease && isActiveSession(session))) return "warning";
  return "secondary";
}

function formatElapsed(value: number): string {
  const seconds = Math.max(0, Math.floor(value / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`;
}

function relativeTime(value: number, now: number): string {
  const minutes = Math.max(0, Math.round((now - value) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
