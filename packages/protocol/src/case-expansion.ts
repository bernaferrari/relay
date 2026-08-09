import type { CaseExpansionStrategy } from "./app-map.js";

export class CaseExpansionError extends Error {
  constructor(
    readonly code: "zip-length-mismatch" | "too-many-cases",
    message: string,
  ) {
    super(message);
    this.name = "CaseExpansionError";
  }
}

function pairKey(
  leftDimension: number,
  leftValue: number,
  rightDimension: number,
  rightValue: number,
) {
  return `${leftDimension}:${leftValue}|${rightDimension}:${rightValue}`;
}

function cartesianIndexes(lengths: number[], limit: number): number[][] {
  let rows: number[][] = [[]];
  for (const length of lengths) {
    const next: number[][] = [];
    for (const row of rows) {
      for (let index = 0; index < length; index += 1) {
        next.push([...row, index]);
        if (next.length > limit) {
          throw new CaseExpansionError(
            "too-many-cases",
            `This matrix expands beyond ${limit} device states; choose pairwise coverage or reduce values`,
          );
        }
      }
    }
    rows = next;
  }
  return rows;
}

/** Deterministic in-dimension-order all-pairs expansion. It grows one
 * dimension at a time and never constructs the Cartesian product. */
function pairwiseIndexes(lengths: number[], limit: number): number[][] {
  if (lengths.length === 0) return [[]];
  if (lengths.length === 1) {
    if (lengths[0]! > limit) {
      throw new CaseExpansionError(
        "too-many-cases",
        `This matrix exceeds its ${limit}-state limit`,
      );
    }
    return Array.from({ length: lengths[0]! }, (_, value) => [value]);
  }
  const rows: number[][] = [];
  for (let left = 0; left < lengths[0]!; left += 1) {
    for (let right = 0; right < lengths[1]!; right += 1) rows.push([left, right]);
  }
  if (rows.length > limit) {
    throw new CaseExpansionError(
      "too-many-cases",
      `Pairwise coverage needs more than ${limit} device states; reduce values`,
    );
  }
  for (let dimension = 2; dimension < lengths.length; dimension += 1) {
    const uncovered = new Set<string>();
    for (let prior = 0; prior < dimension; prior += 1) {
      for (let priorValue = 0; priorValue < lengths[prior]!; priorValue += 1) {
        for (let value = 0; value < lengths[dimension]!; value += 1) {
          uncovered.add(pairKey(prior, priorValue, dimension, value));
        }
      }
    }
    for (const row of rows) {
      let bestValue = 0;
      let bestCoverage = -1;
      for (let value = 0; value < lengths[dimension]!; value += 1) {
        let coverage = 0;
        for (let prior = 0; prior < dimension; prior += 1) {
          if (uncovered.has(pairKey(prior, row[prior]!, dimension, value))) coverage += 1;
        }
        if (coverage > bestCoverage) {
          bestCoverage = coverage;
          bestValue = value;
        }
      }
      row.push(bestValue);
      for (let prior = 0; prior < dimension; prior += 1) {
        uncovered.delete(pairKey(prior, row[prior]!, dimension, bestValue));
      }
    }
    while (uncovered.size > 0) {
      const first = uncovered.values().next().value as string;
      const [leftPair, rightPair] = first.split("|");
      const [priorText, priorValueText] = leftPair!.split(":");
      const [, valueText] = rightPair!.split(":");
      const prior = Number(priorText);
      const value = Number(valueText);
      const row = Array.from({ length: dimension + 1 }, () => 0);
      row[prior] = Number(priorValueText);
      row[dimension] = value;
      for (let other = 0; other < dimension; other += 1) {
        if (other === prior) continue;
        for (let candidate = 0; candidate < lengths[other]!; candidate += 1) {
          if (uncovered.has(pairKey(other, candidate, dimension, value))) {
            row[other] = candidate;
            break;
          }
        }
      }
      rows.push(row);
      for (let other = 0; other < dimension; other += 1) {
        uncovered.delete(pairKey(other, row[other]!, dimension, value));
      }
      if (rows.length > limit) {
        throw new CaseExpansionError(
          "too-many-cases",
          `Pairwise coverage needs more than ${limit} device states; reduce values`,
        );
      }
    }
  }
  return rows;
}

/** One canonical expansion used by execution and every visual preview. */
export function expandCaseIndexes(
  lengths: number[],
  strategy: CaseExpansionStrategy,
  limit = 250,
): number[][] {
  const normalized = lengths.map((length) => Math.max(1, Math.floor(length)));
  if (strategy === "zip") {
    const nonScalar = [...new Set(normalized.filter((length) => length > 1))];
    if (nonScalar.length > 1) {
      throw new CaseExpansionError(
        "zip-length-mismatch",
        `Matched rows needs equally sized sets; found ${nonScalar.join(" and ")} values`,
      );
    }
    const count = nonScalar[0] ?? 1;
    return Array.from({ length: count }, (_, index) =>
      normalized.map((length) => (length === 1 ? 0 : index)),
    );
  }
  if (strategy === "cartesian") return cartesianIndexes(normalized, limit);
  return pairwiseIndexes(normalized, limit);
}
