import { spawn } from "node:child_process";
import { pinnedE2EProject } from "./project.js";

/** Explicit trust is required before loading the project's executable configuration. */
export async function runE2EProject(options: {
  projectRoot: string;
  trust: "trusted-project";
  args?: readonly string[];
  signal?: AbortSignal;
  onStarted?: (pid: number) => void;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
}) {
  if (options.trust !== "trusted-project")
    throw new Error("Project trust is required to execute e2e code");
  options.signal?.throwIfAborted();
  const { root: projectRoot, executable } = await pinnedE2EProject(options.projectRoot);
  return new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolveRun, reject) => {
      const child = spawn(process.execPath, [executable, "run", ...(options.args ?? [])], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, E2E_TELEMETRY_DISABLED: "1" },
      });
      if (child.pid) options.onStarted?.(child.pid);
      const cancel = () => child.kill("SIGINT");
      options.signal?.addEventListener("abort", cancel, { once: true });
      child.stdout.on("data", (chunk) => options.onOutput?.("stdout", String(chunk)));
      child.stderr.on("data", (chunk) => options.onOutput?.("stderr", String(chunk)));
      child.once("error", (error) => {
        options.signal?.removeEventListener("abort", cancel);
        reject(error);
      });
      child.once("close", (exitCode, signal) => {
        options.signal?.removeEventListener("abort", cancel);
        resolveRun({ exitCode, signal });
      });
      if (options.signal?.aborted) cancel();
    },
  );
}
