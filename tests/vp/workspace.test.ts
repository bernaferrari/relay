import { readFile } from "node:fs/promises";
import { describe, it } from "vitest";
import { expect } from "vitest";

async function packageJson(path = "package.json"): Promise<{
  scripts?: Record<string, string>;
}> {
  return JSON.parse(await readFile(path, "utf8")) as {
    scripts?: Record<string, string>;
  };
}

describe("Relay workspace verification", () => {
  it("provides one root verification command", async () => {
    const root = await packageJson();
    expect(root.scripts?.verify).toContain("vp check");
    expect(root.scripts?.verify).toContain("pnpm typecheck");
    expect(root.scripts?.verify).toContain("pnpm run test:packages");
    expect(root.scripts?.verify).toContain("vp test");
    expect(root.scripts?.test).toBe("pnpm run test:packages && vp test");
  });

  it("discovers package tests recursively instead of listing files", async () => {
    const app = await packageJson("packages/app/package.json");
    expect(app.scripts?.test).toBe("tsx --test src/**/*.test.ts");
    expect(app.scripts?.test).not.toContain("step-sentence.test.ts");
  });

  it("keeps package tests separate from Vite+ workspace tests", async () => {
    const root = await packageJson();
    expect(root.scripts?.["test:packages"]).toBe("pnpm -r --if-present run test");
    expect(root.scripts?.["test:packages"]).not.toContain("vp test");
  });

  it("keeps physical iOS runner recordings bounded", async () => {
    const workspace = await readFile("pnpm-workspace.yaml", "utf8");
    const patch = await readFile("patches/agent-device@0.18.3.patch", "utf8");

    expect(workspace).toContain("agent-device@0.18.3: patches/agent-device@0.18.3.patch");
    expect(patch).toContain(
      'private static let managedRecordingPrefix = "agent-device-recording-"',
    );
    expect(patch).toContain("cleanupStaleRunnerRecordings()");
    expect(patch).toContain("cleanupStaleRunnerRecordings(keeping: safeFileName)");
    expect(patch).toContain("try fileManager.removeItem(at: entry)");
  });
});
