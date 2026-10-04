import type { ProductBrowserSpace } from "./browser-spaces-product-service";
import type { ProductDevice } from "./device-product-service";

export type BrowserDestinationGroup = {
  readonly key: string;
  readonly label: string;
  readonly url?: string;
  readonly devices: readonly ProductDevice[];
};

type BrowserSites = ReadonlyMap<string, ProductBrowserSpace>;

/** Group the catalog by its exact start address without choosing or replacing
 * a browser identity. Accounts, cookies, and saved Test targets stay distinct. */
export function groupBrowserDestinations(
  devices: readonly ProductDevice[],
  sites: BrowserSites,
  options: { keepNamedSeparate?: boolean } = {},
): readonly BrowserDestinationGroup[] {
  const groups = new Map<string, BrowserDestinationGroup>();
  for (const device of devices) {
    const address = browserAddress(sites.get(device.id)?.startUrl ?? device.browserUrl);
    const key =
      address && !(options.keepNamedSeparate && isNamedBrowser(device, sites))
        ? `url:${address.url}`
        : `target:${device.id}`;
    const group = groups.get(key);
    groups.set(key, {
      key,
      label: address?.label ?? device.name,
      ...(address ? { url: address.url } : {}),
      devices: [...(group?.devices ?? []), device],
    });
  }
  const result = [...groups.values()];
  if (options.keepNamedSeparate)
    result.sort(
      (left, right) =>
        Number(isNamedBrowser(right.devices[0]!, sites)) -
        Number(isNamedBrowser(left.devices[0]!, sites)),
    );
  return result;
}

/** Only addresses that explicitly name this machine are local. Retention,
 * account state, and how the target was created are separate facts. */
export function isLoopbackBrowserUrl(value: string | undefined): boolean {
  try {
    if (!value) return false;
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLocaleLowerCase().replace(/\.$/u, "");
    return (
      host === "localhost" ||
      host.endsWith(".localhost") ||
      /^127(?:\.\d{1,3}){3}$/u.test(host) ||
      host === "[::1]"
    );
  } catch {
    return false;
  }
}

function isNamedBrowser(device: ProductDevice, sites: BrowserSites): boolean {
  const site = sites.get(device.id);
  if (!site) return false;
  try {
    const url = new URL(site.startUrl);
    const name = site.name.trim().toLocaleLowerCase();
    return name !== url.hostname.toLocaleLowerCase() && name !== url.host.toLocaleLowerCase();
  } catch {
    return false;
  }
}

export function deviceMatchesCatalogSearch(
  device: ProductDevice,
  query: string,
  sites: BrowserSites,
): boolean {
  const site = sites.get(device.id);
  return (
    !query ||
    [
      device.name,
      device.id,
      device.serial,
      device.platform,
      device.osVersion,
      device.kind,
      device.browserUrl,
      site?.name,
      site?.startUrl,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
}

function browserAddress(value: string | undefined): { url: string; label: string } | undefined {
  try {
    if (!value) return undefined;
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
    return {
      url: url.href,
      label: `${url.host}${url.pathname === "/" ? "" : url.pathname}`,
    };
  } catch {
    return undefined;
  }
}
