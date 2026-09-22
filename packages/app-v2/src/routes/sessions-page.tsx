/** @jsxImportSource react */
import { Badge } from "@relay/ui-react/components/badge";
import { Button } from "@relay/ui-react/components/button";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, Monitor, Smartphone } from "lucide-react";
import { useDeferredValue, useMemo } from "react";
import { LiveDevices } from "./live-devices";
import { deviceQueryKeys } from "../data/device-product-service";
import { EmptyState } from "../components/product-patterns";
import { LibrarySearch, LibraryToolbar } from "../components/library-toolbar";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { sessionQueryKeys, type ProductSessionSummary } from "../data/session-product-service";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/sessions");
type SessionView = "active" | "history" | "all";

export function isActiveSession(session: ProductSessionSummary): boolean {
  return ["preparing", "ready", "recording", "reviewing", "committing"].includes(session.state);
}

export function SessionsPage() {
  const { sessionService, deviceService } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate({ from: "/sessions" });
  const search = routeApi.useSearch() as { status?: unknown; target?: unknown; q?: unknown };
  const view: SessionView =
    search.status === "history" || search.status === "all" ? search.status : "active";
  const query = typeof search.q === "string" ? search.q : "";
  function setQuery(value: string) {
    void navigate({
      replace: true,
      search: (previous) => ({ ...previous, q: value || undefined }),
    });
  }
  const deferredQuery = useDeferredValue(query.trim().toLocaleLowerCase());
  const referenceTime = Date.now();
  const devices = useQuery({
    queryKey: deviceQueryKeys.devices,
    queryFn: () => deviceService.list(),
    staleTime: 5_000,
  });
  const sessions = useQuery({
    queryKey: sessionQueryKeys.sessionList({ includeHistory: true }),
    queryFn: () => sessionService.list({ includeHistory: true }),
    staleTime: 2_000,
    refetchInterval: 3_000,
    refetchOnReconnect: true,
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
    <LibraryPage className="flex min-h-full max-w-5xl flex-col">
      <PageHeader title="Activity" description="Continue recordings and runs, or open a device." />
      {devices.isPending ? <PageLoading label="Finding devices…" /> : null}
      <RecordingProblem
        error={devices.error}
        onRetry={() => void devices.refetch()}
        retrying={devices.isFetching}
      />
      {devices.data ? <LiveDevices devices={devices.data} /> : null}
      <LibraryToolbar
        label="Filter activity"
        tabs={
          <Tabs
            className="border-b border-border pb-1.5"
            value={view}
            onValueChange={(value) => setView(value as SessionView)}
          >
            <TabsList variant="line" className="h-9 justify-start" aria-label="Session view">
              <TabsTrigger value="active">Active</TabsTrigger>
              <TabsTrigger value="history">History</TabsTrigger>
              <TabsTrigger value="all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        }
        search={
          <LibrarySearch
            id="session-search"
            label="Search Live"
            value={query}
            placeholder="Search by name, target, or owner"
            onChange={setQuery}
          />
        }
      />

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
            <h2 className="text-sm font-semibold" id="session-results-title">
              {visible.length === 1 ? "1 live" : `${visible.length} live`}
            </h2>
            <span className="text-xs text-muted-foreground" aria-live="polite">
              {view === "active" ? "Continue where you left off" : "Session history"}
            </span>
          </div>
          <ul className="m-0 list-none overflow-hidden rounded-xl border border-border bg-card p-0">
            {visible.map((session) => (
              <li className="border-b border-border last:border-b-0" key={session.id}>
                <SessionRow
                  session={session}
                  referenceTime={referenceTime}
                  targetName={
                    devices.data?.find(
                      (device) =>
                        device.id === session.target.targetId ||
                        device.serial === session.target.targetId,
                    )?.name
                  }
                />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!sessions.isPending && !sessions.isError && !visible.length ? (
        <div
          className={sessions.data?.length ? undefined : "flex flex-1 items-center justify-center"}
        >
          <EmptyState
            title={
              sessions.data?.length ? "No live sessions match this view" : "No live sessions yet"
            }
            detail={
              sessions.data?.length
                ? "Choose another view or clear the search. Existing sessions remain unchanged."
                : "Start recording a Test or open a live target. Relay will keep that work available here."
            }
            action={
              sessions.data?.length ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery("");
                    void navigate({
                      replace: true,
                      search: (previous) => ({
                        ...previous,
                        status: undefined,
                        target: undefined,
                        q: undefined,
                      }),
                    });
                  }}
                >
                  Show active live work
                </Button>
              ) : (
                <Button nativeButton={false} variant="default" render={<Link to="/tests/new" />}>
                  Start a new Test
                </Button>
              )
            }
          />
        </div>
      ) : null}
    </LibraryPage>
  );
}

function SessionRow({
  session,
  referenceTime,
  targetName,
}: {
  session: ProductSessionSummary;
  referenceTime: number;
  targetName?: string;
}) {
  const active = isActiveSession(session);
  const Icon = session.target.platform === "browser" ? Monitor : Smartphone;
  return (
    <Link
      className="grid min-h-16 cursor-pointer grid-cols-[28px_minmax(0,1fr)_18px] items-center gap-x-3 gap-y-1 px-3 py-2 text-foreground transition-colors hover:bg-accent focus-visible:relative focus-visible:z-[1] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ring md:grid-cols-[28px_minmax(0,1fr)_auto_18px] md:gap-4"
      to="/sessions/$sessionId"
      params={{ sessionId: session.id }}
    >
      <span className="grid size-7 place-items-center rounded-md border border-border bg-secondary text-muted-foreground">
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <strong className="truncate text-sm font-semibold text-foreground">
            {session.title}
          </strong>
          <Badge
            variant={sessionBadgeVariant(sessionVariant(session))}
            className={
              sessionVariant(session) === "success"
                ? "bg-success/15 text-success-foreground"
                : sessionVariant(session) === "warning"
                  ? "bg-warning/15 text-warning-foreground"
                  : sessionVariant(session) === "danger"
                    ? "bg-destructive text-white dark:text-black"
                    : undefined
            }
          >
            {sessionStateLabel(session.state)}
          </Badge>
        </span>
        <span className="truncate text-xs text-muted-foreground">
          {targetName ?? (session.target.platform === "browser" ? "Browser" : "Device")} ·{" "}
          {session.actorKind === "agent" ? "Agent" : "Manual"}
        </span>
      </span>
      <span className="col-start-2 grid min-w-0 justify-items-start gap-1 md:col-auto">
        <strong className="truncate text-xs font-semibold tabular-nums text-foreground">
          Updated {relativeTime(session.updatedAt, referenceTime)}
        </strong>
        <small className="truncate text-xs text-muted-foreground">
          {active
            ? "Active session"
            : session.take
              ? `${session.take.actionCount} actions`
              : "No actions yet"}
        </small>
      </span>
      <ChevronRight
        className="col-start-3 row-start-1 size-4 text-muted-foreground md:col-start-4"
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

function relativeTime(value: number, now: number): string {
  const ageMs = Math.max(0, now - value);
  if (ageMs < 60_000) return "Just now";
  if (ageMs < 3_600_000) return `${Math.floor(ageMs / 60_000)}m ago`;
  if (ageMs < 86_400_000) return `${Math.floor(ageMs / 3_600_000)}h ago`;
  if (ageMs < 604_800_000) return `${Math.floor(ageMs / 86_400_000)}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(value);
}
