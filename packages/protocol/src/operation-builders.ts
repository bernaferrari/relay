import type { OperationDefinition, ProjectRole, RuntimeParser } from "./operation-contract.js";
import { operationInputSchema } from "./operation-input-schemas.js";
import { operationOutputSchema } from "./operation-output-schemas.js";

type OperationShapeMap = Record<string, { input: unknown; output: unknown }>;

type DefinitionOptions<Map extends OperationShapeMap, Id extends Extract<keyof Map, string>> = Omit<
  OperationDefinition<Id, Map[Id]["input"], Map[Id]["output"]>,
  "version" | "input" | "output" | "minimumRole"
> & {
  input?: RuntimeParser<Map[Id]["input"]>;
  output?: RuntimeParser<Map[Id]["output"]>;
  minimumRole?: ProjectRole;
};

function defaultMinimumRole<Map extends OperationShapeMap, Id extends Extract<keyof Map, string>>(
  options: DefinitionOptions<Map, Id>,
): ProjectRole {
  if (options.mode !== "command") return "viewer";
  if (options.confirmation === "dangerous" || options.category === "workspace") return "admin";
  if (options.lease === "exclusive") return "runner";
  if (options.category === "execution" || options.category === "target") return "runner";
  if (options.category === "authoring" || options.category === "evidence") return "author";
  if (options.category === "discovery") {
    return options.progress ? "runner" : "author";
  }
  return "author";
}

export function createOperationBuilders<Map extends OperationShapeMap>() {
  type Id = Extract<keyof Map, string>;

  function operation<SelectedId extends Id>(
    options: DefinitionOptions<Map, SelectedId>,
  ): OperationDefinition<SelectedId, Map[SelectedId]["input"], Map[SelectedId]["output"]> {
    return {
      ...options,
      version: 1,
      minimumRole: options.minimumRole ?? defaultMinimumRole(options),
      input: options.input
        ? operationInputContract(options.id, options.input)
        : operationInputContractFromSchema<Map[SelectedId]["input"]>(options.id),
      output:
        options.output ?? operationOutputContractFromSchema<Map[SelectedId]["output"]>(options.id),
    };
  }

  const query = <SelectedId extends Id>(
    id: SelectedId,
    label: string,
    path: string,
    options: Partial<DefinitionOptions<Map, SelectedId>> = {},
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

  const command = <SelectedId extends Id>(
    id: SelectedId,
    label: string,
    method: "POST" | "PUT" | "DELETE",
    path: string,
    options: Partial<DefinitionOptions<Map, SelectedId>> = {},
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

export function operationInputContract<Parser extends RuntimeParser<unknown>>(
  id: string,
  parser: Parser,
) {
  const presentation = operationInputSchema(id);
  return Object.freeze({
    description: parser.description,
    parse: (value: unknown): ReturnType<Parser["parse"]> => {
      const parsed = parser.parse(value);
      return presentation.parse(parsed) as ReturnType<Parser["parse"]>;
    },
    presentation,
  });
}

function operationInputContractFromSchema<Input>(id: string) {
  const presentation = operationInputSchema(id);
  return Object.freeze({
    description: `${id} input`,
    parse: (value: unknown): Input => presentation.parse(value) as Input,
    presentation,
  });
}

function operationOutputContractFromSchema<Output>(id: string): RuntimeParser<Output> {
  const schema = operationOutputSchema(id);
  return Object.freeze({
    description: `${id} output`,
    parse: (value: unknown): Output => schema.parse(value) as Output,
  });
}
