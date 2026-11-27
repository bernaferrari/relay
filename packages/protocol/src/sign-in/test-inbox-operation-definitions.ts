import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

type TestInboxOperationId =
  | "inbox.save"
  | "inbox.rotate"
  | "inbox.list"
  | "inbox.revoke"
  | "inbox.check";

const { command, query } = createSchemaOperationBuilders<TestInboxOperationId>();

export const testInboxOperationDefinitions = [
  command("inbox.save", "Save a test inbox", "POST", "/inboxes", {
    category: "workspace",
    confirmation: "confirm",
    idempotency: "required",
    minimumRole: "author",
  }),
  command("inbox.rotate", "Rotate a test inbox", "POST", "/inboxes/rotate", {
    category: "workspace",
    confirmation: "confirm",
    idempotency: "required",
    minimumRole: "author",
  }),
  query("inbox.list", "List test inboxes", "/inboxes", {
    category: "workspace",
    minimumRole: "viewer",
  }),
  command("inbox.revoke", "Revoke a test inbox", "POST", "/inboxes/revoke", {
    category: "workspace",
    confirmation: "confirm",
    idempotency: "inherent",
    minimumRole: "author",
  }),
  command("inbox.check", "Check test inbox connectivity", "POST", "/inboxes/check", {
    category: "workspace",
    idempotency: "inherent",
    minimumRole: "viewer",
  }),
] as const;
