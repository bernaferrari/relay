import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { ActionId, ActionMeta } from "@grok-device/core";
import { banner, categoryLabel, paint, ansi } from "./theme.js";
import { createClient, type Client, type ListedDevice } from "./client.js";

export type AppOptions = {
  serverUrl?: string;
};

async function pickIndex(rl: readline.Interface, title: string, labels: string[]): Promise<number> {
  if (labels.length === 0) throw new Error(`Nothing to select: ${title}`);
  console.log(`\n${ansi.primary}${ansi.bold}${title}${ansi.reset}`);
  labels.forEach((label, i) => {
    const n = paint("muted", `  ${String(i + 1).padStart(2)})`);
    console.log(`${n} ${label}`);
  });
  if (labels.length === 1) {
    console.log(paint("muted", "  (only one option — selecting it)"));
    return 0;
  }
  for (;;) {
    const raw = (await rl.question(paint("text", `Select [1-${labels.length}]: `))).trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
    console.log(paint("error", "  Invalid choice, try again."));
  }
}

async function confirm(rl: readline.Interface, q: string): Promise<boolean> {
  const raw = (await rl.question(paint("warning", `${q} [y/N]: `))).trim().toLowerCase();
  return raw === "y" || raw === "yes";
}

function deviceLabel(d: ListedDevice): string {
  const booted =
    d.booted === undefined || d.booted === null ? "" : d.booted ? "booted" : "not-booted";
  const kind = d.kind ?? "device";
  return `${d.name}  ${paint("muted", `(${d.serial})  ${kind}  ${booted}`.trim())}`;
}

function groupActions(actions: readonly ActionMeta[]): { category: string; items: ActionMeta[] }[] {
  const order = ["play-store", "grok"];
  const map = new Map<string, ActionMeta[]>();
  for (const a of actions) {
    const list = map.get(a.category) ?? [];
    list.push(a);
    map.set(a.category, list);
  }
  const groups: { category: string; items: ActionMeta[] }[] = [];
  for (const cat of order) {
    const items = map.get(cat);
    if (items?.length) groups.push({ category: cat, items });
    map.delete(cat);
  }
  for (const [category, items] of map) {
    groups.push({ category, items });
  }
  return groups;
}

/** Flatten category-grouped actions into a single numbered menu with headers. */
function buildActionMenu(actions: readonly ActionMeta[]): {
  labels: string[];
  /** index in labels → action (null for headers — we skip headers by only putting actions) */
  items: ActionMeta[];
} {
  const groups = groupActions(actions);
  const labels: string[] = [];
  const items: ActionMeta[] = [];

  for (const g of groups) {
    // Print category as a non-selectable visual separator by embedding in labels of items
    for (const a of g.items) {
      const cat = categoryLabel(a.category);
      labels.push(`${cat} ${paint("bold", a.title)}  ${paint("muted", "— " + a.description)}`);
      items.push(a);
    }
  }
  return { labels, items };
}

type Screen = "home" | "devices" | "actions" | "run" | "exit";

async function screenHome(rl: readline.Interface, client: Client): Promise<Screen> {
  console.log();
  console.log(banner("Grok Device"));
  console.log(
    paint(
      "muted",
      `  backend: ${client.mode}${client.baseUrl ? ` · ${client.baseUrl}` : " · @grok-device/core"}`,
    ),
  );
  console.log();

  const choice = await pickIndex(rl, "Home", [
    "Devices → pick device & run action",
    "List actions (catalog)",
    "Quit",
  ]);
  if (choice === 0) return "devices";
  if (choice === 1) {
    const actions = await client.listActions();
    console.log();
    for (const g of groupActions(actions)) {
      console.log(`  ${categoryLabel(g.category)}`);
      for (const a of g.items) {
        console.log(`    ${paint("bold", a.id.padEnd(22))} ${paint("muted", a.description)}`);
      }
      console.log();
    }
    return "home";
  }
  return "exit";
}

async function screenDevices(
  rl: readline.Interface,
  client: Client,
): Promise<{ screen: Screen; device?: ListedDevice }> {
  let devices: ListedDevice[];
  try {
    devices = await client.listDevices();
  } catch (err) {
    console.log(
      paint("error", `Could not list devices: ${err instanceof Error ? err.message : String(err)}`),
    );
    return { screen: "home" };
  }

  if (devices.length === 0) {
    console.log(paint("warning", "No Android devices. Connect a phone (adb devices)."));
    return { screen: "home" };
  }

  const labels = [...devices.map(deviceLabel), paint("muted", "← Back to home")];
  const idx = await pickIndex(rl, "Connected Android devices", labels);
  if (idx === devices.length) return { screen: "home" };
  return { screen: "actions", device: devices[idx]! };
}

async function screenActions(
  rl: readline.Interface,
  client: Client,
  device: ListedDevice,
): Promise<{ screen: Screen; action?: ActionMeta }> {
  console.log(
    `\n${paint("success", "→ Device:")} ${device.name} ${paint("muted", `(${device.serial})`)}`,
  );

  const actions = await client.listActions();
  const menu = buildActionMenu(actions);
  const labels = [...menu.labels, paint("muted", "← Back to devices")];
  const idx = await pickIndex(rl, "Actions", labels);
  if (idx === menu.items.length) return { screen: "devices" };
  return { screen: "run", action: menu.items[idx]! };
}

async function screenRun(
  rl: readline.Interface,
  client: Client,
  device: ListedDevice,
  action: ActionMeta,
): Promise<Screen> {
  let skipAccountSwitch = false;
  let skipRestoreHome = false;
  let prodAccountMatch: string | undefined;

  if (action.isAlpha) {
    console.log(paint("muted", "\n  Alpha flow — switches Play account only when needed."));
    skipAccountSwitch = await confirm(rl, "Skip ensuring work/teachx account?");
    skipRestoreHome = await confirm(rl, "Skip restoring gmail/home after?");
  }

  if (action.requiresProdMatch) {
    const existing = process.env.PROD_ACCOUNT_MATCH?.trim();
    if (!existing) {
      const match = (
        await rl.question(paint("text", "PROD_ACCOUNT_MATCH (e.g. gmail.com): "))
      ).trim();
      if (!match) {
        console.log(paint("error", "PROD_ACCOUNT_MATCH is required for this action."));
        return "actions";
      }
      prodAccountMatch = match;
      process.env.PROD_ACCOUNT_MATCH = match;
    } else {
      prodAccountMatch = existing;
    }
    skipAccountSwitch = await confirm(rl, "Skip ensuring prod Play account?");
  }

  console.log(
    `\n${paint("primary", "→ Running")} ${paint("bold", action.id)} ${paint("muted", `on ${device.serial}…`)}\n`,
  );

  const result = await client.run(action.id as ActionId, {
    serial: device.serial,
    skipAccountSwitch,
    skipRestoreHome,
    prodAccountMatch,
    onLog: (line) => {
      if (line.startsWith("==> FAIL")) console.log(paint("error", line));
      else if (line.startsWith("==> DONE")) console.log(paint("success", line));
      else console.log(paint("muted", line));
    },
  });

  if (result.ok) {
    console.log(paint("success", `\n✓ ${action.id} completed`));
  } else {
    console.log(paint("error", `\n✗ ${action.id} failed: ${result.error}`));
  }

  const again = await confirm(rl, "Run another action on this device?");
  return again ? "actions" : "home";
}

/** Main interactive loop: home → devices → actions → run with logs. */
export async function runApp(opts: AppOptions = {}): Promise<void> {
  const client = await createClient(opts.serverUrl);
  const rl = readline.createInterface({ input, output });

  let screen: Screen = "home";
  let device: ListedDevice | undefined;
  let action: ActionMeta | undefined;

  try {
    while (screen !== "exit") {
      switch (screen) {
        case "home": {
          screen = await screenHome(rl, client);
          break;
        }
        case "devices": {
          const r = await screenDevices(rl, client);
          screen = r.screen;
          if (r.device) device = r.device;
          break;
        }
        case "actions": {
          if (!device) {
            screen = "devices";
            break;
          }
          const r = await screenActions(rl, client, device);
          screen = r.screen;
          if (r.action) action = r.action;
          break;
        }
        case "run": {
          if (!device || !action) {
            screen = "home";
            break;
          }
          screen = await screenRun(rl, client, device, action);
          break;
        }
      }
    }
    console.log(paint("muted", "\nBye.\n"));
  } finally {
    rl.close();
  }
}
