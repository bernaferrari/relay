import type {
  OperationDefinition,
  OperationRecord,
  ProjectRole,
  RuntimeParser,
} from "./operation-contract.js";

type DefinitionOptions<Id extends string> = Omit<
  OperationDefinition<Id>,
  "version" | "input" | "output" | "minimumRole"
> & {
  input?: RuntimeParser<unknown>;
  output?: RuntimeParser<unknown>;
  minimumRole?: ProjectRole;
};

function defaultMinimumRole<Id extends string>(options: DefinitionOptions<Id>): ProjectRole {
  if (options.mode !== "command") return "viewer";
  if (options.confirmation === "dangerous" || options.category === "workspace") return "admin";
  if (options.lease === "exclusive") return "runner";
  if (options.category === "execution" || options.category === "target") return "runner";
  if (options.category === "authoring" || options.category === "evidence") return "author";
  if (options.category === "discovery" || options.category === "corpus") {
    return options.progress ? "runner" : "author";
  }
  return "author";
}

export function createOperationBuilders<Id extends string>(
  defaultParser: RuntimeParser<OperationRecord>,
) {
  function operation(options: DefinitionOptions<Id>): OperationDefinition<Id> {
    return {
      ...options,
      version: 1,
      minimumRole: options.minimumRole ?? defaultMinimumRole(options),
      input: options.input ?? defaultParser,
      output: options.output ?? defaultParser,
    };
  }

  const query = (
    id: Id,
    label: string,
    path: string,
    options: Partial<DefinitionOptions<Id>> = {},
  ) =>
    operation({
      id,
      label,
      category: "workspace",
      mode: "query",
      idempotency: "inherent",
      targetCapabilities: [],
      lease: "none",
      confirmation: "none",
      progress: false,
      cancellable: false,
      transport: { method: "GET", path },
      ...options,
    });

  const command = (
    id: Id,
    label: string,
    method: "POST" | "PUT" | "DELETE",
    path: string,
    options: Partial<DefinitionOptions<Id>> = {},
  ) =>
    operation({
      id,
      label,
      category: "workspace",
      mode: "command",
      idempotency: method === "DELETE" ? "inherent" : "optional",
      targetCapabilities: [],
      lease: "none",
      confirmation: method === "DELETE" ? "confirm" : "none",
      progress: false,
      cancellable: false,
      transport: { method, path },
      ...options,
    });

  return { command, query };
}
