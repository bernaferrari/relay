import type { RelayOperationMap } from "./operation-map.js";
import { createOperationBuilders } from "./operation-builders.js";

/** Local setup a person checks or changes from Settings. */
export function createSystemSetupOperationDefinitions() {
  const { command, query } = createOperationBuilders<RelayOperationMap>();
  return [
    query("system.doctor.get", "Inspect Relay prerequisites", "/doctor", { category: "system" }),
    command(
      "system.model-key.set",
      "Save or remove the model key used for plain-English steps and checks",
      "POST",
      "/system/model-key",
      { category: "system" },
    ),
    query("system.audit.list", "List audit events", "/audit", {
      category: "system",
      minimumRole: "admin",
    }),
  ] as const;
}
