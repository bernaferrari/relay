import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { RunProductService } from "./run-product-service";
import type { TestEditorProductService } from "./test-editor-product-service";
import { runQueryKeys } from "./run-queries";
import { recordedTestRunPlatforms } from "./test-run-targets";

/** Keep destination discovery and recorded platform scope together, so an
 * early browser response cannot select a browser for a loading native Test. */
export function useTestRunDestinations({
  testId,
  appMapId,
  recordedProfileId,
  runService,
  testEditorService,
}: {
  testId: string;
  appMapId?: string;
  recordedProfileId?: string;
  runService: RunProductService;
  testEditorService: TestEditorProductService;
}) {
  const discovery = useQuery({
    queryKey: runQueryKeys.targets,
    queryFn: () => runService.listTargets(),
    staleTime: 5_000,
    refetchInterval: 5_000,
  });
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
  const compatibleTargets = useMemo(
    () =>
      editorDocument.isPending
        ? undefined
        : discovery.data?.filter(
            (target) => !recordedPlatforms || recordedPlatforms.includes(target.platform),
          ),
    [editorDocument.isPending, discovery.data, recordedPlatforms],
  );
  return {
    targets: {
      ...discovery,
      data: compatibleTargets,
      isPending: discovery.isPending || editorDocument.isPending,
    },
    profiles,
    editorDocument,
    recordedPlatforms,
  };
}
