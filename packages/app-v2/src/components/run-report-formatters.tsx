/** @jsxImportSource react */
import type { ReactNode } from "react";
import type { RunProductService } from "../data/run-product-service";

export function readableJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2) ?? "null";
  } catch {
    return "Raw evidence could not be formatted as JSON.";
  }
}

const JSON_TOKEN =
  /(?<string>"(?:\\.|[^"\\])*")(?<keySuffix>\s*:)?|(?<number>-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(?<boolean>true|false)|(?<nil>null)/gu;

export function highlightJson(json: string): ReactNode[] {
  const output: ReactNode[] = [];
  let cursor = 0;

  for (const match of json.matchAll(JSON_TOKEN)) {
    const index = match.index;
    if (index > cursor) output.push(json.slice(cursor, index));

    const groups = match.groups ?? {};
    const token = groups.string ?? groups.number ?? groups.boolean ?? groups.nil ?? match[0];
    const kind = groups.string
      ? groups.keySuffix
        ? "key"
        : "string"
      : groups.number
        ? "number"
        : groups.boolean
          ? "boolean"
          : "null";

    output.push(
      <span key={`${index}-${kind}`} className={`relay-json-token relay-json-token--${kind}`}>
        {token}
      </span>,
    );
    if (groups.keySuffix) output.push(groups.keySuffix);
    cursor = index + match[0].length;
  }

  if (cursor < json.length) output.push(json.slice(cursor));
  return output;
}

export function outcomeSentence(
  outcome: Awaited<ReturnType<RunProductService["getReport"]>>["outcome"],
  target: string,
): string {
  if (outcome === "passed") return `This Test passed on ${target}.`;
  if (outcome === "product-failure") return `This Test found a product problem on ${target}.`;
  if (outcome === "harness-failure") return `Relay could not complete this Test on ${target}.`;
  if (outcome === "uncertain") return `Relay could not confirm the outcome on ${target}.`;
  if (outcome === "cancelled") return `This Run was cancelled on ${target}.`;
  return `Relay has not published a terminal outcome for this Run on ${target}.`;
}

export function firstSentence(value: string): string {
  const line = value.split(/\r?\n/, 1)[0]?.trim() ?? "";
  return line.slice(0, 280).replace(/[.:!?]+$/u, "") + ".";
}

export function resultHeading(
  outcome: Awaited<ReturnType<RunProductService["getReport"]>>["outcome"],
): string {
  if (outcome === "passed") return "Checks passed";
  if (outcome === "product-failure") return "Check failed";
  if (outcome === "harness-failure") return "Could not complete";
  if (outcome === "uncertain") return "Outcome not confirmed";
  if (outcome === "cancelled") return "Cancelled";
  return "Incomplete evidence";
}

export function failureTitle(value: string, category?: string): string {
  if (category) return category;
  const line = value.split(/\r?\n/, 1)[0]?.trim();
  return line || "Relay could not complete this Test";
}

export function formatDuration(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1_000).toFixed(durationMs < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1_000);
  return `${minutes} min ${seconds} s`;
}

export function nextAction(
  outcome: Awaited<ReturnType<RunProductService["getReport"]>>["outcome"],
): string {
  if (outcome === "product-failure") {
    return "Review this moment first, then decide whether the app or the saved Test needs to change.";
  }
  if (outcome === "harness-failure") {
    return "Reconnect the device or browser, then run this Test again.";
  }
  if (outcome === "uncertain") {
    return "Review the evidence before deciding whether to run this Test again.";
  }
  if (outcome === "cancelled") return "Run this Test again when the device or browser is ready.";
  return "Review the Report before taking the next action.";
}
