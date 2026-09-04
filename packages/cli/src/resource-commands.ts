import { commandPath as path, type CommandPathDescriptor } from "./command-descriptors.js";
import { UsageError } from "./errors.js";

/**
 * Read-only CLI resources are deliberately separate from operation descriptors:
 * they resolve a friendly command to an HTTP resource path rather than invoking
 * a registered mutation. Keeping them here lets the operation registry remain
 * focused on its one-to-one public operation coverage.
 */
export type CliResourceDescriptor = {
  resourceId: string;
  label: string;
  path: CommandPathDescriptor;
  resourcePath(input: Readonly<Record<string, unknown>>): string;
};

function noResourceInput(input: Readonly<Record<string, unknown>>, command: string): void {
  if (Object.keys(input).length > 0) {
    throw new UsageError(`${command} does not accept --input fields`);
  }
}

function runResource(
  command: string,
  suffix: string,
  summary: string,
  resourceId = command.replace(" ", "."),
): CliResourceDescriptor {
  return {
    resourceId,
    label: summary,
    path: path(command, ["runId"], undefined, {
      summary,
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
    }),
    resourcePath(input) {
      const runId = input.runId;
      if (typeof runId !== "string") throw new UsageError(`${command} requires <runId>`);
      const extra = { ...input };
      delete extra.runId;
      noResourceInput(extra, command);
      return `/runs/${encodeURIComponent(runId)}${suffix}`;
    },
  };
}

export const cliResourceDescriptors: readonly CliResourceDescriptor[] = [
  runResource("run get", "", "Get a persisted run and its evidence"),
  runResource(
    "run replay-offline",
    "/replay-offline",
    "Diagnose a persisted run from frozen evidence without a device",
    "run.replay.offline",
  ),
  runResource("run story", "/story", "Get a shareable run story from existing artifacts"),
  {
    resourceId: "run.evidence",
    label: "Get bounded structured run evidence and packet provenance",
    path: path("run evidence", ["runId"], undefined, {
      summary: "Inspect logs, HTTP entries, packet provenance, coverage, and collector status",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        { name: "limit", type: "number", description: "Maximum entries per evidence channel" },
        {
          name: "includeBodies",
          type: "boolean",
          description: "Include consented request/response bodies",
        },
      ],
      examples: ["relay run evidence <run-id> --input '{\"limit\":200}'"],
    }),
    resourcePath(input) {
      const runId = input.runId;
      if (typeof runId !== "string" || !runId) {
        throw new UsageError("run evidence requires <runId>");
      }
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        if (
          !Number.isInteger(input.limit) ||
          Number(input.limit) < 1 ||
          Number(input.limit) > 2_000
        ) {
          throw new UsageError("run evidence limit must be an integer between 1 and 2000");
        }
        query.set("limit", String(input.limit));
      }
      if (input.includeBodies !== undefined) {
        if (typeof input.includeBodies !== "boolean") {
          throw new UsageError("run evidence includeBodies must be boolean");
        }
        if (input.includeBodies) query.set("includeBodies", "true");
      }
      const unknown = Object.keys(input).filter(
        (key) => !["runId", "limit", "includeBodies"].includes(key),
      );
      if (unknown.length) {
        throw new UsageError(`run evidence does not accept: ${unknown.join(", ")}`);
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      return `/runs/${encodeURIComponent(runId)}/evidence${suffix}`;
    },
  },
  runResource("run signals", "/signals", "Get regression signals for a run"),
  runResource("run compare", "/visual-baseline", "Compare a run with its visual baseline"),
  {
    resourceId: "activity.list",
    label: "List durable project activity",
    path: path("activity list", [], undefined, {
      summary: "List durable human, agent, and system activity",
      inputHelp: [
        { name: "limit", type: "number", description: "Positive page size" },
        { name: "cursor", type: "string", description: "Cursor returned by the previous page" },
      ],
      examples: ["relay activity list --input '{\"limit\":50}'"],
    }),
    resourcePath(input) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        if (!Number.isInteger(input.limit) || Number(input.limit) < 1) {
          throw new UsageError("activity list limit must be a positive integer");
        }
        query.set("limit", String(input.limit));
      }
      if (input.cursor !== undefined) {
        if (typeof input.cursor !== "string" || !input.cursor) {
          throw new UsageError("activity list cursor must be a non-empty string");
        }
        query.set("cursor", input.cursor);
      }
      const unknown = Object.keys(input).filter((key) => key !== "limit" && key !== "cursor");
      if (unknown.length) {
        throw new UsageError(`activity list does not accept: ${unknown.join(", ")}`);
      }
      const encoded = query.toString();
      return `/activity${encoded ? `?${encoded}` : ""}`;
    },
  },
];
