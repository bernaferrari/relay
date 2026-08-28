import {
  repeatSpecSchema,
  variableCanApply,
  type AppMap,
  type RepeatSpec,
  type ResolvedRepeatSpec,
} from "@relay/protocol";

export type RepeatPublicErrorCode =
  | "REPEAT_SPEC_INVALID"
  | "REPEAT_DIMENSION_NOT_FOUND"
  | "REPEAT_DIMENSION_NOT_RUNNABLE"
  | "REPEAT_DIMENSION_HAS_NO_SUPPORTED_VALUES"
  | "REPEAT_VALUE_NOT_FOUND"
  | "REPEAT_PILOT_CASE_INVALID"
  | "REPEAT_RESUME_MODE_UNAVAILABLE";

export class RepeatSpecResolutionError extends Error {
  constructor(
    readonly code: RepeatPublicErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "RepeatSpecResolutionError";
  }
}

/** Resolve names nowhere: a public Repeat is bound only by canonical ids. */
export function resolveRepeatSpec(map: AppMap, input: RepeatSpec): ResolvedRepeatSpec {
  const parsed = repeatSpecSchema.safeParse(input);
  if (!parsed.success) {
    throw new RepeatSpecResolutionError(
      "REPEAT_SPEC_INVALID",
      parsed.error.issues[0]?.message ?? "The Repeat specification is invalid.",
    );
  }
  const dimensions = parsed.data.dimensions.map((dimension) => {
    const variable = map.variables?.[dimension.id];
    if (!variable) {
      throw new RepeatSpecResolutionError(
        "REPEAT_DIMENSION_NOT_FOUND",
        `Repeat dimension ${dimension.id} is not saved on this App.`,
      );
    }
    if (!variableCanApply(variable)) {
      throw new RepeatSpecResolutionError(
        "REPEAT_DIMENSION_NOT_RUNNABLE",
        `Repeat dimension ${dimension.id} has no reviewed apply and undo path.`,
      );
    }
    const supportedIds = variable.options.map((option) => option.id.trim()).filter(Boolean);
    if (!supportedIds.length || new Set(supportedIds).size !== supportedIds.length) {
      throw new RepeatSpecResolutionError(
        "REPEAT_DIMENSION_HAS_NO_SUPPORTED_VALUES",
        `Repeat dimension ${dimension.id} has no unique saved value identifiers.`,
      );
    }
    const valueIds =
      dimension.values === "all" || dimension.values === "supported"
        ? supportedIds
        : [...dimension.values];
    const supported = new Set(supportedIds);
    const missing = valueIds.find((id) => !supported.has(id));
    if (missing) {
      throw new RepeatSpecResolutionError(
        "REPEAT_VALUE_NOT_FOUND",
        `Repeat value ${missing} is not saved on dimension ${dimension.id}.`,
      );
    }
    return { id: dimension.id, valueIds };
  });
  const pilot = parsed.data.pilot ?? { mode: "representative" as const };
  if (parsed.data.resume === "failed" || parsed.data.resume === "all") {
    throw new RepeatSpecResolutionError(
      "REPEAT_RESUME_MODE_UNAVAILABLE",
      `Repeat resume mode ${parsed.data.resume} is not available until terminal-case reruns have a dedicated reviewed campaign operation.`,
    );
  }
  if (pilot.mode === "specified") {
    for (const dimension of dimensions) {
      if (!dimension.valueIds.includes(pilot.case[dimension.id]!)) {
        throw new RepeatSpecResolutionError(
          "REPEAT_PILOT_CASE_INVALID",
          `The specified pilot value for ${dimension.id} is outside the selected Repeat scope.`,
        );
      }
    }
  }
  return {
    dimensions,
    strategy: parsed.data.strategy ?? (dimensions.length === 1 ? "zip" : "cartesian"),
    pilot,
    resume: parsed.data.resume ?? "untouched",
  };
}

export function resolvedRepeatSelection(resolved: ResolvedRepeatSpec): Record<string, string[]> {
  return Object.fromEntries(
    resolved.dimensions.map((dimension) => [dimension.id, [...dimension.valueIds]]),
  );
}
