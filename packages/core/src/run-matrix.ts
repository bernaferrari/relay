import { randomUUID } from "node:crypto";
import type { FrozenRunCase, TestVariable } from "@relay/protocol";
import { generateValues } from "./generation.js";

export type PrepareRunMatrixInput = {
  variables: TestVariable[];
  repetitions?: number;
  seed?: number;
};

export type PreparedRunMatrix = {
  id: string;
  createdAt: number;
  seed: number;
  cases: FrozenRunCase[];
};

/** Resolve every dynamic value before the first run enters the queue. */
export async function prepareRunMatrix(input: PrepareRunMatrixInput): Promise<PreparedRunMatrix> {
  const repetitions = Math.max(1, Math.min(Math.floor(input.repetitions ?? 1), 20));
  const seed = Number.isFinite(input.seed) ? Math.floor(input.seed!) : Date.now();
  const cases: FrozenRunCase[] = Array.from({ length: repetitions }, (_, index) => ({
    index,
    values: {},
    provenance: [],
  }));

  for (const variable of input.variables) {
    const name = variable.name.trim();
    if (!name) continue;
    if (variable.source === "generated" && variable.prompt?.trim()) {
      try {
        const generated = await generateValues({
          purpose: "variable",
          prompt: variable.prompt,
          count: repetitions,
          seed,
        });
        for (const item of cases) {
          item.values[name] = generated.values[item.index] ?? variable.fallback;
          item.provenance.push({
            variableId: variable.id,
            variableName: name,
            source: variable.source,
            provider: generated.provider,
            model: generated.model,
            generatedAt: generated.generatedAt,
            seed,
          });
        }
        continue;
      } catch {
        // Generation is optional by design; a declared fallback keeps the run usable.
      }
    }

    const approved = variable.values?.filter((value) => value.length > 0) ?? [];
    for (const item of cases) {
      item.values[name] =
        variable.source === "list" && approved.length > 0
          ? approved[item.index % approved.length]!
          : (approved[0] ?? variable.fallback);
      item.provenance.push({
        variableId: variable.id,
        variableName: name,
        source: variable.source,
      });
    }
  }

  return { id: randomUUID(), createdAt: Date.now(), seed, cases };
}
