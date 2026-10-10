import type { RelayOperationMap } from "./operation-map.js";
import { createOperationBuilders } from "./operation-builders.js";

/**
 * The everyday loop and local setup: describe a Test, read a Run's verdict,
 * and check or change what Relay needs on this computer.
 */
export function createEverydayOperationDefinitions() {
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
    command(
      "test.create-from-goal",
      "Describe what should work in plain English; Relay writes and saves the Test",
      "POST",
      "/tests/from-goal",
      { category: "authoring" },
    ),
    query(
      "run.verdict.get",
      "Did the Run pass? Status, reason, and each step's expected vs. saw",
      "/runs/:runId/verdict",
      { category: "evidence" },
    ),
  ] as const;
}
