import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

type PresenceOperationId = "presence.list" | "presence.upsert" | "presence.clear";

const { command, query } = createOperationBuilders<Pick<RelayOperationMap, PresenceOperationId>>();

export const presenceOperationDefinitions = [
  query("presence.list", "List project presence", "/presence", { category: "system" }),
  command("presence.upsert", "Publish actor presence", "POST", "/presence", {
    category: "system",
    idempotency: "inherent",
  }),
  command("presence.clear", "Clear actor presence", "DELETE", "/presence/:actorId", {
    category: "system",
    idempotency: "inherent",
  }),
] as const;
