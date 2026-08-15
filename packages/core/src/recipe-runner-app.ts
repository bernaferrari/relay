import type { Device } from "./device.js";
import { openApp, snapshot } from "./device.js";
import { captureAndroidForegroundApp } from "./android-ui-snapshot.js";
import { foregroundApplicationBundle } from "./recipe-runner-tour-matching.js";
import { currentTargetContext } from "./target-context.js";
import { resolveIosLaunchBundleId } from "./ios-app-launch.js";

export type ForegroundAppObservation =
  | { status: "matched"; app: string }
  | { status: "mismatch"; app: string }
  | { status: "unavailable" };

function sameApplication(left: string, right: string): boolean {
  return left.trim().toLocaleLowerCase() === right.trim().toLocaleLowerCase();
}

/**
 * Observe the application that owns the currently visible device surface.
 * Android exposes an authoritative resumed activity. Other targets use the
 * application ownership carried by the accessibility tree.
 */
export async function observeForegroundApplication(
  device: Device,
  expectedApp: string,
): Promise<ForegroundAppObservation> {
  const context = currentTargetContext();
  let foregroundApp: string | undefined;
  try {
    foregroundApp =
      context.kind === "device" && context.platform === "android"
        ? await captureAndroidForegroundApp(context.serial)
        : foregroundApplicationBundle(await snapshot(device));
  } catch {
    foregroundApp = undefined;
  }
  if (!foregroundApp) return { status: "unavailable" };
  return sameApplication(foregroundApp, expectedApp)
    ? { status: "matched", app: foregroundApp }
    : { status: "mismatch", app: foregroundApp };
}

export type VerifiedAppOpenDependencies = {
  open?: typeof openApp;
  observe?: typeof observeForegroundApplication;
};

/**
 * An app-open setup step is not complete until the requested app owns the
 * foreground. Retry one complete launch when the OS races, redirects, or
 * leaves another app visible, then fail before dependent setup can continue.
 */
export async function openAppAndVerifyForeground(
  device: Device,
  requestedApp: string,
  options: { relaunch?: boolean } | undefined,
  log: (message: string) => void,
  dependencies: VerifiedAppOpenDependencies = {},
): Promise<void> {
  const launch = dependencies.open ?? openApp;
  const observe = dependencies.observe ?? observeForegroundApplication;
  const context = currentTargetContext();
  const expectedApp =
    context.kind === "device" && context.platform === "ios"
      ? resolveIosLaunchBundleId(requestedApp)
      : requestedApp;
  let lastObservation: ForegroundAppObservation = { status: "unavailable" };

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await launch(device, requestedApp, options);
    lastObservation = await observe(device, expectedApp);
    if (lastObservation.status === "matched") {
      if (attempt > 1) log(`app open: ${expectedApp} foreground verified after retry`);
      return;
    }
    if (attempt === 1) {
      log(
        `app open: ${expectedApp} not verified in foreground (observed ${
          lastObservation.status === "mismatch" ? lastObservation.app : "unavailable"
        }); retrying launch`,
      );
    }
  }

  const observed = lastObservation.status === "mismatch" ? lastObservation.app : "unavailable";
  throw new Error(
    `app open: expected ${expectedApp} in foreground after 2 attempts; observed ${observed}`,
  );
}
