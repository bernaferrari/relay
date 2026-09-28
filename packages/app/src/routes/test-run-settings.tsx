/** @jsxImportSource react */
import { RunConfigurationComposer } from "../components/run-configuration-composer";
import { SelectField } from "../components/filter-select";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { Button } from "@relay/ui-react/components/button";
import { Link } from "@tanstack/react-router";
import { EmptyState } from "../components/product-patterns";
import { PageLoading, targetLabel } from "./recording-shared";
import { runSetupContinuation } from "../data/setup-continuation";
import { productLinkClassName } from "../lib/class-names";
import type { ProductTargetOption } from "../data/target-presentation";
import type { ProductRunBuildOption, ProductRunProfileOption } from "@relay/product/run-journey";
import type { RunConfigurationBlocker } from "../data/run-configuration";
import type { usePersistedRunConfiguration } from "../data/use-persisted-run-configuration";

type Configuration = ReturnType<typeof usePersistedRunConfiguration>;

export function TestRunSettings({
  testId,
  activeRun,
  targets,
  profiles,
  builds,
  configuration,
  pairedCount,
  targetId,
  lastRunTargetId,
  canStart,
  editorState,
  profileBlocker,
  scopeError,
  onRetryScope,
  startPending,
  onStart,
}: {
  testId: string;
  activeRun: boolean;
  targets: { data?: readonly ProductTargetOption[]; isPending: boolean; isError: boolean };
  profiles: { data?: readonly ProductRunProfileOption[] };
  builds: { data?: readonly ProductRunBuildOption[] };
  configuration: Configuration;
  pairedCount: number;
  targetId: string;
  lastRunTargetId?: string;
  canStart: boolean;
  editorState: "loading" | "dirty" | "saving" | "saved" | "failed";
  profileBlocker?: RunConfigurationBlocker;
  scopeError?: string;
  onRetryScope(): void;
  startPending: boolean;
  onStart(): void;
}) {
  const selectedProfile = profiles.data?.find(
    (profile) => profile.id === configuration.selection.savedProfileId,
  );
  return !activeRun && !targets.isError ? (
    <section
      id="test-run-setup"
      tabIndex={-1}
      className="min-w-0 scroll-mt-6 p-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/40 [&_select]:w-full [&_select]:min-w-0"
      aria-labelledby="test-run-setup-title"
    >
      <h2 id="test-run-setup-title" className="sr-only">
        Run setup
      </h2>
      <RunConfigurationComposer
        variant="plain"
        pairedWorkspaceLabel={
          pairedCount ? `Use saved workspace · ${pairedCount} paired configurations` : undefined
        }
        configuration={{
          values: {
            targetName: targets.data?.find((target) => target.targetId === targetId)?.name,
          },
          validated: canStart,
          blockers: [
            ...(editorState !== "saved"
              ? [
                  {
                    id: "test-document",
                    label: editorState === "saving" ? "Saving Test changes" : "Save Test changes",
                    detail:
                      editorState === "failed"
                        ? "Resolve the save problem before running this Test."
                        : "Run uses the saved Test. Save the visible edits first.",
                  },
                ]
              : []),
            ...(configuration.targetUnavailable
              ? [
                  {
                    id: "target",
                    label: "Saved target is unavailable",
                    detail: "Choose a ready device or browser to continue.",
                  },
                ]
              : []),
            ...(profileBlocker ? [profileBlocker] : []),
          ],
        }}
        targetOptions={targets.data?.map((target) => ({
          id: target.targetId,
          label: `${targetLabel(target).title} · ${
            target.kind === "browser" ? "Browser" : target.platform === "ios" ? "iOS" : "Android"
          }${target.targetId === lastRunTargetId ? " · last used" : ""}`,
          detail: targetLabel(target).detail,
        }))}
        selection={{
          ...configuration.selection,
          targetProfileId: targetId,
        }}
        onSelectionChange={(selection) => {
          const { targetProfileId: selectedTargetId, ...rest } = selection;
          configuration.setSelection({
            ...rest,
            targetId: selectedTargetId,
          });
        }}
        loading={configuration.loading || targets.isPending}
        error={scopeError ?? configuration.error}
        onRetry={scopeError ? onRetryScope : configuration.retry}
      >
        {profiles.data?.length ? (
          <SelectField
            label="Sign in as"
            value={configuration.selection.savedProfileId ?? "automatic"}
            options={[
              { value: "automatic", label: "No saved login (browser as it is)" },
              ...profiles.data.map((profile) => ({
                value: profile.id,
                // Name the login people recognize; the setup name only
                // when there is no login to show.
                label: `${profile.account?.name ?? profile.name}${profile.targetId && profile.targetId !== targetId ? " · other device" : ""}`,
              })),
            ]}
            onValueChange={(value) =>
              configuration.setSelection({
                ...configuration.selection,
                savedProfileId: value === "automatic" ? undefined : value,
              })
            }
          />
        ) : null}
        {selectedProfile?.account ? (
          <p className="grid gap-1 text-xs leading-4 text-muted-foreground">
            Runs as {selectedProfile.account.name} using its saved browser sign-in.
            <Link
              className={productLinkClassName}
              to="/environments"
              search={{ returnTo: runSetupContinuation(testId) }}
            >
              Refresh sign-in
            </Link>
          </p>
        ) : null}
        <details
          className="group border-t border-border/60 pt-3"
          open={
            configuration.selection.buildId || configuration.selection.startupMode === "cold"
              ? true
              : undefined
          }
        >
          <summary className="min-h-10 cursor-pointer text-sm font-medium">
            Advanced run options
          </summary>
          <div className="grid gap-3 pt-2">
            {builds.data?.length ? (
              <SelectField
                label="Build"
                value={configuration.selection.buildId ?? "current"}
                options={[
                  { value: "current", label: "Current build" },
                  ...builds.data
                    .filter((build) => build.status === "ready" && build.sourceSha)
                    .map((build) => ({
                      value: build.id,
                      label: `${build.name} · ${build.sourceSha?.slice(0, 12)}`,
                    })),
                ]}
                onValueChange={(value) =>
                  configuration.setSelection({
                    ...configuration.selection,
                    buildId: value === "current" ? undefined : value,
                  })
                }
              />
            ) : null}
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <Checkbox
                checked={configuration.selection.startupMode === "cold"}
                onCheckedChange={(checked) =>
                  configuration.setSelection({
                    ...configuration.selection,
                    startupMode: checked ? "cold" : undefined,
                  })
                }
              />
              Restart app before running
            </label>
          </div>
        </details>
        {targets.isPending ? (
          <PageLoading label="Finding devices…" />
        ) : !targets.data?.length ? (
          <EmptyState
            title="No device or browser is ready"
            detail="Connect a target to continue with this Test."
            action={
              <Link className={productLinkClassName} to="/devices">
                View devices
              </Link>
            }
          />
        ) : null}
        <div className="flex justify-end border-t border-border pt-3">
          <Button variant="default" onClick={() => onStart()} disabled={!canStart || startPending}>
            {startPending ? "Starting…" : "Run now"}
          </Button>
        </div>
      </RunConfigurationComposer>
    </section>
  ) : (
    <p className="p-4 text-sm text-muted-foreground">
      {activeRun ? "This Test is running." : "Devices are unavailable right now."}
    </p>
  );
}
