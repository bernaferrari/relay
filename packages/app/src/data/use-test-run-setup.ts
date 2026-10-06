import { useEffect } from "react";
import type { Platform } from "../platform/types";
import {
  runConfigurationTargetUnavailable,
  usePersistedRunConfiguration,
  useRunConfigurationKey,
} from "./use-persisted-run-configuration";
import { useTestRunDestinations } from "./use-test-run-destinations";

type TestRunSetupInput = Omit<
  Parameters<typeof useTestRunDestinations>[0],
  "selectedTargetId" | "selectionReady"
> & { platform: Platform };

/** Restore the Test's own configuration before discovering its destination.
 * Optional inventory never replaces a saved choice or a saved account. */
export function useTestRunSetup(input: TestRunSetupInput) {
  const scope = useRunConfigurationKey(input.platform, `test-run:${input.testId}`, input.appMapId);
  const persisted = usePersistedRunConfiguration({
    storage: input.platform.storage,
    key: scope.key,
  });
  const destinations = useTestRunDestinations({
    ...input,
    selectedTargetId: persisted.selection.targetId,
    selectionReady: !persisted.loading,
  });
  const { targets, profiles, editorDocument } = destinations;
  const configuration = {
    ...persisted,
    targetUnavailable: runConfigurationTargetUnavailable(
      persisted.selection,
      targets.data?.map((target) => target.targetId),
    ),
  };
  useEffect(() => {
    if (!configuration.pristine || editorDocument.isPending) return;
    if (profiles.isEnabled && profiles.isPending) return;
    if (targets.isPending) return;
    const ready = (id?: string) =>
      Boolean(id && targets.data?.some((target) => target.targetId === id));
    const recorded = profiles.data?.find((profile) => profile.id === input.recordedProfileId);
    const recordedLogin = recorded?.account && ready(recorded.targetId) ? recorded : undefined;
    const selectionFor = (targetId: string, savedProfileId?: string) => ({
      targetId,
      ...(savedProfileId ? { savedProfileId } : {}),
      // Recording leaves the phone at its destination. A new Android Test
      // with an explicitly chosen app should reopen it before source proof;
      // saved configurations (including opting out) never enter this branch.
      ...(targets.data?.find((target) => target.targetId === targetId)?.platform === "android" &&
      editorDocument.data?.test.originApplication &&
      !/^https?:\/\//iu.test(editorDocument.data.test.originApplication)
        ? { startupMode: "cold" as const }
        : {}),
    });
    if (input.requestedTargetId)
      configuration.setSelection(
        selectionFor(
          input.requestedTargetId,
          recordedLogin?.targetId === input.requestedTargetId ? recordedLogin.id : undefined,
        ),
      );
    else if (recordedLogin)
      configuration.setSelection(selectionFor(recordedLogin.targetId!, recordedLogin.id));
    else if (ready(input.lastRunTargetId))
      configuration.setSelection(selectionFor(input.lastRunTargetId!));
    else if (ready(recorded?.targetId))
      configuration.setSelection(selectionFor(recorded!.targetId!));
    else if (targets.data?.length === 1)
      configuration.setSelection(selectionFor(targets.data[0]!.targetId));
  }, [
    configuration.pristine,
    configuration.setSelection,
    input.lastRunTargetId,
    input.requestedTargetId,
    input.recordedProfileId,
    targets.data,
    targets.isPending,
    profiles.data,
    profiles.isEnabled,
    profiles.isPending,
    editorDocument.isPending,
    editorDocument.data,
  ]);
  return { ...destinations, scope, configuration };
}
