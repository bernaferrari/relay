/** @jsxImportSource react */
import { Button, CheckboxCard, RadioCard, RadioGroup } from "@relay/ui-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { runQueryKeys } from "../data/run-queries";
import { PageLoading, RecordingProblem } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId/run-across");

export function RunAcrossPage() {
  const { runAcrossService, runService } = useRouteContext({ from: "__root__" });
  const { testId } = routeApi.useParams();
  const navigate = useNavigate();
  const setup = useQuery({
    queryKey: ["run-across", "setup", testId],
    queryFn: async () => {
      const test = await runService.getTest(testId);
      if (!test) throw new TypeError("This Test is not available.");
      return runAcrossService.getSetup(test.appMapId, testId);
    },
    staleTime: 15_000,
  });
  const targets = useQuery({
    queryKey: runQueryKeys.targets,
    queryFn: () => runService.listTargets(),
    staleTime: 5_000,
  });
  const [targetId, setTargetId] = useState("");
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const target = useMemo(
    () => targets.data?.find((item) => item.targetId === targetId),
    [targetId, targets.data],
  );
  const preview = useMemo(() => {
    if (!setup.data || !target) return undefined;
    try {
      return runAcrossService.preview({ setup: setup.data, selected, target });
    } catch {
      return undefined;
    }
  }, [runAcrossService, selected, setup.data, target]);
  const start = useMutation({
    mutationFn: () => {
      if (!setup.data || !target) {
        throw new TypeError("Choose a ready device or browser and at least one data value.");
      }
      return runAcrossService.startPilot({ setup: setup.data, selected, target });
    },
    onSuccess: async (batch) => {
      await navigate({ to: "/batches/$batchId", params: { batchId: batch.id } });
    },
  });

  function toggleValue(dimensionId: string, valueId: string) {
    setSelected((current) => {
      const values = new Set(current[dimensionId] ?? []);
      if (values.has(valueId)) values.delete(valueId);
      else values.add(valueId);
      return { ...current, [dimensionId]: [...values] };
    });
  }

  const loading = setup.isPending || targets.isPending;
  return (
    <section className="relay-page relay-run-across-page">
      <Breadcrumbs
        items={[
          { label: "Tests", to: "/tests" },
          { label: setup.data?.testName ?? "Test" },
          { label: "Run with data" },
        ]}
      />
      <header className="relay-page-header">
        <p className="relay-eyebrow">Run with data</p>
        <h1>Choose cases and a device</h1>
        <p className="relay-page-description">
          Run one representative case first. Continue only after you have reviewed its Report.
        </p>
      </header>
      {loading ? <PageLoading label="Loading saved data and available devices…" /> : null}
      <RecordingProblem
        error={setup.error ?? targets.error ?? start.error}
        onRetry={() => {
          void setup.refetch();
          void targets.refetch();
        }}
        retrying={setup.isFetching || targets.isFetching}
      />
      {!loading && setup.data && !setup.error ? (
        <div className="relay-run-across-workspace">
          <section className="relay-run-across-card" aria-labelledby="data-set-title">
            <p className="relay-section-label">Data set</p>
            <h2 id="data-set-title">{setup.data.dataSet.name}</h2>
            <p>Select the saved values Relay should apply while repeating this Test.</p>
            {setup.data.dataSet.dimensions.map((dimension) => (
              <fieldset className="relay-run-across-options" key={dimension.id}>
                <legend>{dimension.name}</legend>
                {dimension.values.map((value) => (
                  <CheckboxCard
                    key={value.id}
                    name={dimension.id}
                    value={value.id}
                    checked={selected[dimension.id]?.includes(value.id) ?? false}
                    onCheckedChange={() => toggleValue(dimension.id, value.id)}
                    title={value.label}
                    description={value.detail}
                  />
                ))}
              </fieldset>
            ))}
            {!setup.data.dataSet.dimensions.length ? (
              <EmptyState
                title="No saved data yet"
                detail="Add a data value to this app before running across cases."
              />
            ) : null}
          </section>
          <section className="relay-run-across-card" aria-labelledby="target-title">
            <p className="relay-section-label">Device or browser</p>
            <h2 id="target-title">Where should Relay run?</h2>
            {targets.data?.length ? (
              <RadioGroup
                className="relay-run-across-options"
                name="run-across-target"
                value={targetId}
                onValueChange={setTargetId}
                aria-labelledby="target-title"
              >
                {targets.data.map((option) => (
                  <RadioCard
                    key={`${option.kind}:${option.targetId}`}
                    value={option.targetId}
                    title={option.name}
                    description={option.detail}
                  />
                ))}
              </RadioGroup>
            ) : (
              <EmptyState
                title="No device or browser is ready"
                detail="Connect a device or managed browser, then return here."
                action={
                  <Link className="relay-inline-link" to="/devices">
                    View devices
                  </Link>
                }
              />
            )}
            {preview ? (
              <div className="relay-run-across-preview" role="status">
                <strong>Ready to start</strong>
                <span>{preview.scopeLabel}</span>
                <small>
                  Relay starts with one representative case and pauses for review before the rest.
                </small>
              </div>
            ) : (
              <p className="relay-action-hint">
                Choose at least one value and one ready device or browser.
              </p>
            )}
            <Button
              variant="primary"
              onClick={() => start.mutate()}
              disabled={!preview || start.isPending}
            >
              {start.isPending ? "Starting pilot…" : "Start representative pilot"}
            </Button>
          </section>
        </div>
      ) : null}
    </section>
  );
}
