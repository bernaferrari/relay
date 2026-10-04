import { LiveRunStory } from "./run-story-pages";
import { PageHeader, WorkbenchPage } from "../components/page-layout";
/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Progress, ProgressLabel, ProgressValue } from "@relay/ui-react/components/progress";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useRouteContext } from "@tanstack/react-router";
import { useEffect, useRef } from "react";

import { EmptyState } from "../components/product-patterns";
import type { ProductRunState } from "../data/run-product-service";
import { runQueryKeys } from "../data/run-queries";
import { catalogQueryKeys } from "../data/catalog-queries";
import { clearRunPointerIfCurrent, readRunPointer } from "../data/run-pointer";
import { shouldRestorePersistedRun } from "../data/run-restore-gating";
import { RecordingProblem, targetLabel } from "./recording-shared";
import { RunLoading } from "./run-loading";
import { RunReport } from "./run-report";
import { attachedRunLinkTestId, attachedRunOwnership } from "../data/attached-run-ownership";
import { productLinkClassName } from "../lib/class-names";

const routeApi = getRouteApi("/runs/$runId");

export function RunPage() {
  const { runId } = routeApi.useParams();
  return <RunInspection runId={runId} />;
}

export function RunInspection({
  runId,
  testId: testIdProp,
  embedded = false,
}: {
  runId: string;
  testId?: string;
  embedded?: boolean;
}) {
  const { runService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const pointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const restoreEnabled =
    !pointer.isPending &&
    shouldRestorePersistedRun(pointer.data, runId) &&
    typeof runService.restore === "function";
  const restore = useQuery({
    queryKey: runQueryKeys.restore(runId),
    queryFn: async () => (await runService.restore?.(runId)) ?? null,
    enabled: restoreEnabled,
    staleTime: 0,
    retry: false,
  });
  const restoredState = restore.data ?? undefined;
  const restoreSettled = !restoreEnabled || restore.isFetched;
  const executionEnabled =
    !pointer.isPending &&
    restoreSettled &&
    pointer.data?.runId !== runId &&
    !restoredState &&
    typeof runService.inspectExecution === "function";
  const execution = useQuery({
    queryKey: ["run", "execution", runId],
    queryFn: async () => (await runService.inspectExecution?.(runId)) ?? null,
    enabled: executionEnabled,
    staleTime: 0,
    retry: false,
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 3_000),
  });
  const activePointer =
    pointer.data?.runId === runId
      ? pointer.data
      : restoredState?.workflow
        ? { workflowId: restoredState.workflow.workflowId, runId, testId: "" }
        : undefined;
  const activeWorkflowId = activePointer?.workflowId;
  const originTest = useRef<{ runId: string; testId?: string }>({ runId, testId: testIdProp });
  if (originTest.current.runId !== runId) originTest.current = { runId, testId: testIdProp };
  if (testIdProp) originTest.current.testId = testIdProp;
  if (activePointer?.testId) originTest.current.testId = activePointer.testId;
  const run = useQuery({
    queryKey: runQueryKeys.workflow(activePointer?.workflowId ?? "inactive"),
    queryFn: () => runService.inspect(activePointer!.workflowId),
    enabled: Boolean(activePointer),
    initialData: restoredState,
    staleTime: 0,
    retry: false,
    // Streaming is an optimization. A dropped terminal event or development
    // restart must not leave the saved run displaying Running indefinitely.
    refetchInterval: (query) => (isTerminal(query.state.data?.status) ? false : 3_000),
  });
  const state = run.data ?? restoredState ?? execution.data;
  const restorePending = restoreEnabled && !restore.isFetched;
  const terminal = isTerminal(state?.status);
  const target = state?.snapshot?.target;
  const targetPresentation = useQuery({
    queryKey: runQueryKeys.targetPresentation(target?.targetId ?? "unselected"),
    queryFn: () => runService.presentTargets([target!]),
    enabled: Boolean(target),
    staleTime: 30_000,
  });
  const report = useQuery({
    queryKey: runQueryKeys.report(runId),
    queryFn: async () => {
      const saved = await runService.getReport(runId, state?.report);
      if (state?.recovery && !saved.outcome)
        throw new Error("The run has not saved a final result yet.");
      return saved;
    },
    enabled:
      !pointer.isPending &&
      restoreSettled &&
      (!activePointer || terminal || Boolean(state?.recovery)) &&
      (!executionEnabled ||
        (execution.isFetched && (!execution.data || isTerminal(execution.data.status)))),
    retry: false,
  });
  const shouldWatch = Boolean(activePointer && state?.snapshot && !state.recovery && !terminal);
  const cancel = useMutation({
    mutationFn: async () =>
      activePointer
        ? runService.cancel({ workflowId: activePointer.workflowId })
        : ((await runService.cancelExecution?.(runId)) ?? undefined),
    onSuccess: async (state) => {
      if (!state) return;
      if (state.recovery || !activePointer) {
        await execution.refetch();
        return;
      }
      await queryClient.invalidateQueries({
        queryKey: runQueryKeys.workflow(activePointer.workflowId),
      });
      await queryClient.fetchQuery({
        queryKey: runQueryKeys.workflow(activePointer.workflowId),
        queryFn: () => runService.inspect(activePointer.workflowId),
        staleTime: 0,
      });
    },
  });

  useEffect(() => {
    if (!activeWorkflowId || !shouldWatch) return;
    const controller = new AbortController();
    void runService
      .watch({
        workflowId: activeWorkflowId,
        signal: controller.signal,
        onState(next) {
          if (next.workflow?.workflowId !== activeWorkflowId) return;
          queryClient.setQueryData(runQueryKeys.workflow(activeWorkflowId), next);
        },
      })
      .then((next) => {
        if (next.workflow?.workflowId !== activeWorkflowId) return;
        queryClient.setQueryData(runQueryKeys.workflow(activeWorkflowId), next);
        if (isTerminal(next.status)) {
          void queryClient.invalidateQueries({ queryKey: runQueryKeys.report(runId) });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          void queryClient.invalidateQueries({ queryKey: runQueryKeys.workflow(activeWorkflowId) });
      });
    return () => controller.abort();
  }, [activeWorkflowId, queryClient, runId, runService, shouldWatch]);

  useEffect(() => {
    if (!report.data) return;
    void clearRunPointerIfCurrent(platform, runId).then((cleared) => {
      if (!cleared) return;
      queryClient.setQueryData(runQueryKeys.pointer, null);
      void queryClient.invalidateQueries({ queryKey: catalogQueryKeys.runs });
      const testId = report.data.testId ?? originTest.current.testId;
      if (testId) {
        // Completing a Run can update the map revision behind the saved Test.
        // Refresh the document we just ran before offering another Run.
        void queryClient.invalidateQueries({ queryKey: ["test-editor", testId] });
        void queryClient.invalidateQueries({ queryKey: runQueryKeys.test(testId) });
      }
    });
  }, [platform, queryClient, report.data, runId]);

  if (report.data) {
    const ownership = attachedRunOwnership({
      routeTestId: testIdProp ?? originTest.current.testId,
      runTestId: report.data.testId,
    });
    if (embedded && ownership.kind === "foreign") {
      return (
        <EmptyState
          title="This Run belongs to another Test"
          detail="The copied result is still available, but it is not an attached report for this Test."
          action={
            <Link className={productLinkClassName} to="/runs/$runId" params={{ runId }}>
              Open the original Run
            </Link>
          }
        />
      );
    }
    return (
      <RunReport
        report={report.data}
        testId={attachedRunLinkTestId(ownership, report.data.testId)}
        runService={runService}
        embedded={embedded}
      />
    );
  }

  const snapshot = state?.snapshot;
  const canCancel = Boolean(
    snapshot?.allowedNextActions.includes("cancel") && !state?.recovery && !cancel.data?.recovery,
  );
  const loading =
    pointer.isPending ||
    restorePending ||
    (Boolean(activePointer) && run.isPending) ||
    (executionEnabled && execution.isPending) ||
    (terminal && report.isPending);
  const problem = pointer.error ?? restore.error ?? run.error ?? report.error ?? cancel.error;
  const recovery = cancel.data?.recovery ?? state?.recovery;
  const retrying =
    pointer.isFetching ||
    restore.isFetching ||
    execution.isFetching ||
    run.isFetching ||
    report.isFetching;
  const retry = () => {
    void pointer.refetch();
    if (typeof runService.restore === "function") void restore.refetch();
    if (!activePointer && typeof runService.inspectExecution === "function")
      void execution.refetch();
    if (activePointer) void run.refetch();
    if (!activePointer || terminal || state?.recovery) void report.refetch();
  };

  const problemView = (
    <RecordingProblem
      error={problem}
      recovery={recovery}
      onRetry={retry}
      retrying={retrying}
      layout="centered"
    />
  );

  if (problem || recovery) {
    if (embedded) return problemView;
    return (
      <WorkbenchPage className="flex min-h-full max-w-5xl flex-col">
        <PageHeader
          crumbs={[{ label: "Runs", to: "/runs" }, { label: "Run" }]}
          title={snapshot?.title ?? "Run unavailable"}
          titleHidden
        />
        {problemView}
      </WorkbenchPage>
    );
  }

  if (loading) {
    const loadingView = <RunLoading />;
    if (embedded) return loadingView;
    return (
      <WorkbenchPage className="max-w-5xl">
        <PageHeader
          crumbs={[{ label: "Runs", to: "/runs" }, { label: "Run" }]}
          title={snapshot?.title ?? "Run details"}
        />
        {loadingView}
      </WorkbenchPage>
    );
  }

  if (embedded) {
    return (
      <section
        className="flex h-full min-h-0 items-center justify-center p-6"
        aria-label="Attached run"
      >
        {snapshot ? (
          <section className="flex w-full items-center justify-center" aria-label="Run progress">
            <div className="flex w-full max-w-sm flex-col items-center text-center">
              <h2 className="mt-1 text-base font-semibold" role="status">
                {snapshot.progress.label}
              </h2>
              {snapshot.progress.total !== undefined ? (
                <Progress
                  className="mt-4 w-full text-left"
                  value={snapshot.progress.completed ?? 0}
                  max={snapshot.progress.total}
                >
                  <ProgressLabel>Completed steps</ProgressLabel>
                  <ProgressValue>
                    {() => `${snapshot.progress.completed ?? 0} of ${snapshot.progress.total}`}
                  </ProgressValue>
                </Progress>
              ) : null}
              {canCancel ? (
                <Button
                  className="mt-4"
                  variant="outline"
                  size="sm"
                  onClick={() => cancel.mutate()}
                  disabled={cancel.isPending}
                >
                  {cancel.isPending ? "Cancelling…" : "Cancel run"}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </section>
    );
  }

  const liveJobId = state?.run?.jobId;
  if (liveJobId && typeof runService.liveJob === "function") {
    return (
      <WorkbenchPage className="flex h-full min-h-0 flex-col !p-0 overflow-auto">
        <LiveRunStory
          jobId={liveJobId}
          title={snapshot?.title ?? "Run"}
          {...(snapshot?.target
            ? { targetName: targetLabel(targetPresentation.data?.[0] ?? snapshot.target).title }
            : {})}
          runService={runService}
          {...(canCancel ? { onCancel: () => cancel.mutate() } : {})}
          cancelling={cancel.isPending}
        />
      </WorkbenchPage>
    );
  }

  return (
    <WorkbenchPage className="max-w-5xl">
      <PageHeader
        crumbs={[
          { label: "Runs", to: "/runs" },
          ...(activePointer ? [{ label: snapshot?.title ?? "Test" }] : []),
          { label: "Run" },
        ]}
        title={snapshot?.title ?? "Run"}
        description={
          snapshot?.target
            ? targetLabel(targetPresentation.data?.[0] ?? snapshot.target).title
            : undefined
        }
        actions={
          <>
            {activePointer?.testId ? (
              <Button
                nativeButton={false}
                render={<Link to="/tests/$testId" params={{ testId: activePointer.testId }} />}
                variant="ghost"
              >
                View test
              </Button>
            ) : null}
            {canCancel ? (
              <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {cancel.isPending ? "Cancelling…" : "Cancel Run"}
              </Button>
            ) : null}
          </>
        }
      />

      {snapshot ? (
        <section className="rounded-xl border border-border bg-card p-5" aria-label="Run progress">
          <h2 className="text-base font-semibold" role="status">
            {snapshot.progress.label}
          </h2>
          {snapshot.progress.total !== undefined ? (
            <Progress
              className="mt-4"
              value={snapshot.progress.completed ?? 0}
              max={snapshot.progress.total}
            >
              <ProgressLabel>Completed steps</ProgressLabel>
              <ProgressValue>
                {() => `${snapshot.progress.completed ?? 0} of ${snapshot.progress.total}`}
              </ProgressValue>
            </Progress>
          ) : null}
        </section>
      ) : null}
    </WorkbenchPage>
  );
}

function isTerminal(status: ProductRunState["status"] | undefined): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
