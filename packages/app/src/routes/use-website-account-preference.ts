import { useQuery } from "@tanstack/react-query";
import type { ProductBrowserAccount } from "../data/app-resources-product-service";
import type { Platform } from "../platform/types";
import { websiteHost } from "./new-test-quick-start";

/** Remember a login per website without changing an explicit account choice. */
export function useWebsiteAccountPreference(
  platform: Platform,
  accounts?: readonly ProductBrowserAccount[],
) {
  const hosts = [
    ...new Set((accounts ?? []).flatMap((item) => (item.fixture.origins ?? []).map(websiteHost))),
  ].sort();
  return useQuery({
    queryKey: ["new-test", "remembered-accounts", hosts],
    queryFn: async () => {
      const entries = await Promise.all(
        hosts.map(
          async (host) =>
            [
              host,
              await Promise.resolve(platform.storage.get(`relay:website-account:${host}`)),
            ] as const,
        ),
      );
      return Object.fromEntries(
        entries.filter((entry): entry is readonly [string, string] => typeof entry[1] === "string"),
      );
    },
    enabled: Boolean(hosts.length),
  });
}
