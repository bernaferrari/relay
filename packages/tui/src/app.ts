/**
 * Interactive TUI for app testing — keyboard nav, Enter to select.
 */
import { theme, banner, colorStatus, hint } from "./theme.js";
import { selectIndex, confirm, statusLine, type SelectItem } from "./select.js";
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
    console.log(theme.error("\n  No targets found. Connect an Android or iOS device.\n"));
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

async function runTestFlow(client: DeviceClient, serial: string, platform: "android" | "ios") {
  const appMaps = await client.listAppMaps();
  if (!appMaps.length) {
    console.log(theme.muted("\n  No App Maps yet. Create one in the desktop app or CLI.\n"));
    return;
  }
  const mapIndex = await selectIndex({
    title: "Choose App Map",
    items: appMaps.map((map) => ({ label: map.name, description: map.id, value: map.id })),
    cancelable: true,
  });
  if (mapIndex === null) return;
  const appMap = await client.getAppMap(appMaps[mapIndex]!.id);
  const tests = Object.values(appMap.tests);
  if (!tests.length) {
    console.log(theme.muted(`\n  ${appMap.name} has no Tests yet.\n`));
    return;
  }
  const testIndex = await selectIndex({
    title: `Run a Test · ${appMap.name}`,
    items: tests.map((test) => ({
      label: test.name,
      description: test.intent ?? test.id,
      value: test.id,
    })),
    cancelable: true,
  });
  if (testIndex === null) return;
  const test = tests[testIndex]!;

  const combines = Object.values(appMap.combines).filter((combine) =>
    combine.testIds.includes(test.id),
  );
  let worlds: Record<string, string[]> | undefined;
  let lens: "every-screen" | "failures-only" | "final-screen" | "none" | undefined;
  let executionMode: "pilot" | "all" | undefined;
  if (combines.length) {
    const combineIndex = await selectIndex({
      title: `Coverage · ${test.name}`,
      items: [
        { label: "Run Test once", description: "No Variables", value: "once" },
        ...combines.map((combine) => ({
          label: combine.name,
          description: "Saved Variable coverage",
          value: combine.id,
        })),
      ],
      cancelable: true,
    });
    if (combineIndex === null) return;
    const combine = combineIndex > 0 ? combines[combineIndex - 1] : undefined;
    if (combine) {
      worlds = Object.fromEntries(
        combine.variableIds.map((variableId) => {
          const variable = appMap.variables[variableId];
          return [
            variableId,
            combine.selected?.[variableId] ?? variable?.options.map((option) => option.id) ?? [],
          ];
        }),
      );
      const captureMode = combine.captures?.[test.id]?.mode;
      if (
        captureMode === "every-screen" ||
        captureMode === "failures-only" ||
        captureMode === "final-screen" ||
        captureMode === "none"
      ) {
        lens = captureMode;
      }
      const scopeIndex = await selectIndex({
        title: `Run ${combine.name}`,
        items: [
          { label: "Pilot one cell", description: "Fast confidence check", value: "pilot" },
          { label: "Run all selected cells", description: "Complete Combine", value: "all" },
        ],
        cancelable: true,
      });
      if (scopeIndex === null) return;
      executionMode = scopeIndex === 1 ? "all" : "pilot";
    }
  }

  console.log(theme.primary(`\n  → Running ${theme.bold(test.name)} on ${serial}`));
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
    result = await client.runTest({
      appMapId: appMap.id,
      testId: test.id,
      expectedRevision: appMap.revision,
      target: { kind: "device", platform, targetId: serial },
      ...(worlds ? { in: worlds } : {}),
      ...(lens ? { lens } : {}),
      ...(executionMode ? { executionMode } : {}),
      onLog: (line) => console.log(theme.muted(`  ${line}`)),
    });
  } finally {
    process.off("SIGINT", onSig);
  }

  if (result.status === "cancelled") {
    console.log(theme.error(`\n  ✕ CANCELLED  ${test.name}\n`));
  } else if (result.ok) {
    console.log(theme.success(`\n  ✓ DONE  ${test.name}\n`));
  } else {
    console.log(theme.error(`\n  ✕ FAIL  ${test.name}: ${result.error ?? "unknown"}\n`));
  }
}

export async function runApp(opts: TuiOptions = {}): Promise<void> {
  const client = await createClient(opts.serverUrl);

  console.log(banner(client.mode));
  statusLine([
    theme.muted(`mode ${client.mode}`),
    client.baseUrl ? theme.muted(client.baseUrl) : theme.muted("offline"),
    hint([
      ["↑↓", "move"],
      ["enter", "select"],
      ["esc", "back"],
    ]),
  ]);

  let serial = await pickDevice(client, "Connected targets");
  if (!serial) return;
  await client.selectDevice(serial);
  let platform: "android" | "ios" =
    (await client.listDevices()).find((device) => device.serial === serial)?.platform === "ios"
      ? "ios"
      : "android";
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
      { id: "run", label: "Run Test", description: "App Map → Test → evidence" },
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
      const leave = await confirm("Quit Relay?", false);
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
        platform =
          (await client.listDevices()).find((device) => device.serial === serial)?.platform ===
          "ios"
            ? "ios"
            : "android";
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
      await runTestFlow(client, serial, platform);
    }
  }

  console.log(theme.muted("\n  Bye.\n"));
}

export type { DeviceClient };
