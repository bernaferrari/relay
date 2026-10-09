import { parseSearchWith } from "@tanstack/react-router";
import { routeContractForPath } from "./route-contract";

/** A source route, including its own selection/filter state. Never an external URL. */
export function returnDestination(value: unknown) {
  if (
    typeof value !== "string" ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\")
  )
    return undefined;
  try {
    const url = new URL(value, "https://relay.internal");
    const route = routeContractForPath(url.pathname);
    if (!route || url.origin !== "https://relay.internal") return undefined;
    return {
      to: url.pathname,
      search: parseSearchWith(JSON.parse)(url.search),
      hash: url.hash.slice(1),
      // The chevron already says "back"; the label names where it goes.
      label: route.title,
    };
  } catch {
    return undefined;
  }
}
