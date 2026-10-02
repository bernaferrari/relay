import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";

export const MACOS_CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function installedBrowserCandidates(
  platform = process.platform,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin") {
    return [
      MACOS_CHROME,
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    ];
  }
  if (platform === "win32") {
    return [environment.PROGRAMFILES, environment["PROGRAMFILES(X86)"], environment.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .flatMap((root) => [
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
      ]);
  }
  return (environment.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((root) =>
      [
        "google-chrome",
        "google-chrome-stable",
        "chromium",
        "chromium-browser",
        "microsoft-edge",
      ].map((name) => join(root, name)),
    );
}

export function isBrowserExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Server-owned selection. An explicit path never silently falls back. */
export function resolveBrowserExecutable(
  input: {
    platform?: NodeJS.Platform;
    environment?: NodeJS.ProcessEnv;
    isExecutable?: (path: string) => boolean;
  } = {},
): { path?: string; candidates: string[]; configured: boolean } {
  const environment = input.environment ?? process.env;
  const configured = environment.RELAY_BROWSER_EXECUTABLE?.trim();
  const candidates = configured
    ? [configured]
    : installedBrowserCandidates(input.platform ?? process.platform, environment);
  const executable = input.isExecutable ?? isBrowserExecutable;
  return {
    path: candidates.find(executable),
    candidates,
    configured: Boolean(configured),
  };
}
