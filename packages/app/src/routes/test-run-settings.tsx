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
import type { PlanPlatform } from "@relay/product/test-route-platforms";
import { testRunDestinationCopy } from "../data/test-run-targets";
import { runSetupProfile } from "../data/run-setup-profile";
import { TestTextRunInputs } from "../components/test-text-run-inputs";
import type { useTestTextInputs } from "../data/use-test-text-inputs";

type Configuration = ReturnType<typeof usePersistedRunConfiguration>;

export function TestRunSettings({
  testId,
  activeRun,
  targets,
  recordedPlatforms,
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
  textInputs,
}: {
  testId: string;
  activeRun: boolean;
  targets: {
    data?: readonly ProductTargetOption[];
    isPending: boolean;
    isError: boolean;
    isFetching?: boolean;
  };
  recordedPlatforms?: readonly PlanPlatform[];
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
  textInputs?: ReturnType<typeof useTestTextInputs>;
}) {
  const selectedProfile = runSetupProfile(
    profiles.data,
    targetId,
    configuration.selection.savedProfileId,
  );
  const destination = testRunDestinationCopy(recordedPlatforms);
  const availableProfiles = profiles.data?.filter(
    (profile) => !recordedPlatforms || recordedPlatforms.includes(profile.platform),
  );
  const browserSetup = !recordedPlatforms || recordedPlatforms.includes("browser");
  // A just-created browser can be absent from cached discovery while its
  // refresh is still running. Absence then means checking, not unavailable.
  const checkingTargets =
    targets.isPending ||
    Boolean(
      targets.isFetching &&
      targetId &&
      !targets.data?.some((target) => target.targetId === targetId),
    );
  const hasTargets = !checkingTargets && Boolean(targets.data?.length);
  const hasSavedLogins = browserSetup && availableProfiles?.some((profile) => profile.account);
  const profilePicker =
    hasTargets && availableProfiles?.length ? (
      <SelectField
        label={hasSavedLogins ? "Sign in as" : "Saved setup"}
        value={
          configuration.selection.savedProfileId ??
          (selectedProfile?.account ? selectedProfile.id : "automatic")
        }
        options={[
          {
            value: "automatic",
            label: selectedProfile?.account
              ? `Current browser · ${selectedProfile.account.name}`
              : hasSavedLogins
                ? "Current browser"
                : "Automatic",
          },
          ...availableProfiles.map((profile) => ({
            value: profile.id,
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
    ) : null;
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
        title={null}
        targetLabel={destination.label}
        targetPlaceholder={destination.placeholder}
        pairedWorkspaceLabel={
          pairedCount && (browserSetup || configuration.selection.usePairedWorkspace)
            ? `Use saved workspace · ${pairedCount} paired configurations`
            : undefined
        }
        configuration={{
          values: {
            targetName: targets.data?.find((target) => target.targetId === targetId)?.name,
          },
          validated: canStart,
          blockers: [
            ...(configuration.selection.usePairedWorkspace &&
            Object.keys(textInputs?.variables ?? {}).length
              ? [
                  {
                    id: "prompt-inputs",
                    label: "Use one device for prompt inputs",
                    detail: "Turn off the saved workspace to run with these values.",
                  },
                ]
              : []),
            ...(!browserSetup && configuration.selection.usePairedWorkspace
              ? [
                  {
                    id: "paired-platform",
                    label: "This saved workspace uses browsers",
                    detail: `Turn off the saved workspace, then ${destination.placeholder.toLowerCase()}.`,
                  },
                ]
              : []),
            ...(editorState !== "saved"
              ? [
                  {
                    id: "test-document",
                    label: editorState === "saving" ? "Saving test changes" : "Save test changes",
                    detail:
                      editorState === "failed"
                        ? "Resolve the save problem before running this test."
                        : "Run uses the saved test. Save the visible edits first.",
                  },
                ]
              : []),
            ...(configuration.targetUnavailable && hasTargets
              ? [
                  {
                    id: "target",
                    label: "Saved target is unavailable",
                    detail: `${destination.placeholder} to continue.`,
                  },
                ]
              : []),
            ...(profileBlocker ? [profileBlocker] : []),
          ],
        }}
        targetOptions={
          hasTargets
            ? targets.data?.map((target) => ({
                id: target.targetId,
                label: `${targetLabel(target).title} · ${
                  target.kind === "browser"
                    ? "Browser"
                    : target.platform === "ios"
                      ? "iOS"
                      : "Android"
                }${target.targetId === lastRunTargetId ? " · last used" : ""}`,
                detail: targetLabel(target).detail,
              }))
            : undefined
        }
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
        loading={configuration.loading || checkingTargets}
        error={scopeError ?? configuration.error}
        onRetry={scopeError ? onRetryScope : configuration.retry}
      >
        {textInputs ? <TestTextRunInputs state={textInputs} /> : null}
        {hasSavedLogins ? profilePicker : null}
        {hasTargets && browserSetup && selectedProfile?.account ? (
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
        {hasTargets ? (
          <details
            className="group border-t border-border/60 pt-3"
            open={configuration.selection.buildId ? true : undefined}
          >
            <summary className="min-h-10 cursor-pointer text-sm font-medium">
              Advanced run options
            </summary>
            <div className="grid gap-3 pt-2">
              {!hasSavedLogins ? profilePicker : null}
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
        ) : null}
        {checkingTargets ? (
          <PageLoading
            label={destination.label === "Browser" ? "Finding browsers…" : "Finding devices…"}
          />
        ) : !targets.data?.length ? (
          <EmptyState
            title={destination.emptyTitle}
            detail={destination.emptyDetail}
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
      {activeRun ? "This test is running." : "Devices are unavailable right now."}
    </p>
  );
}
