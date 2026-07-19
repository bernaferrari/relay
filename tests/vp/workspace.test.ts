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
});
