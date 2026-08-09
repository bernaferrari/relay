import { randomUUID } from "node:crypto";
import type {
  CaseExpansionStrategy,
  CaseStack,
  FrozenRunCase,
  RunCaseProvenance,
  TestData,
} from "@relay/protocol";
import { CaseExpansionError, expandCaseIndexes } from "@relay/protocol";
import { generateValues } from "./generation.js";

export type RunMatrixStrategy = "repeat" | CaseExpansionStrategy;

export type PrepareRunMatrixInput = {
  variables: TestData[];
  dataIds?: string[];
  strategy?: RunMatrixStrategy;
  repetitions?: number;
  seed?: number;
  maxCases?: number;
  runtimeValues?: Record<string, string | string[]>;
};

export type PreparedRunMatrix = {
  id: string;
  createdAt: number;
  seed: number;
  strategy: RunMatrixStrategy;
  cases: FrozenRunCase[];
};

export class RunMatrixError extends Error {
  constructor(
    readonly code:
      | "missing-private-value"
      | "missing-variable"
      | "generation-failed"
      | "zip-length-mismatch"
      | "too-many-cases"
      | "conflicting-variable",
    message: string,
  ) {
    super(message);
    this.name = "RunMatrixError";
  }
}

type ResolvedVariable = {
  definition: TestData;
  name: string;
  values: string[];
  provenance: RunCaseProvenance;
};

function bounded(value: number | undefined, fallback: number, maximum: number): number {
  return Math.max(1, Math.min(Math.floor(value ?? fallback), maximum));
}

function compactValues(value: string | string[] | undefined): string[] {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .map((item) => item.trim())
    .filter(Boolean);
}

async function resolveVariable(
  variable: TestData,
  input: PrepareRunMatrixInput,
  generationCount: number,
  seed: number,
): Promise<ResolvedVariable> {
  const name = variable.name.trim();
  const runtime = compactValues(input.runtimeValues?.[name] ?? input.runtimeValues?.[variable.id]);
  if (variable.scope === "private" && runtime.length === 0) {
    throw new RunMatrixError(
      "missing-private-value",
      `Private variable “${name}” needs a local value before this run can start`,
    );
  }
  if (runtime.length > 0) {
    return {
      definition: variable,
      name,
      values: runtime,
      provenance: { variableId: variable.id, variableName: name, source: variable.source },
    };
  }

  const approved = compactValues(variable.values);
  if (variable.source === "generated" && variable.prompt?.trim()) {
    const fallback = compactValues(variable.fallback);
    try {
      const generated = await generateValues({
        purpose: "variable",
        prompt: variable.prompt,
        count: generationCount,
        seed,
      });
      const values = compactValues(generated.values);
      if (values.length === 0 && fallback.length === 0) {
        throw new RunMatrixError(
          "generation-failed",
          `Generated variable “${name}” returned no values and has no fallback`,
        );
      }
      return {
        definition: variable,
        name,
        values: values.length ? values : fallback,
        provenance: {
          variableId: variable.id,
          variableName: name,
          source: variable.source,
          provider: generated.provider,
          model: generated.model,
          generatedAt: generated.generatedAt,
          seed,
        },
      };
    } catch (error) {
      if (error instanceof RunMatrixError) throw error;
      if (fallback.length) {
        return {
          definition: variable,
          name,
          values: fallback,
          provenance: {
            variableId: variable.id,
            variableName: name,
            source: variable.source,
            seed,
          },
        };
      }
      throw new RunMatrixError(
        "generation-failed",
        `Could not generate values for “${name}”; add a fallback or check the generation provider`,
      );
    }
  }

  const values = variable.source === "list" ? approved : approved.slice(0, 1);
  const fallback = compactValues(variable.fallback);
  return {
    definition: variable,
    name,
    values: values.length ? values : fallback,
    provenance: { variableId: variable.id, variableName: name, source: variable.source },
  };
}

function indexesFor(
  strategy: RunMatrixStrategy,
  variables: ResolvedVariable[],
  repetitions: number,
  limit: number,
): number[][] {
  const lengths = variables.map((variable) => Math.max(1, variable.values.length));
  if (strategy === "repeat") {
    return Array.from({ length: repetitions }, (_, index) =>
      lengths.map((length) => index % length),
    );
  }
  try {
    return expandCaseIndexes(lengths, strategy, limit);
  } catch (error) {
    if (error instanceof CaseExpansionError) {
      throw new RunMatrixError(error.code, error.message);
    }
    throw error;
  }
}

function caseName(variables: ResolvedVariable[], indexes: number[], index: number): string {
  if (variables.some((variable) => variable.definition.scope === "private")) {
    return `Private case ${index + 1}`;
  }
  const labels = variables.map((variable, variableIndex) => {
    const value = variable.values[indexes[variableIndex]!] ?? variable.definition.fallback ?? "";
    return variables.length === 1 ? value : `${variable.name} = ${value}`;
  });
  const label = labels.filter(Boolean).join(" · ");
  return label.length > 80 ? `Case ${index + 1}` : label || `Case ${index + 1}`;
}

/** Resolve dynamic values and coverage combinations before any run is queued. */
export async function prepareRunMatrix(input: PrepareRunMatrixInput): Promise<PreparedRunMatrix> {
  const repetitions = bounded(input.repetitions, 1, 100);
  const maxCases = bounded(input.maxCases, 20, 250);
  const seed = Number.isFinite(input.seed) ? Math.floor(input.seed!) : Date.now();
  const strategy = input.strategy ?? "repeat";
  const selectedIds = input.dataIds ? new Set(input.dataIds) : null;
  const selected = input.variables.filter(
    (variable) => !selectedIds || selectedIds.has(variable.id),
  );
  if (selectedIds) {
    const missing = [...selectedIds].filter(
      (id) => !selected.some((variable) => variable.id === id),
    );
    if (missing.length) {
      throw new RunMatrixError(
        "missing-variable",
        `Case stack references missing variable${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`,
      );
    }
  }
  const generationCount = Math.max(repetitions, 1);
  const variables = await Promise.all(
    selected.map((variable) => resolveVariable(variable, input, generationCount, seed)),
  );
  const unresolved = variables.find((variable) => variable.values.length === 0);
  if (unresolved) {
    throw new RunMatrixError(
      "missing-variable",
      `Variable “${unresolved.name}” has no value for this run`,
    );
  }
  const rows = indexesFor(strategy, variables, repetitions, maxCases);
  const matrixId = randomUUID();
  const cases: FrozenRunCase[] = rows.map((indexes, index) => ({
    id: `${matrixId}:${index + 1}`,
    name: caseName(variables, indexes, index),
    index,
    values: Object.fromEntries(
      variables.map((variable, variableIndex) => [
        variable.name,
        variable.values[indexes[variableIndex]!] ?? variable.definition.fallback ?? "",
      ]),
    ),
    provenance: variables.map((variable) => structuredClone(variable.provenance)),
  }));
  return { id: matrixId, createdAt: Date.now(), seed, strategy, cases };
}

export async function prepareCaseStackMatrix(input: {
  variables: TestData[];
  caseStacks: CaseStack[];
  runtimeValues?: Record<string, string | string[]>;
  seed?: number;
}): Promise<PreparedRunMatrix> {
  if (input.caseStacks.length === 0) {
    return prepareRunMatrix({ variables: [], seed: input.seed });
  }
  const matrices: PreparedRunMatrix[] = [];
  for (const stack of input.caseStacks) {
    matrices.push(
      await prepareRunMatrix({
        variables: input.variables,
        dataIds: stack.dataIds,
        strategy: stack.strategy,
        maxCases: stack.maxCases,
        runtimeValues: input.runtimeValues,
        seed: input.seed,
      }),
    );
  }
  const maxCases = Math.min(250, ...input.caseStacks.map((stack) => stack.maxCases));
  let combined: Array<Pick<FrozenRunCase, "name" | "values" | "provenance">> = [
    { name: "", values: {}, provenance: [] },
  ];
  for (let matrixIndex = 0; matrixIndex < matrices.length; matrixIndex += 1) {
    const next: typeof combined = [];
    for (const left of combined) {
      for (const right of matrices[matrixIndex]!.cases) {
        for (const [name, value] of Object.entries(right.values)) {
          if (left.values[name] !== undefined && left.values[name] !== value) {
            throw new RunMatrixError(
              "conflicting-variable",
              `Case stacks assign different values to “${name}”; keep that variable in one stack`,
            );
          }
        }
        next.push({
          name: [left.name, `${input.caseStacks[matrixIndex]!.name}: ${right.name}`]
            .filter(Boolean)
            .join(" · "),
          values: { ...left.values, ...right.values },
          provenance: [...left.provenance, ...right.provenance],
        });
        if (next.length > maxCases) {
          throw new RunMatrixError(
            "too-many-cases",
            `Combined case stacks expand beyond ${maxCases} runs; reduce coverage or split the flow`,
          );
        }
      }
    }
    combined = next;
  }
  const id = randomUUID();
  return {
    id,
    createdAt: Date.now(),
    seed: matrices[0]!.seed,
    strategy: matrices.length === 1 ? matrices[0]!.strategy : "cartesian",
    cases: combined.map((item, index) => ({
      id: `${id}:${index + 1}`,
      name: item.name || `Case ${index + 1}`,
      index,
      values: item.values,
      provenance: item.provenance,
    })),
  };
}

/** Safe for reports, Activity, and transport. Raw values remain execution-only. */
export function redactRunMatrix(
  matrix: PreparedRunMatrix,
  variables: TestData[],
): PreparedRunMatrix {
  const privateNames = new Set(
    variables
      .filter((variable) => variable.scope === "private" || variable.sensitive)
      .flatMap((variable) => [variable.id, variable.name]),
  );
  return {
    ...structuredClone(matrix),
    cases: matrix.cases.map((item) => ({
      ...structuredClone(item),
      name: item.provenance.some((entry) => privateNames.has(entry.variableId))
        ? `Private case ${item.index + 1}`
        : item.name,
      values: Object.fromEntries(
        Object.entries(item.values).map(([name, value]) => [
          name,
          privateNames.has(name) ? "[private]" : value,
        ]),
      ),
    })),
  };
}
