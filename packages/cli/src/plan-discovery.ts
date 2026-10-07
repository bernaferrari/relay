import { summarizeAppMapOperationResult, type AppMapSummaryPresentation } from "@relay/protocol";
import { CliError, ExitCode } from "./errors.js";

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Plan IDs select the response locally; the canonical read only needs its App. */
export function savedPlanOperationInput(
  operationId: string,
  input: unknown,
  commandPath?: string,
): unknown {
  return operationId === "app-map.get" &&
    (commandPath === "plan list" || commandPath === "plan get")
    ? { appMapId: record(input)?.appMapId }
    : input;
}

/** Public Plan reads select the existing saved Combine definition. All other
 * App Map commands keep their canonical summary and operation semantics. */
export function summarizeSavedPlanCommandResult(
  operationId: string,
  result: unknown,
  presentation?: AppMapSummaryPresentation,
): unknown {
  if (operationId === "app-map.get" && presentation?.commandPath === "plan get") {
    const input = record(presentation.input);
    const map = record(record(result)?.appMap);
    const combines = record(map?.combines);
    if (!map || map.id !== input?.appMapId || !Number.isInteger(map.revision) || !combines)
      throw new CliError("Malformed saved Plan response", ExitCode.validation);
    const id = input?.combineId;
    const combine =
      typeof id === "string" && Object.hasOwn(combines, id) ? record(combines[id]) : undefined;
    if (!combine || combine.id !== id)
      throw new CliError(`Unknown Plan: ${typeof id === "string" ? id : ""}`, ExitCode.validation);
    return { appMapId: map.id, revision: map.revision, combine };
  }
  return summarizeAppMapOperationResult(
    operationId,
    result,
    presentation?.commandPath === "plan list"
      ? { ...presentation, list: "combines" }
      : presentation,
  );
}
