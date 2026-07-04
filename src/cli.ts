#!/usr/bin/env node
/**
 * Interactive: vp run dev
 * Direct:      vp exec tsx src/cli.ts update-last-alpha
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { createDevice, PLATFORM, WORK_ACCOUNT_MATCH } from "./device.js";
import {
  HOME_ACCOUNT_MATCH,
  installLastAlpha,
  installLastProd,
  reinstallLastAlpha,
  updateLastAlpha,
  updateLastProd,
  type GrokListingAction,
} from "./play-store.js";
import { loginEmail, loginGoogle, loginX, logout } from "./grok.js";

const ACTIONS = [
  "update-last-alpha",
  "install-last-alpha",
  "reinstall-last-alpha",
  "update-last-prod",
  "install-last-prod",
  "login-google",
  "login-email",
  "login-x",
  "logout",
] as const;

type Action = (typeof ACTIONS)[number];

const ACTION_HELP: Record<Action, string> = {
  "update-last-alpha": "Any account → teachx → Update only (or already-latest) → restore gmail",
  "install-last-alpha": "Any account → teachx → Update or first Install → restore gmail",
  "reinstall-last-alpha": "Any account → teachx → Uninstall → Install → restore gmail",
  "update-last-prod": "Any account → PROD_ACCOUNT_MATCH → Update only (no reinstall)",
  "install-last-prod": "Any account → PROD_ACCOUNT_MATCH → Uninstall → Install",
  "login-google": "Continue with Google → notifications Allow",
  "login-email": "Continue with Email → notifications Allow",
  "login-x": "Continue with X → notifications Allow",
  logout: "Menu → Settings → Sign out",
};

function usage(): never {
  console.log(`Usage:
  vp run dev                                    # interactive: device + action
  vp exec tsx src/cli.ts <action> [flags]       # direct

Play Store (works from any current account):
  update-last-alpha      teachx → Update only → restore gmail
  install-last-alpha     teachx → Update|Install → restore gmail
  reinstall-last-alpha   teachx → Uninstall+Install → restore gmail
  update-last-prod       PROD_ACCOUNT_MATCH → Update only
  install-last-prod      PROD_ACCOUNT_MATCH → Uninstall+Install

Grok app:
  login-google | login-email | login-x | logout

Flags:
  --skip-account-switch   Do not ensure/switch Play account before op
  --skip-restore-home     After alpha, do not restore gmail/home

Env:
  WORK_ACCOUNT_MATCH=${WORK_ACCOUNT_MATCH}
  HOME_ACCOUNT_MATCH=${HOME_ACCOUNT_MATCH}
  PROD_ACCOUNT_MATCH      required for *-prod
  AGENT_DEVICE_SERIAL     set by interactive picker
`);
  process.exit(2);
}

async function pickIndex(rl: readline.Interface, title: string, labels: string[]): Promise<number> {
  if (labels.length === 0) throw new Error(`Nothing to select: ${title}`);
  console.log(`\n${title}`);
  labels.forEach((label, i) => console.log(`  ${i + 1}) ${label}`));
  if (labels.length === 1) {
    console.log("  (only one option — selecting it)");
    return 0;
  }
  for (;;) {
    const raw = (await rl.question(`Select [1-${labels.length}]: `)).trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
    console.log("  Invalid choice, try again.");
  }
}

async function confirm(rl: readline.Interface, q: string): Promise<boolean> {
  const raw = (await rl.question(`${q} [y/N]: `)).trim().toLowerCase();
  return raw === "y" || raw === "yes";
}

type ListedDevice = {
  name: string;
  serial: string;
  label: string;
};

async function listAndroidDevices(): Promise<ListedDevice[]> {
  const client = createDevice();
  const devices = await client.devices.list({ platform: PLATFORM });
  return devices.map((d) => {
    const serial = d.android?.serial ?? d.identifiers?.serial ?? d.id;
    const booted = d.booted === undefined ? "" : d.booted ? "booted" : "not-booted";
    return {
      name: d.name,
      serial,
      label: `${d.name}  (${serial})  ${d.kind ?? "device"}  ${booted}`.trim(),
    };
  });
}

function logListingResult(action: string, result: GrokListingAction): void {
  if (result === "already-latest") {
    console.log(`==> DONE: ${action} — already on latest; home → ${HOME_ACCOUNT_MATCH}`);
  } else {
    console.log(`==> DONE: ${action} — ${result}; home → ${HOME_ACCOUNT_MATCH}`);
  }
}

async function runAction(
  action: Action,
  opts: { skipAccountSwitch?: boolean; skipRestoreHome?: boolean } = {},
): Promise<void> {
  const device = createDevice();
  console.log(`==> ${action}`);
  const flow = {
    skipAccountSwitch: opts.skipAccountSwitch,
    skipRestoreHome: opts.skipRestoreHome,
  };

  switch (action) {
    case "update-last-alpha": {
      const result = await updateLastAlpha(device, flow);
      logListingResult(action, result);
      return;
    }
    case "install-last-alpha": {
      const result = await installLastAlpha(device, flow);
      logListingResult(action, result);
      return;
    }
    case "reinstall-last-alpha":
      await reinstallLastAlpha(device, flow);
      break;
    case "update-last-prod": {
      const result = await updateLastProd(device, flow);
      console.log(
        result === "already-latest"
          ? `==> DONE: ${action} — already on latest`
          : `==> DONE: ${action} — ${result}`,
      );
      return;
    }
    case "install-last-prod":
      await installLastProd(device, flow);
      break;
    case "login-google":
      await loginGoogle(device);
      break;
    case "login-email":
      await loginEmail(device);
      break;
    case "login-x":
      await loginX(device);
      break;
    case "logout":
      await logout(device);
      break;
  }
  console.log(`==> DONE: ${action}`);
}

async function runInteractive(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("Grok device actions (agent-device SDK)\n");

    const devices = await listAndroidDevices().catch((err: unknown) => {
      throw new Error(
        `Could not list devices: ${err instanceof Error ? err.message : String(err)}`,
      );
    });
    if (devices.length === 0) {
      throw new Error("No Android devices. Connect a phone (adb devices).");
    }

    const deviceIdx = await pickIndex(
      rl,
      "Connected Android devices:",
      devices.map((d) => d.label),
    );
    const selected = devices[deviceIdx]!;
    process.env.AGENT_DEVICE_SERIAL = selected.serial;
    process.env.ANDROID_SERIAL = selected.serial;
    console.log(`\n→ Device: ${selected.name} (${selected.serial})`);

    const actionIdx = await pickIndex(
      rl,
      "Actions / tests:",
      ACTIONS.map((a) => `${a} — ${ACTION_HELP[a]}`),
    );
    const action = ACTIONS[actionIdx]!;

    let skipAccountSwitch = false;
    let skipRestoreHome = false;

    const isAlpha =
      action === "update-last-alpha" ||
      action === "install-last-alpha" ||
      action === "reinstall-last-alpha";
    const isProd = action === "update-last-prod" || action === "install-last-prod";

    if (isAlpha) {
      console.log(`\n  work: ${WORK_ACCOUNT_MATCH}\n  restore home: ${HOME_ACCOUNT_MATCH}`);
      console.log("  (Works from any current Play account — switches only when needed.)");
      skipAccountSwitch = await confirm(rl, "Skip ensuring teachx account?");
      skipRestoreHome = await confirm(rl, "Skip restoring gmail/home after?");
    }

    if (isProd) {
      if (!process.env.PROD_ACCOUNT_MATCH?.trim()) {
        const match = (await rl.question("PROD_ACCOUNT_MATCH (e.g. gmail.com): ")).trim();
        if (!match) throw new Error("PROD_ACCOUNT_MATCH is required");
        process.env.PROD_ACCOUNT_MATCH = match;
      }
      skipAccountSwitch = await confirm(rl, "Skip ensuring prod Play account?");
    }

    console.log(`\n→ Running ${action} on ${selected.serial}…\n`);
    await runAction(action, { skipAccountSwitch, skipRestoreHome });
  } finally {
    rl.close();
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === "interactive" || argv[0] === "i") {
    await runInteractive();
    return;
  }
  if (argv[0] === "-h" || argv[0] === "--help" || argv[0] === "help") usage();

  const action = argv[0] as Action;
  if (!(ACTIONS as readonly string[]).includes(action)) usage();

  await runAction(action, {
    skipAccountSwitch: argv.includes("--skip-account-switch"),
    skipRestoreHome: argv.includes("--skip-restore-home"),
  });
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`error: ${message}`);
  if (err instanceof Error && err.stack) console.error(err.stack);
  console.error(
    "\nHint: agent-device devices --platform android && agent-device snapshot -i --platform android",
  );
  process.exit(1);
});
