import { createSchemaOperationBuilders } from "./operation/operation-builders.js";

const { command, query } = createSchemaOperationBuilders<"fixture.import" | "fixture.list">();
export const managedFixtureOperationDefinitions = [
  command("fixture.import", "Import a test file", "POST", "/fixtures", {
    category: "authoring",
    idempotency: "inherent",
  }),
  query("fixture.list", "List test files", "/fixtures", { category: "authoring" }),
] as const;
