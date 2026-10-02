import { useEffect, useState } from "react";
import type { ProductAppOption } from "../data/recording-product-service";
import type { ProductBrowserSpace } from "../data/browser-spaces-product-service";
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
