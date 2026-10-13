import { createRequire } from "node:module";
import { readFile, realpath } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { spawn } from "node:child_process";

export async function pinnedE2EProject(projectRoot: string) {
  const root = await realpath(projectRoot);
  const require = createRequire(join(root, "package.json"));
  const packageRoot = dirname(dirname(require.resolve("e2e")));
  const pkg = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  if (pkg.name !== "e2e" || pkg.version !== "0.20.0")
    throw new Error("This integration requires the project's installed e2e@0.20.0");
  return { root, executable: resolve(packageRoot, pkg.bin.e2e) };
}

export type DiscoveredE2ETest = {
  id: string;
  file: string;
  title: string;
  titlePath: string[];
  target: string;
  agent: string;
  disposition: "run" | "skip";
  source?: { file: string; line: number; column: number };
};

/** Upstream collects its own code. Call only after explicit project trust. */
export async function discoverE2EProject(
  projectRoot: string,
  configFile: string,
  signal: AbortSignal,
) {
  const { root, executable } = await pinnedE2EProject(projectRoot);
  signal.throwIfAborted();
  const output = await new Promise<string>((done, reject) => {
    const child = spawn(
      process.execPath,
      [executable, "list", "--config", configFile, "--reporter", "json"],
      {
        cwd: root,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, E2E_TELEMETRY_DISABLED: "1" },
      },
    );
    let stdout = "";
    let stderr = "";
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const abort = () => {
      child.kill("SIGINT");
      escalation ??= setTimeout(() => child.kill("SIGKILL"), 3000);
      escalation.unref();
    };
    signal.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      if (stdout.length > 1024 * 1024) abort();
    });
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-8192);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      clearTimeout(escalation);
      signal.removeEventListener("abort", abort);
      if (signal.aborted) reject(signal.reason);
      else if (stdout.length > 1024 * 1024)
        reject(new Error("Project discovery output exceeds its limit"));
      else if (code !== 0) reject(new Error(stderr || "e2e could not discover Tests"));
      else done(stdout);
    });
  });
  const parsed = JSON.parse(output);
  if (!Array.isArray(parsed.pairs) || parsed.pairs.length > 10_000)
    throw new Error("Invalid upstream Test inventory");
  const ids = new Set<string>();
  for (const pair of parsed.pairs) {
    if (
      !pair ||
      ["id", "file", "title", "target", "agent"].some(
        (key) => typeof pair[key] !== "string" || !pair[key],
      ) ||
      !Array.isArray(pair.titlePath) ||
      !pair.titlePath.length ||
      pair.titlePath.some((part: unknown) => typeof part !== "string") ||
      !["run", "skip"].includes(pair.disposition) ||
      ids.has(pair.id)
    )
      throw new Error("Invalid upstream Test inventory");
    ids.add(pair.id);
  }
  return parsed.pairs as DiscoveredE2ETest[];
}
