import { createOperationBuilders } from "./operation-builders.js";
import type { RelayOperationMap } from "./operation-map.js";

const { command, query } =
  createOperationBuilders<Pick<RelayOperationMap, "fixture.import" | "fixture.list">>();
export const managedFixtureOperationDefinitions = [
  command("fixture.import", "Import a test file", "POST", "/fixtures", {
    category: "authoring",
    idempotency: "inherent",
  }),
  query("fixture.list", "List test files", "/fixtures", { category: "authoring" }),
] as const;
