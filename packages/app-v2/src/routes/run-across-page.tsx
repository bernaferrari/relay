/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, getRouteApi, useNavigate, useRouteContext } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Breadcrumbs, EmptyState } from "../components/product-patterns";
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import { useRunConfigurationKey } from "../data/use-persisted-run-configuration";
import { usePersistedRunConfiguration } from "../data/use-persisted-run-configuration";
import { runQueryKeys } from "../data/run-queries";
import { PageLoading, RecordingProblem, errorMessage } from "./recording-shared";

const routeApi = getRouteApi("/tests/$testId/run-across");

export function RunAcrossPage() {
  const { runAcrossService, runService, platform } = useRouteContext({ from: "__root__" });
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
  const scope = useRunConfigurationKey(platform, `test:${testId}`, setup.data?.appMapId);
  const configuration = usePersistedRunConfiguration({
    storage: platform.storage,
    key: scope.key,
    targetOptions: targets.data?.map((item) => ({ id: item.targetId, label: item.name })),
  });
  const targetId = configuration.selection.targetProfileId ?? "";
  const selected = useMemo(() => {
    const chosen = new Set(configuration.selection.dataSetIds ?? []);
    return Object.fromEntries((setup.data?.dataSet.dimensions ?? []).map((dimension) => [dimension.id, dimension.values.filter((value) => chosen.has(JSON.stringify([dimension.id, value.id]))).map((value) => value.id)]));
  }, [configuration.selection.dataSetIds, setup.data]);
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
          <RunConfigurationComposer
            configuration={{
              values: {
                targetProfileId: target?.targetId,
                targetName: target?.name,
                dataSetName: setup.data.dataSet.name,
              },
              blockers: previewResult.error
                ? [
                    {
                      id: "preview",
                      label: "Configuration unavailable",
                      detail: previewResult.error,
                    },
                  ]
                : configuration.targetUnavailable
                  ? [
                      {
                        id: "target",
                        label: "Saved environment is unavailable",
                        detail: "Choose another environment to continue.",
                      },
                    ]
                  : !target
                    ? [{ id: "target", label: "Choose a ready device or browser" }]
                    : [],
              validated: Boolean(preview),
            }}
            targetOptions={targets.data?.map((item) => ({
              id: item.targetId,
              label: item.name,
              detail: item.detail,
            }))}
            dataSetOptions={setup.data.dataSet.dimensions.flatMap((dimension) =>
              dimension.values.map((value) => ({
                id: JSON.stringify([dimension.id, value.id]),
                label: `${dimension.name}: ${value.label}`,
                detail: value.detail,
              })),
            )}
            selection={configuration.selection}
            onSelectionChange={configuration.setSelection}
            loading={configuration.loading}
            error={scope.error ?? configuration.error}
            onRetry={configuration.retry}
            targetGroupName="run-across-target"
          >
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
              disabled={!preview || start.isPending || configuration.loading}
            >
              {start.isPending ? "Starting first case…" : "Run first case"}
            </Button>
          </RunConfigurationComposer>
        </div>
      ) : null}
    </section>
  );
}
