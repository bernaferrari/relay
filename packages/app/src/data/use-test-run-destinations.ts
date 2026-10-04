import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RunProductService, RunTargetDiscoveryScope } from "./run-product-service";
import type { TestEditorProductService } from "./test-editor-product-service";
import { runQueryKeys } from "./run-queries";
import { recordedTestRunPlatforms } from "./test-run-targets";

/** Keep destination discovery and recorded platform scope together, so an
 * early browser response cannot select a browser for a loading native Test. */
export function useTestRunDestinations({
  testId,
  appMapId,
  recordedProfileId,
  selectedTargetId,
  requestedTargetId,
  lastRunTargetId,
  lastRunTargetPending = false,
  selectionReady = true,
  discoverAlternatives = true,
  runService,
  testEditorService,
}: {
  testId: string;
  appMapId?: string;
  recordedProfileId?: string;
  selectedTargetId?: string;
  requestedTargetId?: string;
  lastRunTargetId?: string;
  lastRunTargetPending?: boolean;
  selectionReady?: boolean;
  discoverAlternatives?: boolean;
  runService: RunProductService;
  testEditorService: TestEditorProductService;
}) {
  const profiles = useQuery({
    queryKey: ["run-config", "profiles", appMapId],
    queryFn: () => runService.listProfiles?.(appMapId!) ?? Promise.resolve([]),
    enabled: Boolean(appMapId && runService.listProfiles),
    staleTime: 15_000,
  });
  const editorDocument = useQuery({
    queryKey: ["test-editor", testId, appMapId],
    queryFn: () => testEditorService.get(testId, appMapId!),
    staleTime: 5_000,
    enabled: Boolean(appMapId),
  });
  const recordedPlatforms = useMemo(
    () =>
      recordedTestRunPlatforms(
        editorDocument.data,
        profiles.data?.find((profile) => profile.id === recordedProfileId)?.platform,
      ),
    [editorDocument.data, profiles.data, recordedProfileId],
  );
  const recordedProfile = profiles.data?.find((profile) => profile.id === recordedProfileId);
  const preferredTargetId =
    selectedTargetId ??
    requestedTargetId ??
    (recordedProfile?.account ? recordedProfile.targetId : undefined) ??
    lastRunTargetId ??
    recordedProfile?.targetId;
  const targetKind =
    recordedPlatforms?.length && recordedPlatforms.every((platform) => platform === "browser")
      ? "browser"
      : recordedPlatforms?.length &&
          recordedPlatforms.every((platform) => platform === "android" || platform === "ios")
        ? "device"
        : undefined;
  const readyToDiscover =
    Boolean(appMapId) &&
    selectionReady &&
    !editorDocument.isPending &&
    (!profiles.isEnabled || !profiles.isPending) &&
    (!lastRunTargetPending ||
      Boolean(
        selectedTargetId ||
        requestedTargetId ||
        (recordedProfile?.account && recordedProfile.targetId),
      ));
  const hasRoute = recordedPlatforms?.length !== 0;
  const scope: RunTargetDiscoveryScope = {
    ...(targetKind ? { targetKind } : {}),
    ...(preferredTargetId ? { targetId: preferredTargetId } : {}),
  };
  const discovery = useQuery({
    queryKey: runQueryKeys.scopedTargets(scope),
    queryFn: () => runService.listTargets(scope),
    enabled: readyToDiscover && hasRoute,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  });
  // Alternatives fill the picker after the known destination is checked. A
  // slow unrelated browser must not delay Run on the selected browser.
  const alternativeScope: RunTargetDiscoveryScope = targetKind ? { targetKind } : {};
  const alternatives = useQuery({
    queryKey: runQueryKeys.scopedTargets(alternativeScope),
    queryFn: () => runService.listTargets(alternativeScope),
    enabled:
      readyToDiscover &&
      hasRoute &&
      discoverAlternatives &&
      Boolean(preferredTargetId) &&
      !discovery.isPending,
    staleTime: 5_000,
    refetchInterval: 5_000,
    retry: false,
  });
  const compatibleTargets = useMemo(() => {
    if (!readyToDiscover) return undefined;
    if (!hasRoute) return [];
    if (discovery.isPending) return undefined;
    const targets = new Map(
      discovery.data
        ?.filter((target) => !preferredTargetId || target.targetId === preferredTargetId)
        .map((target) => [target.targetId, target]),
    );
    // The exact check is authoritative even when optional inventory still
    // contains an older ready observation for the selected destination.
    if (preferredTargetId) {
      for (const target of alternatives.data ?? []) {
        if (target.targetId !== preferredTargetId) targets.set(target.targetId, target);
      }
    }
    return [...targets.values()].filter(
      (target) => !recordedPlatforms || recordedPlatforms.includes(target.platform),
    );
  }, [
    readyToDiscover,
    hasRoute,
    discovery.isPending,
    discovery.data,
    alternatives.data,
    preferredTargetId,
    recordedPlatforms,
  ]);
  const awaitingAlternatives = Boolean(
    discoverAlternatives && preferredTargetId && discovery.isError && alternatives.isPending,
  );
  const error = discovery.isError
    ? preferredTargetId && !alternatives.isError
      ? null
      : discovery.error
    : null;
  return {
    targets: {
      ...discovery,
      data: compatibleTargets,
      isPending: !readyToDiscover || (hasRoute && (discovery.isPending || awaitingAlternatives)),
      isFetching: discovery.isFetching || (awaitingAlternatives && alternatives.isFetching),
      isError: Boolean(error),
      error,
    },
    profiles,
    editorDocument,
    recordedPlatforms,
  };
}
