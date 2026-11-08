import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { SuiteProfileProductService } from "../data/suite-profile-product-service";

export function usePlanScheduleActions(
  suiteProfileService: SuiteProfileProductService,
  appId: string,
  suiteId: string,
) {
  const queryClient = useQueryClient();
  const toggleSchedule = useMutation({
    mutationFn: (input: { id: string; enabled: boolean }) => {
      if (!suiteProfileService.setPlanScheduleEnabled)
        throw new TypeError("Pausing schedules is unavailable.");
      return suiteProfileService.setPlanScheduleEnabled({
        ...input,
        appMapId: appId,
        combineId: suiteId,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suites", appId, suiteId, "schedules"] });
    },
  });
  const removeSchedule = useMutation({
    mutationFn: (id: string) => {
      if (!suiteProfileService.removePlanSchedule)
        throw new TypeError("Removing schedules is unavailable.");
      return suiteProfileService.removePlanSchedule(id);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["suites", appId, suiteId, "schedules"] });
    },
  });
  return { toggleSchedule, removeSchedule };
}
