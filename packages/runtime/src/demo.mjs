import { runFirstDemo } from "../../../scripts/first-run-demo.mjs";
import { resolveBrowserExecutable } from "../../core/src/browser-executable.ts";

export async function runPackagedDemo(options) {
  if (options.authToken ?? process.env.RELAY_AUTH_TOKEN) {
    throw new Error(
      "The browser demo requires a trusted local Relay service without static-token authentication. Use a separate local workspace for the demo. Authenticated startup and panel access are supported; workspace asset actions retain the canonical local-host boundary. Saved Tests and evidence are preserved; no input was retried.",
    );
  }
  const browser = resolveBrowserExecutable();
  return runFirstDemo({
    ...options,
    createLocalReport: true,
    prerequisiteReport: {
      ready: Boolean(browser.path),
      failures: browser.path
        ? []
        : [
            "Install Chrome or Chromium, or set RELAY_BROWSER_EXECUTABLE to an absolute executable path before starting Relay.",
          ],
    },
  });
}
