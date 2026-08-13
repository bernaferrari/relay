import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "vite";
import solid from "vite-plugin-solid";
import { dataSourceScopePatch } from "../lib/data-source-mode";

test("a private variable reload restores its prior shared List draft without persisting secrets", async () => {
  const vite = await createServer({
    configFile: false,
    plugins: [solid({ ssr: true, hot: false })],
    server: { middlewareMode: true, ws: { port: 24684 } },
    appType: "custom",
  });
  try {
    const module = await vite.ssrLoadModule("/src/components/workspaces/data-workspace.tsx");
    const row = module.variableToDataRow(
      {
        id: "account",
        name: "Account",
        scope: "private",
        source: "static",
      },
      "local-secret",
      {
        mode: "List",
        preview: "basic",
        values: ["basic", "pro"],
        fallback: "basic",
      },
    );

    assert.equal(row.mode, "Default");
    assert.equal(row.sharedMode, "List");
    assert.equal(dataSourceScopePatch(row, "shared").mode, "List");
    assert.deepEqual(row.values, ["basic", "pro"]);

    const persisted = module.dataRowToVariable(row);
    assert.deepEqual(persisted, {
      id: "account",
      name: "Account",
      scope: "private",
      source: "static",
      prompt: undefined,
      values: undefined,
      fallback: undefined,
    });
    assert.doesNotMatch(JSON.stringify(persisted), /local-secret|basic|pro/);
  } finally {
    await vite.close();
  }
});
