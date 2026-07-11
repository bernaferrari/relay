import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, it } from "vitest";

const exec = promisify(execFile);

async function runPackageTests(name: string): Promise<void> {
  await exec("pnpm", ["--filter", name, "test"], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
}

describe.sequential("Relay workspace", () => {
  it("passes client transport tests", () => runPackageTests("@relay/client"));
  it("passes core domain tests", () => runPackageTests("@relay/core"));
  it("passes server API and security tests", () => runPackageTests("@relay/server"));
  it("passes app behavior tests", () => runPackageTests("@relay/app"));
});
