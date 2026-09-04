/** @jsxImportSource react */
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  RadioCard,
  RadioGroup,
} from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { ProductTestStep } from "@relay/product/catalog";
import { Breadcrumbs, EmptyState, OutcomeMark } from "../components/product-patterns";
import { TestStepEvidencePreview } from "../components/test-step-evidence-preview";
import { runQueryKeys } from "../data/run-queries";
import { readRunPointer, writeRunPointer } from "../data/run-pointer";
import { useLatestTestReport } from "../hooks/use-latest-test-report";
import { PageLoading, RecordingProblem, targetLabel } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId");

export function TestPage() {
  const { runService, platform, queryClient } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const navigate = useNavigate();
  const [targetId, setTargetId] = useState("");
  const [evidenceStepId, setEvidenceStepId] = useState("");
  const test = useQuery({
    queryKey: runQueryKeys.test(testId),
    queryFn: () => runService.getTest(testId),
  });
  const {
    recentRuns,
    latestReport,
    loading: reportLoading,
  } = useLatestTestReport(runService, testId);
  const pointer = useQuery({
    queryKey: runQueryKeys.pointer,
    queryFn: async () => (await readRunPointer(platform)) ?? null,
    staleTime: Infinity,
  });
  const targets = useQuery({
    queryKey: runQueryKeys.targets,
    queryFn: () => runService.listTargets(),
    staleTime: 5_000,
  });
  useEffect(() => {
    if (!targetId && targets.data?.length === 1) setTargetId(targets.data[0]!.targetId);
  }, [targetId, targets.data]);
  const start = useMutation({
    mutationFn: async () => {
      if (!test.data || !targetId) {
        throw new TypeError("Choose a ready device or browser for this Run.");
      }
      const started = await runService.start({
        testId,
        appMapId: test.data.appMapId,
        targetId,
      });
      const workflowId = started.workflow?.workflowId;
      if (!workflowId) {
        if (started.recovery) return started;
        throw new TypeError("Relay could not start this Run.");
      }
      const canonical = await runService.inspect(workflowId);
      const runId = canonical.run?.runId ?? started.run?.runId;
      if (!runId) {
        if (canonical.recovery) return canonical;
        throw new TypeError("Relay could not open the new Run.");
      }
      const durable = canonical.run?.runId ? canonical : { ...canonical, run: started.run };
      await writeRunPointer(platform, { workflowId, runId, testId });
      queryClient.setQueryData(runQueryKeys.pointer, { workflowId, runId, testId });
      queryClient.setQueryData(runQueryKeys.workflow(workflowId), durable);
      return durable;
    },
    onSuccess: async (state) => {
      if (!state.run?.runId) return;
      await navigate({ to: "/runs/$runId", params: { runId: state.run.runId } });
    },
  });

  const activeRun = pointer.data;
  const loading = test.isPending || targets.isPending || pointer.isPending;
  const evidenceSteps = flattenSteps(test.data?.steps ?? []);
  const selectedEvidenceStep =
    evidenceSteps.find((step) => step.id === evidenceStepId) ?? evidenceSteps.at(0);

  return (
    <section className="relay-page relay-test-page">
      <Breadcrumbs
        items={[{ label: "Tests", to: "/tests" }, { label: test.data?.name ?? "Test" }]}
      />
      <header className="relay-page-header relay-test-header">
        <div>
          {test.data ? (
            <div className="relay-entity-context">
              <Badge variant="success">Saved Test</Badge>
              <span>{test.data.appName}</span>
            </div>
          ) : (
            <p className="relay-eyebrow">Test</p>
          )}
          <h1>{test.data?.name ?? "Test"}</h1>
          {test.data ? (
            <p className="relay-page-description">A reviewed journey, ready to run again.</p>
          ) : null}
        </div>
        <div className="relay-test-header-actions">
          <Button
            render={<Link to="/tests/$testId/edit" params={{ testId }} />}
            variant="secondary"
            size="small"
          >
            Edit Test
          </Button>
          <Button
            render={<Link to="/tests/$testId/run-across" params={{ testId }} />}
            variant="ghost"
            size="small"
          >
            Run with data
          </Button>
        </div>
      </header>

      {loading ? <PageLoading label="Loading the Test and available devices…" /> : null}
      <RecordingProblem
        error={test.error ?? targets.error ?? start.error}
        recovery={start.data?.recovery}
        onRetry={() => {
          void test.refetch();
          void targets.refetch();
        }}
        retrying={test.isFetching || targets.isFetching}
      />

      {!loading && !test.data && !test.isError ? (
        <EmptyState
          title="This Test is not available"
          detail="It may have been removed or may belong to another app. Choose a saved Test to continue."
          action={
            <Link className="relay-inline-link" to="/tests">
              Browse saved Tests
            </Link>
          }
        />
      ) : null}

      {activeRun ? (
        <div className="relay-resume-recording relay-resume-run">
          <div>
            <strong>A Run is already in progress</strong>
            <p>Resume it before starting this Test again.</p>
          </div>
          <Button
            variant="primary"
            size="small"
            render={<Link to="/runs/$runId" params={{ runId: activeRun.runId }} />}
          >
            Resume Run
          </Button>
        </div>
      ) : null}

      {!loading && test.data && !activeRun && !targets.isError ? (
        <div className="relay-test-content">
          <Card className="relay-run-setup">
            <CardHeader className="relay-run-setup-header">
              <div>
                <CardTitle id="run-target-title">Run this Test</CardTitle>
                <CardDescription>
                  Choose a ready device or browser. Relay will repeat the saved steps unchanged.
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              {targets.data?.length ? (
                <RadioGroup
                  className="relay-run-targets"
                  name="run-target"
                  value={targetId}
                  onValueChange={setTargetId}
                  aria-labelledby="run-target-title"
                >
                  {targets.data.map((target) => {
                    const label = targetLabel(target);
                    return (
                      <RadioCard
                        key={`${target.kind}:${target.targetId}`}
                        value={target.targetId}
                        title={label.title}
                        description={label.detail}
                      />
                    );
                  })}
                </RadioGroup>
              ) : (
                <EmptyState
                  title="No device or browser is ready"
                  detail="Connect a device or managed browser, then return here to run this Test."
                  action={
                    <Link className="relay-inline-link" to="/devices">
                      View devices
                    </Link>
                  }
                />
              )}
            </CardContent>
            <CardFooter className="relay-run-setup-actions">
              <Button
                variant="primary"
                onClick={() => start.mutate()}
                disabled={!targetId || start.isPending}
              >
                {start.isPending ? "Starting…" : "Run Test"}
              </Button>
              {!targetId && targets.data?.length ? (
                <span className="relay-action-hint">Choose where to run</span>
              ) : null}
            </CardFooter>
          </Card>

          <section className="relay-test-overview" aria-labelledby="test-overview-title">
            <div className="relay-section-heading">
              <div>
                <p className="relay-section-label">Journey</p>
                <h2 id="test-overview-title">Saved steps</h2>
              </div>
              <span>{test.data.stepCount === 1 ? "1 step" : `${test.data.stepCount} steps`}</span>
            </div>
            {test.data.steps?.length ? (
              <ol className="relay-test-readable-steps">
                {test.data.steps.map((step, index) => (
                  <ReadableStep
                    key={step.id}
                    step={step}
                    number={String(index + 1)}
                    selectedId={selectedEvidenceStep?.id}
                    onSelect={setEvidenceStepId}
                  />
                ))}
              </ol>
            ) : (
              <p className="relay-test-no-steps">This Test has no reviewed steps yet.</p>
            )}
            {selectedEvidenceStep ? (
              <TestStepEvidencePreview
                step={selectedEvidenceStep}
                report={latestReport.data}
                hasRuns={Boolean(recentRuns.data?.length)}
                loading={reportLoading}
              />
            ) : null}
          </section>
        </div>
      ) : null}

      {!loading && test.data && recentRuns.data?.length ? (
        <section className="relay-test-runs" aria-labelledby="test-runs-title">
          <div className="relay-section-heading">
            <div>
              <p className="relay-section-label">Reports</p>
              <h2 id="test-runs-title">Recent Runs</h2>
            </div>
            <Link className="relay-inline-link" to="/runs" search={{ view: "all" }}>
              View all Runs
            </Link>
          </div>
          <ul>
            {[...recentRuns.data]
              .sort(
                (left, right) =>
                  (right.finishedAt ?? right.startedAt ?? right.queuedAt) -
                  (left.finishedAt ?? left.startedAt ?? left.queuedAt),
              )
              .slice(0, 4)
              .map((run) => (
                <li key={run.id}>
                  <Link to="/runs/$runId" params={{ runId: run.id }}>
                    <OutcomeMark outcome={run.outcome ?? run.phase} />
                    <span>{run.targetName ?? "Saved target"}</span>
                    <small>{formatRunDate(run.finishedAt ?? run.startedAt ?? run.queuedAt)}</small>
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function ReadableStep({
  step,
  number,
  selectedId,
  onSelect,
}: {
  step: ProductTestStep;
  number: string;
  selectedId: string | undefined;
  onSelect(stepId: string): void;
}) {
  return (
    <li data-selected={selectedId === step.id}>
      <span>{number}</span>
      <button type="button" aria-pressed={selectedId === step.id} onClick={() => onSelect(step.id)}>
        <strong>{step.intent}</strong>
        <small>
          {step.kind === "validation" ? "Checkpoint" : "Action"}
          {step.capture ? " · Evidence captured" : ""}
          {step.status === "needs-review" ? " · Needs review" : ""}
        </small>
      </button>
      {step.children?.length ? (
        <ol>
          {step.children.map((child, index) => (
            <ReadableStep
              key={child.id}
              step={child}
              number={`${number}.${index + 1}`}
              selectedId={selectedId}
              onSelect={onSelect}
            />
          ))}
        </ol>
      ) : null}
    </li>
  );
}

function flattenSteps(steps: readonly ProductTestStep[]): readonly ProductTestStep[] {
  return steps.flatMap((step) => [step, ...flattenSteps(step.children ?? [])]);
}

function formatRunDate(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(value);
}
