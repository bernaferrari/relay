import type { Device } from "./device.js";
import {
  GROK_PACKAGE,
  anyExists,
  exists,
  findClick,
  openApp,
  pressLabel,
  pressPoint,
  scrollDown,
  sleep,
  snapshot,
} from "./device.js";
import { rethrowIosMutationOutcomeUnknown } from "./ios-mutation-policy.js";

function onAuthChooserQueries(): string[] {
  return ["Continue with Google", "Continue with Email", "Continue with email", "Continue with X"];
}

export async function onAuthChooser(device: Device): Promise<boolean> {
  return Boolean(await anyExists(device, onAuthChooserQueries()));
}

export async function alreadySignedIn(device: Device): Promise<boolean> {
  return Boolean(await anyExists(device, ["Ask anything", "chat_text_input", "Imagine", "Speak"]));
}

/**
 * After login: in-app Enable notifications, then system
 * "Allow Grok to send you notifications?" → Allow.
 * Throws if nothing usable happens and still on chooser-like state is not required —
 * only throws when we explicitly fail a required press after seeing the control.
 */
export async function postLoginNotifications(device: Device, timeoutMs = 90_000): Promise<void> {
  const end = Date.now() + timeoutMs;
  let sawEnable = false;
  let sawAllow = false;

  while (Date.now() < end) {
    if (await exists(device, "Enable notifications")) {
      await pressLabel(device, "Enable notifications").catch((error) => {
        rethrowIosMutationOutcomeUnknown(error);
        return findClick(device, "Enable notifications");
      });
      sawEnable = true;
      await sleep(1000, device);
    }

    const systemPrompt =
      (await exists(device, "Allow Grok to send you notifications?")) ||
      (await exists(device, "Allow Grok to send notifications"));

    if (systemPrompt || (sawEnable && (await exists(device, "Allow")))) {
      await pressLabel(device, "Allow").catch((error) => {
        rethrowIosMutationOutcomeUnknown(error);
        return findClick(device, "Allow");
      });
      sawAllow = true;
      await sleep(1000, device);
      break;
    }

    if ((await alreadySignedIn(device)) && !sawEnable) {
      // Late permission sheet
      if (await exists(device, "Allow")) {
        await findClick(device, "Allow").catch((error) => {
          rethrowIosMutationOutcomeUnknown(error);
        });
        sawAllow = true;
      }
      break;
    }

    await sleep(1000, device);
  }

  if (!sawEnable && !sawAllow) {
    // Not always shown (already granted). Don't throw — login may still be valid.
    console.warn("warn: no Enable notifications / Allow dialog (may already be granted)");
  }
}

async function loginWithProvider(
  device: Device,
  providerLabel: string,
  actionName: string,
): Promise<void> {
  await openApp(device, GROK_PACKAGE, { relaunch: true });

  if ((await alreadySignedIn(device)) && !(await onAuthChooser(device))) {
    throw new Error(`${actionName}: already signed in (no auth chooser). Run logout first.`);
  }

  // Wait for chooser
  const end = Date.now() + 45_000;
  while (Date.now() < end && !(await onAuthChooser(device))) {
    await sleep(1000, device);
  }
  if (!(await onAuthChooser(device))) {
    throw new Error(`${actionName}: auth chooser not visible`);
  }

  try {
    await pressLabel(device, providerLabel);
  } catch (error) {
    rethrowIosMutationOutcomeUnknown(error);
    if (providerLabel === "Continue with Email") {
      await pressLabel(device, "Continue with email").catch((fallbackError) => {
        rethrowIosMutationOutcomeUnknown(fallbackError);
        return findClick(device, providerLabel);
      });
    } else {
      await findClick(device, providerLabel);
    }
  }
  await sleep(2500, device);

  // Wait until post-auth UI or main app (provider web UI may need human help)
  const waitEnd = Date.now() + 120_000;
  while (Date.now() < waitEnd) {
    if (
      (await exists(device, "Enable notifications")) ||
      (await exists(device, "Allow Grok to send you notifications?")) ||
      (await alreadySignedIn(device))
    ) {
      break;
    }
    // still on chooser — one retry
    if (await onAuthChooser(device)) {
      await findClick(device, providerLabel).catch((error) => {
        rethrowIosMutationOutcomeUnknown(error);
      });
    }
    await sleep(2000, device);
  }

  await postLoginNotifications(device);
}

export async function loginGoogle(device: Device): Promise<void> {
  await loginWithProvider(device, "Continue with Google", "login-google");
}

export async function loginEmail(device: Device): Promise<void> {
  await loginWithProvider(device, "Continue with Email", "login-email");
}

export async function loginX(device: Device): Promise<void> {
  await loginWithProvider(device, "Continue with X", "login-x");
}

/** Top-left menu → Settings → scroll → Sign out. */
export async function logout(device: Device): Promise<void> {
  await openApp(device, GROK_PACKAGE, { relaunch: true });

  // Clear permission noise
  if (await exists(device, "Allow Grok to send you notifications?")) {
    await findClick(device, "Allow").catch((error) => {
      rethrowIosMutationOutcomeUnknown(error);
    });
    await sleep(800, device);
  }
  if (await exists(device, "Enable notifications")) {
    await findClick(device, "Enable notifications").catch((error) => {
      rethrowIosMutationOutcomeUnknown(error);
    });
    await sleep(800, device);
    await findClick(device, "Allow").catch((error) => {
      rethrowIosMutationOutcomeUnknown(error);
    });
    await sleep(800, device);
  }
  if (await exists(device, "Skip")) {
    await findClick(device, "Skip").catch((error) => {
      rethrowIosMutationOutcomeUnknown(error);
    });
    await sleep(800, device);
  }

  if (await onAuthChooser(device)) {
    console.log("Already logged out (auth chooser visible)");
    return;
  }

  // Top-left menu (often unlabeled)
  try {
    await pressLabel(device, "Menu");
  } catch (error) {
    rethrowIosMutationOutcomeUnknown(error);
    await pressPoint(device, 78, 192);
  }
  await sleep(2000, device);

  try {
    await pressLabel(device, "Settings");
  } catch (error) {
    rethrowIosMutationOutcomeUnknown(error);
    try {
      await findClick(device, "Settings");
    } catch (fallbackError) {
      rethrowIosMutationOutcomeUnknown(fallbackError);
      // observed settings control near bottom of drawer
      await pressPoint(device, 810, 2104);
    }
  }
  await sleep(2000, device);

  let found = false;
  for (let i = 0; i < 14; i++) {
    if (
      (await exists(device, "Sign out")) ||
      (await exists(device, "Sign Out")) ||
      (await exists(device, "Log out"))
    ) {
      found = true;
      break;
    }
    await scrollDown(device, 0.5);
    await sleep(600, device);
  }
  if (!found) {
    throw new Error("Sign out not found in Settings after scrolling");
  }

  try {
    await pressLabel(device, "Sign out");
  } catch (error) {
    rethrowIosMutationOutcomeUnknown(error);
    await findClick(device, "Sign out").catch((fallbackError) => {
      rethrowIosMutationOutcomeUnknown(fallbackError);
      return findClick(device, "Sign Out");
    });
  }
  await sleep(1000, device);

  // confirm if second dialog
  for (const c of ["Sign out", "Sign Out", "Log out", "Confirm", "OK", "Yes"]) {
    if (await exists(device, c)) {
      await findClick(device, c).catch((error) => {
        rethrowIosMutationOutcomeUnknown(error);
      });
      break;
    }
  }
  await sleep(2000, device);

  if ((await alreadySignedIn(device)) && !(await onAuthChooser(device))) {
    // re-check once
    await sleep(2000, device);
    if ((await alreadySignedIn(device)) && !(await onAuthChooser(device))) {
      throw new Error("Still signed in after Sign out");
    }
  }
}

// keep snapshot import used for potential future debug
void snapshot;
