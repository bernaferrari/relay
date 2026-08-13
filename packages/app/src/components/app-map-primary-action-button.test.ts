import assert from "node:assert/strict";
import test from "node:test";
import { renderToString } from "solid-js/web";
import { createServer } from "vite";
import solid from "vite-plugin-solid";
import type { AppMapPrimaryAction } from "../lib/app-map-primary-action";

type PrimaryActionButton = (props: {
  action: AppMapPrimaryAction;
  fallbackTip: string;
  onActivate: () => void;
}) => unknown;

const actions: AppMapPrimaryAction[] = [
  { kind: "run", label: "Run path", reason: "", icon: "play" },
  { kind: "view-run", label: "View run", reason: "Open progress", icon: "arrow-right" },
  { kind: "choose-device", label: "Choose device", reason: "Choose a target", icon: "smartphone" },
  { kind: "open-device", label: "Reconnect device", reason: "Reconnect", icon: "refresh" },
  { kind: "record-path", label: "Start recording", reason: "Record", icon: "circle" },
  { kind: "keep-path", label: "Keep path", reason: "Keep this Take", icon: "check" },
  { kind: "capture-screen", label: "Save first screen", reason: "Capture", icon: "camera" },
  { kind: "blocked", label: "Connecting…", reason: "Waiting for pixels", icon: "refresh" },
];

test("renders every primary action with its label and truthful disabled description", async () => {
  const vite = await createServer({
    configFile: false,
    plugins: [solid({ ssr: true, hot: false })],
    server: { middlewareMode: true, ws: { port: 24679 } },
    appType: "custom",
  });
  try {
    const module = await vite.ssrLoadModule("/src/components/app-map-primary-action-button.tsx");
    const Button = module.AppMapPrimaryActionButton as PrimaryActionButton;
    for (const action of actions) {
      const html = renderToString(
        () =>
          Button({ action, fallbackTip: "Run this path", onActivate: () => undefined }) as never,
      );
      assert.match(html, new RegExp(`aria-label="${action.label}"`));
      assert.equal(html.includes('aria-disabled="true"'), action.kind === "blocked");
      assert.equal(
        html.includes('aria-describedby="app-map-primary-action-reason"'),
        Boolean(action.reason),
      );
      if (action.reason) assert.match(html, new RegExp(`>${action.reason}</span>`));
    }
  } finally {
    await vite.close();
  }
});
