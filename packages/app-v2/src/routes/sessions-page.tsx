/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, Monitor, Smartphone } from "lucide-react";
import { useDeferredValue, useMemo, useState } from "react";
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
  const referenceTime = Date.now();
  const sessions = useQuery({
    queryKey: sessionQueryKeys.sessionList({ includeHistory: true }),
    queryFn: () => sessionService.list({ includeHistory: true }),
    staleTime: Infinity,
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
  });

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
    <section className="relay-page max-w-[1120px]">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="relay-eyebrow">Workspace</p>
          <h1>Sessions</h1>
          <p className="relay-page-description">
            Keep active device work and durable session history in one place.
          </p>
        </div>
      </header>

      <Tabs value={view} onValueChange={(value) => setView(value as SessionView)}>
        <TabsList variant="line" aria-label="Session view">
          <TabsTrigger value="active">Active</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="all">All</TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="mt-3.5 grid max-w-[440px] gap-1.5">
        <label className="text-[11px] font-semibold text-text-weak" htmlFor="session-search">
          Search Sessions
        </label>
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
        <section className="mt-7" aria-labelledby="session-results-title">
          <div className="flex min-h-8 items-center justify-between gap-5 px-0.5 pb-2.5">
            <h2 className="text-[13px] font-semibold" id="session-results-title">
              {visible.length === 1 ? "1 Session" : `${visible.length} Sessions`}
            </h2>
            <span className="text-xs text-text-weak" aria-live="polite">
              {view === "active" ? "Ready to continue" : "Durable history"}
            </span>
          </div>
          <ul className="m-0 list-none overflow-hidden rounded-xl border border-border-weak-base bg-surface-raised-strong p-0">
            {visible.map((session) => (
              <li className="border-b border-border-weak-base last:border-b-0" key={session.id}>
                <SessionRow session={session} referenceTime={referenceTime} />
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
                variant="outline"
                onClick={() => {
                  setQuery("");
                  setView("active");
                }}
              >
                Show active Sessions
              </Button>
            ) : (
              <Button nativeButton={false} variant="default" render={<Link to="/tests/new" />}>
                Start a new Test
              </Button>
            )
          }
        />
      ) : null}
    </section>
  );
}

function SessionRow({
  session,
  referenceTime,
}: {
  session: ProductSessionSummary;
  referenceTime: number;
}) {
  const active = isActiveSession(session);
  const Icon = session.target.platform === "browser" ? Monitor : Smartphone;
  return (
    <Link
      className="grid min-h-16 cursor-pointer grid-cols-[28px_minmax(0,1fr)_18px] items-center gap-x-3 gap-y-1 px-3 py-2 text-text-base transition-colors hover:bg-surface-raised-strong-hover focus-visible:relative focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-text-strong md:grid-cols-[28px_minmax(190px,1fr)_minmax(112px,auto)_minmax(112px,0.34fr)_18px] md:gap-4"
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
    >
      <span className="grid size-7 place-items-center rounded-md border border-border-weak-base bg-surface-base text-text-weak">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="grid min-w-0 gap-1">
        <strong className="truncate text-sm font-semibold text-text-strong">{session.title}</strong>
        <span className="truncate text-xs text-text-weak">
          {session.target.targetId} · {session.actorKind === "agent" ? "Agent" : "Human"}
        </span>
      </span>
      <span className="col-start-2 justify-self-start md:col-auto">
        <Badge
          variant={sessionBadgeVariant(sessionVariant(session))}
          className={sessionBadgeClass(sessionVariant(session))}
        >
          {sessionStateLabel(session.state)}
        </Badge>
      </span>
      <span className="col-start-2 grid min-w-0 justify-items-start gap-1 md:col-auto">
        <strong className="truncate text-xs font-semibold tabular-nums text-text-base">
          Updated {relativeTime(session.updatedAt, referenceTime)}
        </strong>
        <small className="truncate text-xs text-text-weak">
          {active
            ? "Active session"
            : session.take
              ? `${session.take.actionCount} actions`
              : "No actions yet"}
        </small>
      </span>
      <ChevronRight
        className="col-start-3 row-start-1 size-4 text-text-weaker md:col-start-5"
        aria-hidden="true"
      />
    </Link>
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

function sessionBadgeVariant(tone: ReturnType<typeof sessionVariant>): "default" | "secondary" {
  if (tone === "success") return "default";
  return "secondary";
}

function sessionBadgeClass(tone: ReturnType<typeof sessionVariant>): string | undefined {
  if (tone === "success") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (tone === "warning") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  if (tone === "danger") return "bg-red-500/15 text-red-700 dark:text-red-300";
  return undefined;
}

function relativeTime(value: number, now: number): string {
  const ageMs = Math.max(0, now - value);
  if (ageMs < 60_000) return "Just now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  if (ageMs < 604_800_000) return `${Math.floor(ageMs / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}
