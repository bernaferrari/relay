import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

/** Explicit trust is required before loading the project's executable configuration. */
export async function runE2EProject(options: {
  projectRoot: string;
  trust: "trusted-project";
  args?: readonly string[];
  signal?: AbortSignal;
  onOutput?: (stream: "stdout" | "stderr", text: string) => void;
}) {
  if (options.trust !== "trusted-project")
    throw new Error("Project trust is required to execute e2e code");
  options.signal?.throwIfAborted();
  const projectRoot = resolve(options.projectRoot);
  const require = createRequire(join(projectRoot, "package.json"));
  const packageRoot = dirname(dirname(require.resolve("e2e")));
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8")) as {
    name: string;
    version: string;
    bin: Record<string, string>;
  };
  if (pkg.name !== "e2e" || pkg.version !== "0.20.0")
    throw new Error("This adapter requires the project's upstream e2e@0.20.0");
  const executable = resolve(packageRoot, pkg.bin.e2e!);
  return new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>(
    (resolveRun, reject) => {
      const child = spawn(process.execPath, [executable, "run", ...(options.args ?? [])], {
        cwd: projectRoot,
        stdio: ["ignore", "pipe", "pipe"],
      });
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
