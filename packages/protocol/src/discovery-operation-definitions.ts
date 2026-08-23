import { createOperationBuilders } from "./operation-builders.js";
import type { OperationDefinition } from "./operation-contract.js";
import type { RelayOperationMap } from "./operation-map.js";

export type DiscoveryOperationId =
  | "discovery.list"
  | "discovery.create"
  | "discovery.get"
  | "discovery.rename"
  | "discovery.status.update"
  | "discovery.capture"
  | "discovery.interact"
  | "discovery.here"
  | "discovery.do"
  | "discovery.suggestion"
  | "discovery.coverage"
  | "discovery.journey"
  | "discovery.export"
  | "discovery.promote"
  | "discovery.start"
  | "discovery.cancel";

export function createDiscoveryOperationDefinitions() {
  const { command, query } = createOperationBuilders<
    Pick<RelayOperationMap, DiscoveryOperationId>
  >();
  return [
    query("discovery.list", "List Discovery Maps", "/discovery", { category: "discovery" }),
    command("discovery.create", "Create Discovery Map", "POST", "/discovery", {
      category: "discovery",
    }),
    query("discovery.get", "Get Discovery Map", "/discovery/:sessionId", { category: "discovery" }),
    command("discovery.rename", "Rename Discovery Map", "POST", "/discovery/:sessionId/name", {
      category: "discovery",
    }),
    command(
      "discovery.status.update",
      "Update Discovery status",
      "POST",
      "/discovery/:sessionId/status",
      {
        category: "discovery",
      },
    ),
    command(
      "discovery.capture",
      "Capture discovered screen",
      "POST",
      "/discovery/:sessionId/capture",
      {
        category: "discovery",
        targetCapabilities: ["snapshot", "screenshot"],
        lease: "shared",
      },
    ),
    command(
      "discovery.interact",
      "Explore discovered control",
      "POST",
      "/discovery/:sessionId/interact",
      {
        category: "discovery",
        targetCapabilities: ["tap"],
        lease: "exclusive",
      },
    ),
    // Not a query: here captures a live screen, records it, replaces the
    // screen's controls, and lands it on the App Map. Declaring it read-only
    // would tell an MCP client a mutation is safe to call.
    command(
      "discovery.here",
      "Refresh the current Discovery screen and options",
      "POST",
      "/discovery/:sessionId/here",
      {
        category: "discovery",
        targetCapabilities: ["snapshot", "screenshot"],
        lease: "shared",
      },
    ),
    command("discovery.do", "Act on a Discovery option", "POST", "/discovery/:sessionId/do", {
      category: "discovery",
      targetCapabilities: ["tap"],
      lease: "exclusive",
    }),
    query(
      "discovery.suggestion",
      "Suggest next Discovery control",
      "/discovery/:sessionId/suggestion",
      {
        category: "discovery",
      },
    ),
    query("discovery.coverage", "Discovery coverage report", "/discovery/:sessionId/coverage", {
      category: "discovery",
    }),
    query("discovery.journey", "Discovery journey timeline", "/discovery/:sessionId/journey", {
      category: "discovery",
    }),
    query("discovery.export", "Export Discovery Map", "/discovery/:sessionId/export", {
      category: "discovery",
    }),
    command(
      "discovery.promote",
      "Promote Discovery path",
      "POST",
      "/discovery/:sessionId/promote",
      {
        category: "discovery",
      },
    ),
    command("discovery.start", "Start Discovery explore", "POST", "/discovery/:sessionId/start", {
      category: "discovery",
      targetCapabilities: ["tap", "snapshot", "screenshot"],
      lease: "exclusive",
      progress: true,
      cancellable: true,
    }),
    command(
      "discovery.cancel",
      "Cancel Discovery explore",
      "POST",
      "/discovery/:sessionId/cancel",
      {
        category: "discovery",
      },
    ),
  ] as const;
}
