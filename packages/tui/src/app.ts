/**
 * Themed terminal UI for app testing (OpenCode-inspired menus + device workspace).
 */
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { theme, banner, colorStatus } from "./theme.js";
import { createClient, type DeviceClient } from "./client.js";

async function pickIndex(rl: readline.Interface, title: string, labels: string[]): Promise<number> {
  if (labels.length === 0) throw new Error(`Nothing to select: ${title}`);
  console.log(`\n${theme.muted(title)}`);
  labels.forEach((label, i) =>
    console.log(`  ${theme.primary(String(i + 1).padStart(2))}  ${label}`),
  );
  if (labels.length === 1) {
    console.log(theme.muted("  (only one option — selecting it)"));
    return 0;
  }
  for (;;) {
    const raw = (await rl.question(theme.muted(`Select [1-${labels.length}]: `))).trim();
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= labels.length) return n - 1;
    console.log(theme.error("  Invalid choice, try again."));
  }
}

async function confirm(rl: readline.Interface, q: string): Promise<boolean> {
  const raw = (await rl.question(`${q} [y/N]: `)).trim().toLowerCase();
  return raw === "y" || raw === "yes";
}

export type TuiOptions = {
  serverUrl?: string;
};

export async function runApp(opts: TuiOptions = {}): Promise<void> {
  const rl = readline.createInterface({ input, output });
  const client = await createClient(opts.serverUrl);

  try {
    console.log(banner(client.mode));
    console.log(
      theme.muted(
        `  mode: ${client.mode}${client.baseUrl ? ` · ${client.baseUrl}` : " · in-process"}`,
      ),
    );

    let serial: string | undefined;

    // device pick once, then loop
    const devices = await client.listDevices();
    if (devices.length === 0) {
      console.log(theme.error("\nNo Android devices. Connect a phone (adb devices)."));
      return;
    }
    const di = await pickIndex(
      rl,
      "Connected devices:",
      devices.map((d) => `${d.name}  ${theme.muted(`(${d.serial})`)}`),
    );
    serial = devices[di]!.serial;
    await client.selectDevice(serial);
    console.log(theme.success(`\n→ Device ${serial}`));

    for (;;) {
      console.log("");
      const menu = [
        "Run test action",
        "UI snapshot (inspector tree)",
        "Screenshot path",
        "Job history",
        "Cancel active job",
        "Pause active job",
        "Resume paused job",
        "Switch device",
        "Quit",
      ];
      const choice = await pickIndex(rl, "Workspace:", menu);

      if (choice === 8) break;

      if (choice === 7) {
        const next = await client.listDevices();
        const i = await pickIndex(
          rl,
          "Devices:",
          next.map((d) => `${d.name} (${d.serial})`),
        );
        serial = next[i]!.serial;
        await client.selectDevice(serial);
        console.log(theme.success(`→ Device ${serial}`));
        continue;
      }

      if (choice === 6) {
        try {
          await client.resume();
          console.log(theme.success("Resumed active job"));
        } catch (err) {
          console.log(theme.error(err instanceof Error ? err.message : String(err)));
        }
        continue;
      }

      if (choice === 5) {
        try {
          await client.pause();
          console.log(theme.warning("Paused active job"));
        } catch (err) {
          console.log(theme.error(err instanceof Error ? err.message : String(err)));
        }
        continue;
      }

      if (choice === 4) {
        try {
          await client.cancel();
          console.log(theme.error("Cancelled active job"));
        } catch (err) {
          console.log(theme.error(err instanceof Error ? err.message : String(err)));
        }
        continue;
      }

      if (choice === 3) {
        const jobs = await client.listJobs();
        if (jobs.length === 0) {
          console.log(theme.muted("No jobs yet."));
          continue;
        }
        for (const j of jobs.slice(0, 20)) {
          console.log(
            `  ${colorStatus(j.status)}  ${j.action.padEnd(22)}  ${theme.muted(j.id.slice(0, 8))}${j.error ? theme.error(`  ${j.error}`) : ""}`,
          );
        }
        continue;
      }

      if (choice === 2) {
        try {
          const shot = await client.screenshot(serial);
          console.log(theme.success(`Screenshot → ${shot.path} (${shot.bytes} bytes)`));
        } catch (err) {
          console.log(theme.error(err instanceof Error ? err.message : String(err)));
        }
        continue;
      }

      if (choice === 1) {
        try {
          const snap = await client.snapshot(serial);
          console.log(
            theme.muted(`\n${snap.nodes.length} nodes · interactive ${snap.interactive.length}\n`),
          );
          console.log(snap.tree || theme.muted("(empty tree)"));
        } catch (err) {
          console.log(theme.error(err instanceof Error ? err.message : String(err)));
        }
        continue;
      }

      // run action
      const actions = await client.listActions();
      const play = actions.filter((a) => a.category === "play-store");
      const grok = actions.filter((a) => a.category === "grok");
      const ordered = [...play, ...grok];
      const ai = await pickIndex(
        rl,
        "Actions:",
        ordered.map((a) => `${a.title}  ${theme.muted(a.id)}`),
      );
      const action = ordered[ai]!;

      let skipAccountSwitch = false;
      let skipRestoreHome = false;
      if (action.isAlpha) {
        skipAccountSwitch = await confirm(rl, "Skip ensuring teachx account?");
        skipRestoreHome = await confirm(rl, "Skip restoring gmail/home after?");
      }
      if (action.requiresProdMatch && !process.env.PROD_ACCOUNT_MATCH?.trim()) {
        const match = (await rl.question("PROD_ACCOUNT_MATCH (e.g. gmail.com): ")).trim();
        if (!match) {
          console.log(theme.error("PROD_ACCOUNT_MATCH required"));
          continue;
        }
        process.env.PROD_ACCOUNT_MATCH = match;
      }

      console.log(theme.primary(`\n→ Running ${action.id} on ${serial}…`));
      console.log(theme.muted("  Ctrl+C cancel · menu: Pause / Resume / Cancel\n"));

      const onSig = () => {
        console.log(theme.error("\n→ cancel (Ctrl+C)…"));
        void client.cancel().catch(() => undefined);
      };
      process.on("SIGINT", onSig);

      let result: { ok: boolean; error?: string; status?: string };
      try {
        result = await client.runAction({
          action: action.id,
          serial,
          skipAccountSwitch,
          skipRestoreHome,
          onLog: (line) => console.log(theme.muted(line)),
        });
      } finally {
        process.off("SIGINT", onSig);
      }

      if (result.status === "cancelled") {
        console.log(theme.error(`\nCANCELLED ${action.id}`));
      } else if (result.ok) {
        console.log(theme.success(`\nDONE ${action.id}`));
      } else {
        console.log(theme.error(`\nFAIL ${action.id}: ${result.error}`));
      }
    }
  } finally {
    rl.close();
  }
}

// silence unused type export noise in some resolvers
export type { DeviceClient };
