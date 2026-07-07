/**
 * Interactive TUI for app testing — keyboard nav, Enter to select.
 */
import { theme, banner, colorStatus, hint } from "./theme.js";
import { selectIndex, confirm, promptText, statusLine, type SelectItem } from "./select.js";
import { createClient, type DeviceClient } from "./client.js";

export type TuiOptions = {
  serverUrl?: string;
};

type MenuId =
  | "run"
  | "snapshot"
  | "screenshot"
  | "history"
  | "cancel"
  | "pause"
  | "resume"
  | "device"
  | "quit";

async function pickDevice(client: DeviceClient, title = "Select device"): Promise<string | null> {
  const devices = await client.listDevices();
  if (devices.length === 0) {
    console.log(theme.error("\n  No Android devices. Connect a phone (adb devices).\n"));
    return null;
  }
  if (devices.length === 1) {
    const only = devices[0]!;
    statusLine([theme.success(`Device ${only.name}`), theme.muted(only.serial)]);
    return only.serial;
  }
  const items: SelectItem[] = devices.map((d) => ({
    label: d.name,
    description: d.serial,
    value: d.serial,
  }));
  const i = await selectIndex({ title, items, cancelable: true });
  if (i === null) return null;
  return devices[i]!.serial;
}

async function runActionFlow(client: DeviceClient, serial: string): Promise<void> {
  const actions = await client.listActions();
  const play = actions.filter((a) => a.category === "play-store");
  const grok = actions.filter((a) => a.category === "grok");
  const ordered = [...play, ...grok];

  const items: SelectItem[] = [];
  if (play.length) {
    items.push({ label: "── Play Store ──", disabled: true });
    for (const a of play) {
      items.push({
        label: a.title,
        description: a.id,
        value: a.id,
      });
    }
  }
  if (grok.length) {
    items.push({ label: "── Grok ──", disabled: true });
    for (const a of grok) {
      items.push({
        label: a.title,
        description: a.id,
        value: a.id,
      });
    }
  }

  // Fallback if categories empty but actions exist
  if (items.filter((x) => !x.disabled).length === 0) {
    for (const a of ordered) {
      items.push({ label: a.title, description: a.id, value: a.id });
    }
  }

  const i = await selectIndex({
    title: "Run test action",
    items,
    cancelable: true,
  });
  if (i === null) return;

  const picked = items[i]!;
  const action = ordered.find((a) => a.id === picked.value) ?? ordered[0];
  if (!action) return;

  if (action.requiresProdMatch && !process.env.PROD_ACCOUNT_MATCH?.trim()) {
    const match = await promptText("PROD_ACCOUNT_MATCH (e.g. gmail.com)");
    if (!match) {
      console.log(theme.error("  PROD_ACCOUNT_MATCH required — aborted.\n"));
      return;
    }
    process.env.PROD_ACCOUNT_MATCH = match;
  }

  console.log(theme.primary(`\n  → Running ${theme.bold(action.id)} on ${serial}`));
  console.log(
    `  ${hint([
      ["ctrl+c", "cancel job"],
      ["esc", "n/a while running"],
    ])}\n`,
  );

  const onSig = () => {
    console.log(theme.error("\n  → cancel (Ctrl+C)…"));
    void client.cancel().catch(() => undefined);
  };
  process.on("SIGINT", onSig);

  let result: { ok: boolean; error?: string; status?: string };
  try {
    result = await client.runAction({
      action: action.id,
      serial,
      onLog: (line) => console.log(theme.muted(`  ${line}`)),
    });
  } finally {
    process.off("SIGINT", onSig);
  }

  if (result.status === "cancelled") {
    console.log(theme.error(`\n  ✕ CANCELLED  ${action.id}\n`));
  } else if (result.ok) {
    console.log(theme.success(`\n  ✓ DONE  ${action.id}\n`));
  } else {
    console.log(theme.error(`\n  ✕ FAIL  ${action.id}: ${result.error ?? "unknown"}\n`));
  }
}

export async function runApp(opts: TuiOptions = {}): Promise<void> {
  const client = await createClient(opts.serverUrl);

  console.log(banner(client.mode));
  statusLine([
    theme.muted(`mode ${client.mode}`),
    client.baseUrl ? theme.muted(client.baseUrl) : theme.muted("in-process"),
    hint([
      ["↑↓", "move"],
      ["enter", "select"],
      ["esc", "back"],
    ]),
  ]);

  let serial = await pickDevice(client, "Connected devices");
  if (!serial) return;
  await client.selectDevice(serial);
  console.log(theme.success(`  ✓ Using ${serial}\n`));

  let lastMenu = 0;

  for (;;) {
    let activeHint = "";
    try {
      const activeId = await client.getActiveJobId();
      if (activeId) activeHint = `job ${activeId.slice(0, 8)}`;
    } catch {
      /* ignore */
    }

    const menu: Array<SelectItem & { id: MenuId }> = [
      { id: "run", label: "Run test action", description: "pick a flow and execute" },
      { id: "snapshot", label: "UI snapshot", description: "inspector tree" },
      { id: "screenshot", label: "Screenshot", description: "save device frame" },
      { id: "history", label: "Job history", description: "recent runs" },
      {
        id: "cancel",
        label: "Cancel active job",
        description: activeHint || "stop running work",
      },
      { id: "pause", label: "Pause active job", description: "cooperative pause" },
      { id: "resume", label: "Resume paused job", description: "continue after pause" },
      { id: "device", label: "Switch device", description: serial },
      { id: "quit", label: "Quit", description: "exit TUI" },
    ];

    const choice = await selectIndex({
      title: `Workspace · ${serial}${activeHint ? ` · ${activeHint}` : ""}`,
      items: menu,
      initial: lastMenu,
      cancelable: true,
    });

    if (choice === null) {
      // Esc on main menu = quit confirm
      const leave = await confirm("Quit Grok Device?", false);
      if (leave) break;
      continue;
    }

    lastMenu = choice;
    const item = menu[choice]!;

    if (item.id === "quit") break;

    if (item.id === "device") {
      const next = await pickDevice(client, "Switch device");
      if (next) {
        serial = next;
        await client.selectDevice(serial);
        console.log(theme.success(`  ✓ Device ${serial}\n`));
      }
      continue;
    }

    if (item.id === "resume") {
      try {
        await client.resume();
        console.log(theme.success("\n  ✓ Resumed active job\n"));
      } catch (err) {
        console.log(theme.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      }
      continue;
    }

    if (item.id === "pause") {
      try {
        await client.pause();
        console.log(theme.warning("\n  ⏸  Paused active job\n"));
      } catch (err) {
        console.log(theme.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      }
      continue;
    }

    if (item.id === "cancel") {
      const ok = await confirm("Cancel the active job?", true);
      if (!ok) continue;
      try {
        await client.cancel();
        console.log(theme.error("\n  ✕ Cancelled active job\n"));
      } catch (err) {
        console.log(theme.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      }
      continue;
    }

    if (item.id === "history") {
      const jobs = await client.listJobs();
      if (jobs.length === 0) {
        console.log(theme.muted("\n  No jobs yet.\n"));
        continue;
      }
      console.log(theme.bold(theme.text("\n  Recent jobs\n")));
      for (const j of jobs.slice(0, 20)) {
        const id = theme.muted(j.id.slice(0, 8));
        const err = j.error ? theme.error(`  ${j.error}`) : "";
        console.log(`  ${colorStatus(j.status.padEnd(10))}  ${j.action.padEnd(24)}  ${id}${err}`);
      }
      console.log("");
      continue;
    }

    if (item.id === "screenshot") {
      try {
        const shot = await client.screenshot(serial);
        console.log(theme.success(`\n  ✓ Screenshot → ${shot.path} (${shot.bytes} bytes)\n`));
      } catch (err) {
        console.log(theme.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      }
      continue;
    }

    if (item.id === "snapshot") {
      try {
        const snap = await client.snapshot(serial);
        console.log(
          theme.muted(`\n  ${snap.nodes.length} nodes · ${snap.interactive.length} interactive\n`),
        );
        console.log(snap.tree || theme.muted("  (empty tree)"));
        console.log("");
      } catch (err) {
        console.log(theme.error(`\n  ${err instanceof Error ? err.message : String(err)}\n`));
      }
      continue;
    }

    if (item.id === "run") {
      await runActionFlow(client, serial);
    }
  }

  console.log(theme.muted("\n  Bye.\n"));
}

export type { DeviceClient };
