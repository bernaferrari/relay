import {
  destinationRepairProposalsArtifactDataSchema,
  type DestinationRepairProposalsArtifactData,
} from "@relay/protocol";
import {
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { OperationInvoker } from "./server.js";
import { readResult, relayMcpResourceMimeType, variable, type RelayResourceScope } from "./resources.js";

type UnknownRecord = Record<string, unknown>;

type RepairProposalsResourceDependencies = {
  invoker: OperationInvoker;
  scope: RelayResourceScope;
};

/**
 * Extract the typed `destination-repair-proposals` artifact from a persisted
 * run's artifacts. Returns undefined when the run carries no such artifact or
 * the payload predates the typed contract; the resource then degrades to the
 * opaque artifact list instead of inventing proposals.
 */
export function destinationRepairProposalsFromRun(runValue: unknown):
  | {
      available: boolean;
      proposals: DestinationRepairProposalsArtifactData["proposals"];
      reason?: "grounding-unavailable";
    }
  | undefined {
  // Accept either the raw persisted run or the `run.get` envelope ({ run }).
  const run = record(record(runValue)?.run ?? runValue);
  const artifacts = run?.artifacts;
  if (!Array.isArray(artifacts)) return undefined;
  const artifact = artifacts.find(
    (candidate) => record(candidate)?.kind === "destination-repair-proposals",
  );
  if (!artifact) return undefined;
  const parsed = destinationRepairProposalsArtifactDataSchema.safeParse(artifact.data);
  if (!parsed.success) return undefined;
  return parsed.data;
}

/** `relay://runs/{runId}/repair-proposals` — the typed
 * destination-repair-proposals artifact for one run, instead of an opaque
 * truncation of the whole persisted run. */
export function registerRepairProposalsResource(
  server: McpServer,
  { invoker, scope }: RepairProposalsResourceDependencies,
): void {
  server.registerResource(
    "run-repair-proposals",
    new ResourceTemplate("relay://runs/{runId}/repair-proposals", { list: undefined }),
    {
      title: "Relay Destination Repair Proposals",
      description:
        "Typed review-only screen-matching proposals recorded when a failed step could not prove its destination; zero proposals with an explicit reason when grounding was unavailable.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const runId = variable(variables, "runId", uri);
      try {
        const result = await invoker.invoke(
          "run.get",
          { runId },
          { signal: context.mcpReq.signal },
        );
        const proposals = destinationRepairProposalsFromRun(result);
        if (!proposals) throw new ResourceNotFoundError(uri.href);
        return readResult(uri, scope.projectId, "run-repair-proposals", {
          runId,
          ...proposals,
        });
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );
}

function record(value: unknown): UnknownRecord | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as UnknownRecord)
    : undefined;
}
