import { captureAndroidForegroundApp } from "./android-ui-snapshot.js";
import { hardStopDeviceSession } from "./control.js";
import { base, bindAndroidAppSession, type Device } from "./device.js";
import type { TestJob } from "./session.js";
import { withTimeout, withTimeoutAndDrain } from "./run-evidence-timeout.js";

/** Android observability is session-scoped in agent-device. Warm the exact
 * app/session before starting those collectors; the snapshot is transport
 * setup and is never presented as proof evidence. */
export async function primeAndroidEvidenceSession(
  job: TestJob,
  device: Device,
  log: (line: string) => void,
  recordEvent: (kind: string, data: unknown) => void,
  foregroundAppResolver: (
    serial: string,
  ) => Promise<string | undefined> = captureAndroidForegroundApp,
): Promise<"not-required" | "app-bound" | "surface-only"> {
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
    const result = await withTimeoutAndDrain(
      device.capture.snapshot({ ...base(), interactiveOnly: false }),
      5_000,
      "Android evidence session",
      () => hardStopDeviceSession(job.targetContext),
    );
    const nodes = Array.isArray(result?.nodes) ? result.nodes.length : 0;
    recordEvent("session.primed", { platform: "android", nodes });
    log(
      nodes > 0
        ? `evidence: Android session ready (${nodes} UI nodes observed)`
        : "evidence: Android session ready (UI tree unavailable)",
    );
  } catch (error) {
    log(
      `warn: Android evidence session could not be primed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return appSessionBound ? "app-bound" : "surface-only";
}
