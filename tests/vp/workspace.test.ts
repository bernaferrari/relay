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
    const product = await packageJson("packages/app/package.json");
    expect(product.scripts?.test).toBe("vitest run");
    expect(product.scripts?.build).toBe("vp build");
  });

  it("builds the React product package from the root verification gate", async () => {
    const root = await packageJson();
    const desktop = await packageJson("packages/desktop/package.json");
    const product = JSON.parse(await readFile("packages/app/package.json", "utf8")) as {
      name?: string;
    };
    expect(product.name).toBe("@relay/app");
    expect(root.scripts?.verify).toContain("pnpm --filter @relay/app build");
    expect(root.scripts?.["dev:app:legacy"]).toBeUndefined();
    expect(root.scripts?.["dev:desktop:legacy"]).toBeUndefined();
    expect(desktop.scripts?.["build:legacy"]).toBeUndefined();
    expect(desktop.dependencies?.["@relay/app"]).toBe("workspace:*");
    expect(desktop.devDependencies?.["solid-js"]).toBeUndefined();
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
