import { readFile } from "node:fs/promises";
import { describe, it } from "vitest";
import { expect } from "vitest";

async function packageJson(path = "package.json"): Promise<{
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}> {
  return JSON.parse(await readFile(path, "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
}

describe("Relay workspace verification", () => {
  it("provides one root verification command", async () => {
    const root = await packageJson();
    expect(root.scripts?.verify).toContain("vp check");
    expect(root.scripts?.verify).toContain("pnpm typecheck");
    expect(root.scripts?.verify).toContain("pnpm run test:packages");
    expect(root.scripts?.verify).toContain("vp test");
    expect(root.scripts?.test).toBe(
      "pnpm run ios-preview:test && pnpm run test:packages && vp test",
    );
  });

  it("discovers package tests recursively instead of listing files", async () => {
    const productV2 = await packageJson("packages/app-v2/package.json");
    expect(productV2.scripts?.test).toBe("vitest run");
    expect(productV2.scripts?.build).toBe("vp build");
  });

  it("builds the React Product V2 package from the root verification gate", async () => {
    const root = await packageJson();
    const desktop = await packageJson("packages/desktop/package.json");
    expect(root.scripts?.verify).toContain("pnpm --filter @relay/app-v2 build");
    expect(root.scripts?.verify).not.toContain("pnpm --filter @relay/app build");
    expect(root.scripts?.["dev:app:legacy"]).toBeUndefined();
    expect(root.scripts?.["dev:desktop:legacy"]).toBeUndefined();
    expect(desktop.scripts?.["build:legacy"]).toBeUndefined();
    expect(desktop.devDependencies?.["@relay/app"]).toBeUndefined();
    expect(desktop.devDependencies?.["solid-js"]).toBeUndefined();
    await expect(readFile("packages/app/package.json", "utf8")).rejects.toThrow();
  });

  it("keeps package tests separate from Vite+ workspace tests", async () => {
    const root = await packageJson();
    expect(root.scripts?.["test:packages"]).toBe(
      "pnpm --workspace-concurrency=1 -r --if-present run test",
    );
    expect(root.scripts?.["test:packages"]).not.toContain("vp test");
  });

  it("keeps physical iOS runner recordings bounded", async () => {
    const workspace = await readFile("pnpm-workspace.yaml", "utf8");
    const core = await packageJson("packages/core/package.json");
    const lifecycle = await readFile(
      "vendor/agent-device/apple/runner/AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests+Lifecycle.swift",
      "utf8",
    );
    const commandExecution = await readFile(
      "vendor/agent-device/apple/runner/AgentDeviceRunner/AgentDeviceRunnerUITests/RunnerTests+CommandExecution.swift",
      "utf8",
    );

    expect(workspace).not.toContain("patchedDependencies");
    expect(core.dependencies?.["agent-device"]).toBe("link:../../vendor/agent-device");
    expect(commandExecution).toContain("case .clipboardPaste:");
    expect(commandExecution).toContain("case .clipboardCopy:");
    expect(lifecycle).toContain(
      'private static let managedRecordingPrefix = "agent-device-recording-"',
    );
    expect(lifecycle).toContain('private static let managedScreenshotPrefix = "screenshot-"');
    expect(lifecycle).toContain("cleanupStaleRunnerArtifacts(");
    expect(lifecycle).toContain(
      "cleanupStaleRunnerArtifacts(keeping: safeFileName, includeRecordings: true)",
    );
    expect(lifecycle).toContain("try fileManager.removeItem(at: entry)");
  });
});
