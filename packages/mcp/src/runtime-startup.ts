import type { McpConfig } from "./config.js";

type StartRuntime = (options: {
  workspaceRoot: string;
  port?: number;
  token: string;
}) => Promise<{ url: string }>;

async function installedRuntime(): Promise<StartRuntime> {
  // Keep the service optional: guides, doctor and explicit endpoints work without its package.
  const specifier = "@relay/runtime/startup";
  try {
    const runtime = await import(specifier);
    return runtime.ensureRelayRuntime;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "Workspace startup requires the matching @relay/runtime candidate installed beside @relay/mcp. Install both local artifacts, or configure --server for an existing service.",
      );
    }
    throw error;
  }
}

/** Only an explicitly chosen local workspace grants authority to start a service. */
export async function prepareMcpRuntime(
  config: McpConfig,
  load: () => Promise<StartRuntime> = installedRuntime,
): Promise<McpConfig> {
  if (!config.runtime) return config;
  if (config.connection.organizationId !== "local" || config.connection.projectId !== "default") {
    throw new Error(
      "Packaged workspace startup uses local/default scope. Configure --server to attach to your authorized scoped service.",
    );
  }
  const start = await load();
  const runtime = await start({
    workspaceRoot: config.runtime.workspaceRoot,
    ...(config.runtime.port === undefined ? {} : { port: config.runtime.port }),
    token: config.connection.auth.type === "bearer" ? config.connection.auth.token : "",
  });
  return { ...config, connection: { ...config.connection, url: runtime.url } };
}
