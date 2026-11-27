import * as z from "zod/v4";
import type {
  OperationDefinition,
  OperationInputContract,
  ProjectRole,
  RuntimeParser,
} from "./operation-contract.js";
import {
  operationInputSchemas,
  type OperationSchemaId,
  type OperationSchemaInput,
} from "./operation-input-schemas.js";
import {
  operationOutputSchemas,
  type OperationOutputSchemaId,
  type OperationSchemaOutput,
} from "./operation-output-schemas.js";

type OperationShapeMap = Record<string, { input: unknown; output: unknown }>;

type DefinitionOptions<Map extends OperationShapeMap, Id extends Extract<keyof Map, string>> = Omit<
  OperationDefinition<Id, Map[Id]["input"], Map[Id]["output"]>,
  "version" | "input" | "output" | "minimumRole"
> & {
  minimumRole?: ProjectRole;
};

function defaultMinimumRole(
  options: Pick<
    OperationDefinition<string, unknown, unknown>,
    "mode" | "confirmation" | "category" | "lease" | "progress"
  >,
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

export type SchemaOperationId = OperationSchemaId;

export type SchemaOperationMap<Id extends SchemaOperationId> = {
  [SelectedId in Id]: {
    input: OperationSchemaInput<SelectedId>;
    output: OperationSchemaOutput<SelectedId>;
  };
};

function buildOperation<Id extends string, Input, Output>(
  options: Omit<OperationDefinition<Id, Input, Output>, "version" | "minimumRole"> & {
    minimumRole?: ProjectRole;
  },
): OperationDefinition<Id, Input, Output> {
  return {
    ...options,
    version: 1,
    minimumRole: options.minimumRole ?? defaultMinimumRole(options),
  };
}

function createBuilders<Map extends OperationShapeMap>(contracts: {
  input<Id extends Extract<keyof Map, string>>(id: Id): OperationInputContract<Map[Id]["input"]>;
  output<Id extends Extract<keyof Map, string>>(id: Id): RuntimeParser<Map[Id]["output"]>;
}) {
  type Id = Extract<keyof Map, string>;

  function operation<SelectedId extends Id>(
    options: DefinitionOptions<Map, SelectedId>,
  ): OperationDefinition<SelectedId, Map[SelectedId]["input"], Map[SelectedId]["output"]> {
    return buildOperation({
      ...options,
      input: contracts.input(options.id),
      output: contracts.output(options.id),
    });
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

// Exact entry: every registered operation derives its input and output
// contracts from the canonical schemas.
export function createSchemaOperationBuilders<Id extends SchemaOperationId = SchemaOperationId>() {
  return createBuilders<SchemaOperationMap<Id>>({
    input: <SelectedId extends Id>(id: SelectedId) => operationInputContractFromSchema(id),
    output: <SelectedId extends Id>(id: SelectedId) => operationOutputContractFromSchema(id),
  });
}

function schemaInputContract<
  Id extends OperationSchemaId,
  Schema extends z.ZodType & (typeof operationInputSchemas)[Id],
>(id: Id, presentation: Schema): OperationInputContract<z.output<Schema>> {
  return Object.freeze({
    description: `${id} input`,
    parse: (value: unknown) => z.parse(presentation, value),
    presentation,
  });
}

export function operationInputContractFromSchema<Id extends OperationSchemaId>(
  id: Id,
): OperationInputContract<OperationSchemaInput<Id>> {
  return schemaInputContract(id, operationInputSchemas[id]);
}

function schemaOutputContract<
  Id extends OperationOutputSchemaId,
  Schema extends z.ZodType & (typeof operationOutputSchemas)[Id],
>(id: Id, schema: Schema): RuntimeParser<z.output<Schema>> {
  return Object.freeze({
    description: `${id} output`,
    parse: (value: unknown) => z.parse(schema, value),
  });
}

export function operationOutputContractFromSchema<Id extends OperationOutputSchemaId>(
  id: Id,
): RuntimeParser<OperationSchemaOutput<Id>> {
  return schemaOutputContract(id, operationOutputSchemas[id]);
}
