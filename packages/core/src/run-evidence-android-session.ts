import { captureAndroidForegroundApp } from "./android-ui-snapshot.js";
import { base, bindAndroidAppSession, type Device } from "./device.js";
import type { TestJob } from "./session.js";
import { withTimeout } from "./run-evidence-timeout.js";

/** Android observability needs an app-bound SDK session, not a UI tree.
 * Snapshotting here unnecessarily acquires UiAutomation and lets a slow
 * accessibility capture disable otherwise independent diagnostics. Actual
 * run checkpoints collect their own screen evidence. */
export async function primeAndroidEvidenceSession(
  job: TestJob,
  device: Device,
  log: (line: string) => void,
  recordEvent: (kind: string, data: unknown) => void,
  foregroundAppResolver: (
    serial: string,
  ) => Promise<string | undefined> = captureAndroidForegroundApp,
): Promise<"not-required" | "app-bound" | "surface-only" | "unavailable"> {
  if (job.targetKind === "browser" || job.platform !== "android" || !job.serial) {
    return "not-required";
  }

  let appSessionBound = false;
  try {
    let appPackage: string | undefined;
    if (device.command?.appState) {
      try {
        const state = await withTimeout(
          device.command.appState({ ...base() }),
          3_000,
          "Android foreground app",
        );
        if ("package" in state && typeof state.package === "string") {
          const candidate = state.package.trim();
          if (candidate && !/(?:launcher|systemui)$/i.test(candidate)) appPackage = candidate;
        }
      } catch {
        // Raw foreground discovery below remains available when this
        // session-scoped command has not been bound yet.
      }
    }
    if (!appPackage) {
      const foreground = await withTimeout(
        foregroundAppResolver(job.serial),
        2_500,
        "Android foreground app discovery",
      ).catch(() => undefined);
      if (foreground && !/(?:launcher|systemui|inputmethod|keyboard)$/i.test(foreground)) {
        appPackage = foreground;
      }
    }
    if (appPackage) {
      await withTimeout(
        bindAndroidAppSession(device, appPackage, job.serial),
        5_000,
        "Android app session",
      );
      recordEvent("app.session.bound", { platform: "android", app: appPackage });
      log(`evidence: Android app session bound to ${appPackage}`);
      appSessionBound = true;
    }
  } catch (error) {
    log(
      `warn: Android evidence session could not be primed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    // Collectors require confirmed binding; failed app discovery/binding must
    // remain unavailable rather than being reported as successful collection.
    return "unavailable";
  }
  return appSessionBound ? "app-bound" : "surface-only";
}
