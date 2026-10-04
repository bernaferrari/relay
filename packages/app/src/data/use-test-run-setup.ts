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
    const ready = (id?: string) =>
      Boolean(id && targets.data?.some((target) => target.targetId === id));
    const recorded = profiles.data?.find((profile) => profile.id === input.recordedProfileId);
    const recordedLogin = recorded?.account && ready(recorded.targetId) ? recorded : undefined;
    if (input.requestedTargetId)
      configuration.setSelection({
        targetId: input.requestedTargetId,
        ...(recordedLogin?.targetId === input.requestedTargetId
          ? { savedProfileId: recordedLogin.id }
          : {}),
      });
    else if (recordedLogin)
      configuration.setSelection({
        targetId: recordedLogin.targetId!,
        savedProfileId: recordedLogin.id,
      });
    else if (ready(input.lastRunTargetId))
      configuration.setSelection({ targetId: input.lastRunTargetId! });
    else if (ready(recorded?.targetId))
      configuration.setSelection({ targetId: recorded!.targetId! });
    else if (targets.data?.length === 1)
      configuration.setSelection({ targetId: targets.data[0]!.targetId });
  }, [
    configuration.pristine,
    configuration.setSelection,
    input.lastRunTargetId,
    input.requestedTargetId,
    input.recordedProfileId,
    targets.data,
    profiles.data,
    profiles.isEnabled,
    profiles.isPending,
    editorDocument.isPending,
  ]);
  return { ...destinations, scope, configuration };
}
