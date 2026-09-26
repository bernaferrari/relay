import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Finder and Dock launches have neither the development cwd nor its env. */
export function writeDevAppEntry(resources, desktopRoot, environment) {
  const directory = resolve(resources, "app");
  mkdirSync(directory, { recursive: true });
  writeFileSync(
    resolve(directory, "package.json"),
    JSON.stringify({
      name: "relay-desktop",
      productName: "Relay",
      version: "0.1.0",
      main: "index.cjs",
    }),
  );
  writeFileSync(
    resolve(directory, "index.cjs"),
    [
      `Object.assign(process.env, ${JSON.stringify(environment)});`,
      `process.chdir(${JSON.stringify(desktopRoot)});`,
      `async function openRelay() {`,
      `  if (!process.env.ELECTRON_RENDERER_URL) {`,
      `    await import(${JSON.stringify(pathToFileURL(resolve(desktopRoot, "out/main/index.js")).href)});`,
      `    return;`,
      `  }`,
      `  try {`,
      `    const response = await fetch(process.env.ELECTRON_RENDERER_URL, { signal: AbortSignal.timeout(2000) });`,
      `    if (!response.ok) throw new Error('Renderer unavailable');`,
      `  } catch {`,
      `    const { spawn } = require('node:child_process');`,
      `    const log = require('node:fs').openSync(${JSON.stringify(resolve(desktopRoot, "out/desktop-launch.log"))}, 'a');`,
      `    const child = spawn(process.env.RELAY_DEV_NODE, [${JSON.stringify(resolve(desktopRoot, "scripts/dev.mjs"))}], {`,
      `      cwd: ${JSON.stringify(desktopRoot)}, detached: true, stdio: ['ignore', log, log],`,
      `      env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined },`,
      `    });`,
      `    child.unref();`,
      `    const { app, dialog } = require('electron');`,
      `    await app.whenReady();`,
      `    const started = Date.now();`,
      `    const timer = setInterval(() => {`,
      `      if (require('node:fs').existsSync(${JSON.stringify(resolve(desktopRoot, "out/desktop-inspection.json"))})) { clearInterval(timer); app.quit(); }`,
      `      else if (Date.now() - started > 30000) {`,
      `        clearInterval(timer);`,
      `        dialog.showErrorBox('Relay could not open', 'The development services did not start. Details are in out/desktop-launch.log.');`,
      `        app.quit();`,
      `      }`,
      `    }, 250);`,
      `    return;`,
      `  }`,
      `  await import(${JSON.stringify(pathToFileURL(resolve(desktopRoot, "out/main/index.js")).href)});`,
      `}`,
      `void openRelay();`,
      "",
    ].join("\n"),
  );
}
