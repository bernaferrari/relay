import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

type WorkspaceOperationId =
  | "workspace.privacy.get"
  | "workspace.privacy.update"
  | "workspace.evidence.get"
  | "workspace.change.inspect"
  | "workspace.evidence.update";

const { command, query } = createSchemaOperationBuilders<WorkspaceOperationId>();

export const workspaceOperationDefinitions = [
  query("workspace.privacy.get", "Get privacy policy", "/settings/privacy", {
    minimumRole: "admin",
  }),
  command("workspace.privacy.update", "Update privacy policy", "PUT", "/settings/privacy", {}),
  query("workspace.evidence.get", "Get evidence policy", "/settings/evidence", {
    minimumRole: "admin",
  }),
  query("workspace.change.inspect", "Inspect the active workspace change", "/workspace/change", {
    category: "workspace",
    minimumRole: "viewer",
  }),
  command("workspace.evidence.update", "Update evidence policy", "PUT", "/settings/evidence", {
    confirmation: "confirm",
  }),
] as const;
