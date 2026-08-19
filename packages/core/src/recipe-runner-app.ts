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
 *
 * "Nobody can say who owns the screen" is not the same answer as "somebody else
 * does". Android names the resumed activity, so silence there means the snapshot
 * helper is broken and the step must fail closed. An iOS accessibility tree
 * carries application ownership only sometimes — a live iPad returns a hundred
 * labelled nodes and no bundle id at all — and failing on that grounds every
 * recipe on the device, which is the opposite of what verification is for. A
 * handoff, the risk this check exists for, still reports the app it landed on
 * and still fails.
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
  const namesTheForeground = context.kind === "device" && context.platform === "android";
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

  if (lastObservation.status === "unavailable" && !namesTheForeground) {
    log(
      `app open: launched ${expectedApp}; this target cannot say which app owns the screen, so the step is not verified`,
    );
    return;
  }
  const observed = lastObservation.status === "mismatch" ? lastObservation.app : "unavailable";
  throw new Error(
    `app open: expected ${expectedApp} in foreground after 2 attempts; observed ${observed}`,
  );
}
