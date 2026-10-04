import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ProductAppOption, RecordingProductService } from "../data/recording-product-service";
import type { ProductBrowserSpace } from "../data/browser-spaces-product-service";
import { recordingQueryKeys } from "../data/recording-queries";
import { websiteHost } from "./new-test-quick-start";

export function initialSetupMode(input: {
  app?: ProductAppOption;
  requestedAppId?: string;
  requestedTargetId?: string;
  startsFromPath: boolean;
}): "website" | "detailed" {
  if (input.requestedTargetId || input.startsFromPath) return "detailed";
  if (!input.requestedAppId || input.app?.platform === "web") return "website";
  return "detailed";
}

export function useNewTestSetup(
  input: Parameters<typeof initialSetupMode>[0] & {
    requestedSite?: string;
    spaces?: readonly ProductBrowserSpace[];
  },
) {
  const [choice, setSetupMode] = useState<"website" | "detailed">();
  const [address, setBrowserUrl] = useState<string | undefined>(input.requestedSite);
  const setupMode = choice ?? initialSetupMode(input);
  const savedAddress =
    input.app?.platform === "web"
      ? [...(input.spaces ?? [])]
          .sort((a, b) => b.updatedAt - a.updatedAt)
          .find((space) => websiteHost(space.startUrl) === input.app?.name)?.startUrl
      : undefined;
  useEffect(() => {
    if (address === undefined && savedAddress) setBrowserUrl(savedAddress);
  }, [address, savedAddress]);
  return { setupMode, setSetupMode, browserUrl: address ?? "", setBrowserUrl };
}

export function useNewTestTargets(input: {
  service: RecordingProductService;
  enabled: boolean;
  targetKind?: "device" | "browser";
  requestedTargetId?: string;
  selectedTargetId?: string;
}) {
  const { service, targetKind, requestedTargetId, selectedTargetId } = input;
  return useQuery({
    queryKey: [...recordingQueryKeys.targets, targetKind, requestedTargetId],
    enabled: input.enabled,
    queryFn: async () => {
      const state = await service.connect({
        targetKind,
        ...(requestedTargetId ? { targetId: requestedTargetId } : {}),
      });
      return { ...state, targetOptions: await service.presentTargets(state.targets) };
    },
    staleTime: 5_000,
    refetchInterval: (query) =>
      selectedTargetId &&
      !query.state.data?.targetOptions.some((target) => target.targetId === selectedTargetId)
        ? 5_000
        : false,
  });
}
