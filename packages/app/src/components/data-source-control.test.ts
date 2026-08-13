import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "solid-js/web";
import { createServer } from "vite";
import solid from "vite-plugin-solid";
import type { DataSourceMode, DataValueScope } from "../lib/data-source-mode";

type DataSourceControl = (props: {
  scope: DataValueScope;
  mode: DataSourceMode;
  class: string;
  onModeChange: (mode: DataSourceMode) => void;
}) => unknown;

test("renders all shared source choices and hides the selector for private values", async () => {
  const vite = await createServer({
    configFile: false,
    plugins: [solid({ ssr: true, hot: false })],
    server: { middlewareMode: true, ws: { port: 24680 } },
    appType: "custom",
  });
  try {
    const module = await vite.ssrLoadModule("/src/components/data-source-control.tsx");
    const Control = module.DataSourceControl as DataSourceControl;
    const render = (scope: DataValueScope, mode: DataSourceMode) =>
      renderToString(
        () => Control({ scope, mode, class: "field", onModeChange: () => undefined }) as never,
      );

    const shared = render("shared", "Default");
    assert.match(shared, /How to choose it/);
    assert.match(shared, /Fixed value/);
    assert.match(shared, /Choose from a list/);
    assert.match(shared, /Generate with AI/);
    assert.equal(shared.match(/<option/g)?.length, 3);
    assert.equal(render("private", "Default"), "");
  } finally {
    await vite.close();
  }
});
