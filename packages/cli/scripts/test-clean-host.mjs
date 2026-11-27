import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
let tarballPath = join(packageRoot, "relay-cli-0.1.0.tgz");

function run(executable, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    execFile(
      executable,
      args,
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024, ...options },
      (error, stdout, stderr) => {
        if (error) {
          reject(Object.assign(error, { stdout, stderr }));
          return;
        }
        resolvePromise({ stdout, stderr });
      },
    );
  });
}

async function listen(server, port = 0) {
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("expected a TCP server");
  return address.port;
}

const temp = await mkdtemp(join(tmpdir(), "relay-cli-clean-host-"));
let relayPid;
let tarballCreated = false;
const web = createServer((_request, response) => response.end("<h1>clean host smoke</h1>"));
try {
  const packed = await run("npm", ["pack", "--json"], { cwd: packageRoot });
  tarballPath = join(packageRoot, JSON.parse(packed.stdout)[0].filename);
  tarballCreated = true;
  const install = join(temp, "install");
  const app = join(temp, "app");
  await mkdir(install, { recursive: true });
  await mkdir(app, { recursive: true });
  await run("npm", ["init", "--yes"], { cwd: install });
  await run("npm", ["install", "--ignore-scripts", "--no-save", tarballPath], { cwd: install });

  const relayBin = join(install, "node_modules", ".bin", "relay");
  const help = await run(relayBin, ["--help"], { cwd: app });
  if (!help.stdout.includes("relay init [--url <url>]")) {
    throw new Error("packed relay --help does not include init");
  }

  const webPort = await listen(web, 5173);
  await writeFile(
    join(app, "package.json"),
    JSON.stringify({ scripts: { dev: "vite" }, devDependencies: { vite: "latest" } }),
  );
  const init = await run(relayBin, ["init", "--json"], { cwd: app });
  const initEnvelope = JSON.parse(init.stdout);
  if (initEnvelope.result?.scaffold?.url !== `http://127.0.0.1:${webPort}/`) {
    throw new Error(`init did not detect the running app: ${init.stdout}`);
  }

  const apps = await run(relayBin, ["apps", "--json"], { cwd: app, timeout: 45_000 });
  const appsEnvelope = JSON.parse(apps.stdout);
  if (!Array.isArray(appsEnvelope.result?.appMaps)) {
    throw new Error(`packed runtime did not answer apps: ${apps.stdout}${apps.stderr}`);
  }
  const runtime = JSON.parse(await readFile(join(app, ".relay/state/runtime.json"), "utf8"));
  relayPid = runtime.pid;
  if (!Number.isSafeInteger(relayPid)) throw new Error("runtime descriptor did not include a pid");
  console.log("clean-host CLI pack smoke passed");
} finally {
  await new Promise((done) => web.close(done));
  if (relayPid) {
    try {
      process.kill(relayPid, "SIGTERM");
    } catch {
      // The smoke server already exited.
    }
  }
  await rm(temp, { recursive: true, force: true });
  if (tarballCreated) await rm(tarballPath, { force: true });
}
