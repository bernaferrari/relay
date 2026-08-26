import {
  ResourceNotFoundError,
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/server";
import type { OperationInvoker } from "./server.js";
import { readResult, relayMcpResourceMimeType, type RelayResourceScope } from "./resources.js";

type DiffImpactResourceDependencies = {
  invoker: OperationInvoker;
  scope: RelayResourceScope;
};

const safeQueryValue = /^[A-Za-z0-9][A-Za-z0-9._,:*/[\]{}"-]*$/;

/** `relay://app-maps/{id}/impact?files=a,b,c` — the Tests a diff could affect,
 * so an agent can rerun exactly the affected critical flows instead of the
 * whole suite. Repeated or comma-separated `files=` parameters carry changed
 * repository paths; an optional JSON-encoded `sourcePaths=` parameter carries
 * the v1 `{entityId -> sourcePaths}` front-matter mapping. */
export function registerDiffImpactResource(
  server: McpServer,
  { invoker, scope }: DiffImpactResourceDependencies,
): void {
  server.registerResource(
    "app-map-diff-impact",
    new ResourceTemplate("relay://app-maps/{appMapId}/impact", { list: undefined }),
    {
      title: "Relay App Map Diff Impact",
      description:
        "Affected Test ids for a set of changed repository files, computed by longest-prefix directory matching over App Map entity source paths and transitive Routine closure.",
      mimeType: relayMcpResourceMimeType,
    },
    async (uri, variables, context) => {
      const appMapId = variables.appMapId;
      if (typeof appMapId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/.test(appMapId)) {
        throw new ResourceNotFoundError(
          uri.href,
          `Unsafe Relay resource identifier in ${uri.href}`,
        );
      }
      if (uri.hash)
        throw new ResourceNotFoundError(uri.href, `Unsafe Relay resource URI ${uri.href}`);
      const search = uri.searchParams;
      const changedFiles = [
        ...new Set(
          search
            .getAll("files")
            .flatMap((value) => value.split(","))
            .map((value) => value.trim())
            .filter(Boolean),
        ),
      ];
      if (changedFiles.length === 0 || !changedFiles.every((file) => safeQueryValue.test(file))) {
        throw new ResourceNotFoundError(uri.href, `Missing or unsafe files query in ${uri.href}`);
      }
      let sourcePaths: Record<string, string[]> | undefined;
      if (search.has("sourcePaths")) {
        try {
          sourcePaths = JSON.parse(search.get("sourcePaths")!) as Record<string, string[]>;
        } catch {
          throw new ResourceNotFoundError(
            uri.href,
            `sourcePaths must be valid JSON in ${uri.href}`,
          );
        }
      }
      try {
        const result = await invoker.invoke(
          "app-map.diff.impact",
          {
            appMapId,
            changedFiles,
            ...(sourcePaths ? { sourcePaths } : {}),
          },
          { signal: context.mcpReq.signal },
        );
        return readResult(uri, scope.projectId, "diff-impact", result);
      } catch {
        throw new ResourceNotFoundError(uri.href);
      }
    },
  );
}
