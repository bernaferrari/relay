/**
 * Interactive device + action picker for the CLI.
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  ACTIONS,
  createDevice,
  HOME_ACCOUNT_MATCH,
  PLATFORM,
  WORK_ACCOUNT_MATCH,
  runAction,
  type ActionMeta,
} from "@relay/core";

export type ListedDevice = {
  name: string;
  serial: string;
  label: string;
};

export async function listAndroidDevices(): Promise<ListedDevice[]> {
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

function actionLabel(meta: ActionMeta): string {
  return `${meta.id} — ${meta.description}`;
}

export async function runInteractive(): Promise<void> {
  const rl = readline.createInterface({ input, output });
  try {
    console.log("Relay actions (agent-device SDK)\n");

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

    const actionIdx = await pickIndex(rl, "Actions / tests:", ACTIONS.map(actionLabel));
    const meta = ACTIONS[actionIdx]!;
    const action = meta.id;

    if (meta.isAlpha) {
      console.log(`\n  work: ${WORK_ACCOUNT_MATCH}\n  restore home: ${HOME_ACCOUNT_MATCH}`);
      console.log("  (Always switches to work account, then restores home after.)");
    }

    if (meta.requiresProdMatch) {
      if (!process.env.PROD_ACCOUNT_MATCH?.trim()) {
        const match = (await rl.question("PROD_ACCOUNT_MATCH (e.g. gmail.com): ")).trim();
        if (!match) throw new Error("PROD_ACCOUNT_MATCH is required");
        process.env.PROD_ACCOUNT_MATCH = match;
      }
    }

    console.log(`\n→ Running ${action} on ${selected.serial}…\n`);

    const device = createDevice();
    const result = await runAction(device, action);
    if (!result.ok) {
      throw new Error(result.error);
    }
  } finally {
    rl.close();
  }
}
