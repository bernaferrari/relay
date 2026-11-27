import { parseTestYaml } from "@relay/core";
import { stringify } from "yaml";
import { UsageError } from "./errors.js";

export type ImportedStep = { kind: "instruction" | "validation"; intent: string };

export type ImportOverrides = {
  name?: string;
  app?: string;
  url?: string;
};

export type ConvertedImportTest = {
  sourceName: string;
  outputFileName: string;
  name: string;
  yaml: string;
  warnings: string[];
  stepCount: number;
};

export type ImportFormat = "maestro" | "playwright";

/** One YAML file in the small hand-authored format accepted by relay apply. */
export function renderRelayTestYaml(input: {
  name: string;
  app?: string;
  url?: string;
  steps: readonly ImportedStep[];
  comments?: readonly string[];
}): string {
  if (!input.steps.length) {
    throw new UsageError("The import produced no steps; nothing honest can be written.");
  }
  const body = stringify(
    {
      name: input.name,
      ...(input.app ? { app: input.app } : {}),
      ...(input.url ? { url: input.url } : {}),
      steps: input.steps.map((step) =>
        step.kind === "validation" ? { check: step.intent } : step.intent,
      ),
    },
    { lineWidth: 0 },
  );
  const comments = (input.comments ?? []).flatMap((comment) =>
    comment
      .replace(/\s+/gu, " ")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => `# ${line}\n`),
  );
  const yaml = `${comments.join("")}${body}`;
  // The writer is small, but the canonical reader is smaller than a second
  // schema. Validate every emission before a path or dry-run ever leaves Relay.
  parseTestYaml(yaml);
  return yaml;
}

export function importComments(
  format: ImportFormat,
  sourceName: string,
  warnings: readonly string[],
): string[] {
  const source = format === "maestro" ? "Maestro flow" : "Playwright spec";
  const first =
    format === "maestro"
      ? `Imported from ${source} ${sourceName}. Review the plain-English steps before running.`
      : `Imported from ${source} ${sourceName}. This is a partial import; review it before running.`;
  return [
    first,
    ...(warnings.length ? ["Warnings:", ...warnings.map((warning) => `- ${warning}`)] : []),
  ];
}

export function uniqueWarnings(warnings: readonly string[]): string[] {
  return [...new Set(warnings)];
}

export function compactCode(value: string, max = 120): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > max ? `${compact.slice(0, max - 1)}…` : compact;
}

/** kebab-case output stem, without the imported test extension. */
export function kebabFileStem(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^.]+$/u, "");
  const withoutTestSuffix = withoutExtension.replace(/\.(?:spec|test)$/iu, "");
  const kebab = withoutTestSuffix
    .replace(/([a-z0-9])([A-Z])/gu, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80)
    .replace(/^-+|-+$/gu, "");
  return kebab || "imported-test";
}

export function humanizeFileStem(fileName: string): string {
  const stem = kebabFileStem(fileName).replaceAll("-", " ").trim();
  if (!stem) return "Imported test";
  return `${stem.charAt(0).toUpperCase()}${stem.slice(1)}`;
}

export function capitalizeThe(value: string): string {
  return value.startsWith("the ") ? `The ${value.slice(4)}` : value;
}
