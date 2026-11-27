import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

type SavedSignInOperationId =
  | "sign-in.save"
  | "sign-in.rotate"
  | "sign-in.list"
  | "sign-in.revoke"
  | "sign-in.resolve-check";

const { command, query } = createSchemaOperationBuilders<SavedSignInOperationId>();

export const savedSignInOperationDefinitions = [
  command("sign-in.save", "Save a sign-in", "POST", "/sign-ins", {
    category: "workspace",
    confirmation: "confirm",
    idempotency: "required",
    minimumRole: "author",
  }),
  command("sign-in.rotate", "Rotate a saved sign-in", "POST", "/sign-ins/rotate", {
    category: "workspace",
    confirmation: "confirm",
    idempotency: "required",
    minimumRole: "author",
  }),
  query("sign-in.list", "List saved sign-ins", "/sign-ins", {
    category: "workspace",
    minimumRole: "viewer",
  }),
  command("sign-in.revoke", "Revoke a saved sign-in", "POST", "/sign-ins/revoke", {
    category: "workspace",
    confirmation: "confirm",
    idempotency: "inherent",
    minimumRole: "author",
  }),
  command(
    "sign-in.resolve-check",
    "Check saved sign-in resolution",
    "POST",
    "/sign-ins/resolve-check",
    {
      category: "workspace",
      idempotency: "inherent",
      minimumRole: "viewer",
    },
  ),
] as const;
