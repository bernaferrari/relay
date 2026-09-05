/** @jsxImportSource react */
import type { ProductChange } from "@relay/product/change-journey";
import { Badge } from "@relay/ui-react/components/badge";
import { Item } from "@relay/ui-react/components/item";
import { Tabs, TabsList, TabsTrigger } from "@relay/ui-react/components/tabs";
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { ChevronRight, RotateCcw } from "lucide-react";
import { useMemo } from "react";
import { EmptyState, RecoveryState } from "../components/product-patterns";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/changes");
export const changesQueryKey = ["changes"] as const;

type ChangeView = "current" | "active" | "ready" | "attention" | "history";

export function ChangesPage() {
  const { changeService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate({ from: "/changes" });
  const search = routeApi.useSearch() as { app?: unknown; status?: unknown };
  const view = changeView(search.status);
  const app = typeof search.app === "string" ? search.app : "";
  const changes = useQuery({
    queryKey: changesQueryKey,
    queryFn: () => changeService.list(),
    staleTime: 5_000,
  });
  const prepare = useMutation({
    mutationFn: () => changeService.prepare(),
    onSuccess: async (detail) => {
      if (!detail.state.change) return;
      queryClient.setQueryData(["change", detail.state.change.id], detail);
      await queryClient.invalidateQueries({ queryKey: changesQueryKey });
      void navigate({
        to: "/changes/$changeId",
        params: { changeId: detail.state.change.id },
      });
    },
  });
  const visible = useMemo(
    () =>
      (changes.data ?? [])
        .filter((change) => matchesView(change, view) && (!app || change.appIds?.includes(app)))
        .sort((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id)),
    [app, changes.data, view],
  );

  return (
    <section className="relay-page relay-library-page max-w-[1040px]">
      <header className="relay-library-header flex items-start justify-between gap-7 max-[780px]:flex-col">
        <div>
          <p className="relay-eyebrow">Changes</p>
          <h1>Change verification</h1>
          <p className="relay-page-description">
            See which code changes are ready to merge, what Relay verified, and what still needs
            attention.
          </p>
        </div>
        {!changes.isError ? (
          <Button variant="default" onClick={() => prepare.mutate()} disabled={prepare.isPending}>
            {prepare.isPending ? "Preparing verification…" : "Verify current Change"}
          </Button>
        ) : null}
      </header>

      <Tabs
        value={view}
        onValueChange={(next) =>
          void navigate({
            search: (previous) => ({
              ...previous,
              status: next === "current" ? undefined : next,
            }),
          })
        }
      >
        <TabsList variant="line" aria-label="Change views">
          {(
            [
              ["current", "Current"],
              ["active", "In progress"],
              ["ready", "Ready to verify"],
              ["attention", "Needs attention"],
              ["history", "History"],
            ] as const
          ).map(([value, label]) => (
            <TabsTrigger key={value} value={value}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {changes.isError ? (
        <RecoveryState
          className="mt-5"
          layout="centered"
          title="Relay is offline"
          detail="Start the local service, then reconnect. Your work is safe."
          action={
            <Button
              size="sm"
              variant="outline"
              onClick={() => void changes.refetch()}
              disabled={changes.isFetching}
            >
              <RotateCcw aria-hidden="true" />
              {changes.isFetching ? "Reconnecting…" : "Reconnect"}
            </Button>
          }
        />
      ) : (
        <RecordingProblem recovery={prepare.data?.state.recovery} error={prepare.error} />
      )}
      {changes.isPending ? <PageLoading label="Loading Changes…" /> : null}

      {!changes.isPending && !changes.isError && visible.length ? (
        <section className="relay-library-results" aria-labelledby="changes-result-title">
          <div className="relay-library-results-heading">
            <h2 id="changes-result-title">
              {visible.length === 1 ? "1 Change" : `${visible.length} Changes`}
            </h2>
            <span aria-live="polite">{viewLabel(view)}</span>
          </div>
          <ul className="relay-library-list">
            {visible.map((change) => (
              <ChangeRow key={change.id} change={change} />
            ))}
          </ul>
        </section>
      ) : null}

      {!changes.isPending && !changes.isError && !visible.length ? (
        changes.data?.length ? (
          <EmptyState
            layout="filtered"
            title={emptyViewTitle(view)}
            detail="There is nothing in this view right now."
            action={
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void navigate({ search: { status: "history" } })}
              >
                View all Changes
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No Changes verified yet"
            detail="Prepare the current repository Change and Relay will select the Tests, builds, and devices needed to verify it."
            action={
              <Button
                variant="default"
                onClick={() => prepare.mutate()}
                disabled={prepare.isPending}
              >
                Verify current Change
              </Button>
            }
          />
        )
      ) : null}
    </section>
  );
}

function ChangeRow({ change }: { change: ProductChange }) {
  const status = changeStatus(change);
  return (
    <li>
      <Item
        className="relay-library-row grid-cols-[minmax(220px,1fr)_minmax(118px,auto)_minmax(148px,.42fr)_18px]"
        render={<Link to="/changes/$changeId" params={{ changeId: change.id }} />}
      >
        <span className="relay-library-row-main">
          <strong>{change.title}</strong>
          <span>
            {change.repository}
            {change.pullRequest ? ` · PR #${change.pullRequest}` : ""}
          </span>
        </span>
        <span className="relay-library-row-status">
          <Badge
            variant={changeBadgeVariant(status.tone)}
            className={changeBadgeClass(status.tone)}
          >
            {status.label}
          </Badge>
        </span>
        <span className="relay-library-row-recent">
          <strong>{relativeTime(change.updatedAt)}</strong>
          <small>{coverageLabel(change)}</small>
        </span>
        <ChevronRight className="relay-library-row-arrow" aria-hidden="true" />
      </Item>
    </li>
  );
}

function changeBadgeVariant(
  tone: ReturnType<typeof changeStatus>["tone"],
): "default" | "destructive" | "secondary" {
  if (tone === "success") return "default";
  if (tone === "danger") return "destructive";
  return "secondary";
}

function changeBadgeClass(tone: ReturnType<typeof changeStatus>["tone"]): string | undefined {
  if (tone === "success") return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (tone === "notice") return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return undefined;
}

export function changeStatus(change: ProductChange): {
  label: string;
  tone: "success" | "danger" | "notice" | "quiet" | "active";
} {
  if (change.status === "proved") return { label: "Ready to merge", tone: "success" };
  if (change.status === "rejected") return { label: "Changes needed", tone: "danger" };
  if (change.status === "needs-review") return { label: "Needs review", tone: "notice" };
  if (change.status === "insufficient-evidence")
    return { label: "Missing evidence", tone: "notice" };
  if (["running", "running-pilot", "awaiting-expansion"].includes(change.status)) {
    return { label: "Verifying", tone: "active" };
  }
  if (change.status === "ready") return { label: "Ready to verify", tone: "active" };
  if (change.status === "planning") return { label: "Review plan", tone: "quiet" };
  if (change.status === "awaiting-build") return { label: "Preparing builds", tone: "quiet" };
  if (change.status === "cancelled") return { label: "Cancelled", tone: "quiet" };
  return { label: "Superseded", tone: "quiet" };
}

function coverageLabel(change: ProductChange): string {
  if (change.requiredVerificationCount) {
    return `${change.requiredVerificationCount} required ${change.requiredVerificationCount === 1 ? "check" : "checks"}`;
  }
  if (change.affectedTestCount) {
    return `${change.affectedTestCount} affected ${change.affectedTestCount === 1 ? "Test" : "Tests"}`;
  }
  return "Plan not ready";
}

function changeView(value: unknown): ChangeView {
  return ["active", "ready", "attention", "history"].includes(String(value))
    ? (value as ChangeView)
    : "current";
}

function matchesView(change: ProductChange, view: ChangeView): boolean {
  if (view === "current") return change.status !== "superseded";
  if (view === "active")
    return ["running", "running-pilot", "awaiting-expansion"].includes(change.status);
  if (view === "ready") return ["planning", "awaiting-build", "ready"].includes(change.status);
  if (view === "attention")
    return ["rejected", "needs-review", "insufficient-evidence"].includes(change.status);
  return true;
}

function viewLabel(view: ChangeView): string {
  if (view === "active") return "In progress";
  if (view === "ready") return "Ready to verify";
  if (view === "attention") return "Needs attention";
  if (view === "history") return "Complete history";
  return "Current Changes";
}

function emptyViewTitle(view: ChangeView): string {
  if (view === "active") return "No Changes in progress";
  if (view === "ready") return "No Changes ready to verify";
  if (view === "attention") return "No Changes need attention";
  if (view === "history") return "No Change history yet";
  return "No current Changes";
}

function relativeTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return "Just now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
  return `${Math.floor(elapsed / 86_400_000)}d ago`;
}
