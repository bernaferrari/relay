import { runsRoot } from "@relay/core";
import type { StartServerOptions, StartedServer } from "./server-types.js";
import { proofPublicationRuntimeFromEnvironment } from "./proof-publication-runtime.js";

type ServerStarter = (options: StartServerOptions) => Promise<StartedServer>;

/** Parse the standalone server flags without coupling the HTTP router to CLI UX. */
export async function runServerCli(startServer: ServerStarter): Promise<void> {
  const argv = process.argv.slice(2);
  const portIdx = argv.indexOf("--port");
  const hostIdx = argv.indexOf("--host");
  const tokenIdx = argv.indexOf("--token");
  const port = portIdx >= 0 ? Number(argv[portIdx + 1]) : 8787;
  const host = hostIdx >= 0 ? (argv[hostIdx + 1] ?? "127.0.0.1") : "127.0.0.1";
  const token = tokenIdx >= 0 ? argv[tokenIdx + 1] : process.env.RELAY_AUTH_TOKEN;
  const proofRouteRuntime = proofPublicationRuntimeFromEnvironment();
  const started = await startServer({
    port,
    host,
    token,
    ...(proofRouteRuntime ? { proofRouteRuntime } : {}),
  });
  console.log(`@relay/server listening on http://${started.host}:${started.port}`);
  console.log(`  runs → ${runsRoot()}`);
}
