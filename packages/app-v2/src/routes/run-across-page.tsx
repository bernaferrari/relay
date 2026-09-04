/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel } from "@relay/ui-react/components/field";
import { RadioGroup, RadioGroupItem } from "@relay/ui-react/components/radio-group";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { runQueryKeys } from "../data/run-queries";
import { PageLoading, RecordingProblem, errorMessage } from "./recording-shared";

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
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const target = useMemo(
    () => targets.data?.find((item) => item.targetId === targetId),
    [targetId, targets.data],
  );
  const previewResult = useMemo(() => {
    if (!setup.data || !target) return { preview: undefined, error: undefined };
    try {
      return {
        preview: runAcrossService.preview({ setup: setup.data, selected, target }),
        error: undefined,
      };
    } catch (error) {
      return { preview: undefined, error: errorMessage(error) };
    }
  }, [previewAttempt, runAcrossService, selected, setup.data, target]);
  const preview = previewResult.preview;
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
        error={setup.error ?? targets.error ?? start.error ?? previewResult.error}
        onRetry={() => {
          void setup.refetch();
          void targets.refetch();
          setPreviewAttempt((attempt) => attempt + 1);
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
                  <FieldLabel
                    key={value.id}
                    className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                  >
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {value.label}
                      </span>
                      <span className="truncate text-xs leading-snug text-muted-foreground">
                        {value.detail}
                      </span>
                    </span>
                    <Checkbox
                      name={dimension.id}
                      value={value.id}
                      checked={selected[dimension.id]?.includes(value.id) ?? false}
                      onCheckedChange={() => toggleValue(dimension.id, value.id)}
                    />
                  </FieldLabel>
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
                  <FieldLabel
                    key={`${option.kind}:${option.targetId}`}
                    className="flex min-h-14 min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50"
                  >
                    <RadioGroupItem value={option.targetId} />
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium text-foreground">
                        {option.name}
                      </span>
                      <span className="truncate text-xs leading-snug text-muted-foreground">
                        {option.detail}
                      </span>
                    </span>
                  </FieldLabel>
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
              variant="default"
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
