import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import {
  IosMutationOutcomeUnknownError,
  resetDeviceClients,
  type Device,
  type SnapshotNode,
} from "./device.js";
import { setLocalDeviceProvider } from "./device-factory.js";
import { extractSwitcherOptionsFromNodes, inferOptionId } from "./variable-option-inference.js";
import {
  getSwitcherProfile,
  listSwitcherProfiles,
  mergeSwitcherOptions,
  saveSwitcherProfile,
  scanSwitcherPicker,
  switcherScanOutcomeUnknownDiagnostic,
} from "./switcher-profiles.js";

const roots: string[] = [];

afterEach(async () => {
  setLocalDeviceProvider(undefined);
  resetDeviceClients();
  delete process.env.RELAY_WORKSPACE_ROOT;
  delete process.env.RELAY_RETRY_ATTEMPTS;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "relay-switcher-"));
  roots.push(root);
  process.env.RELAY_WORKSPACE_ROOT = root;
  return root;
}

type FakeSwitcherDeviceInput = {
  nodes: SnapshotNode[] | (() => SnapshotNode[]);
  commands: string[];
  onPress?: (input: unknown) => Promise<void> | void;
  onPan?: (input: unknown) => Promise<void> | void;
  onScroll?: (input: unknown) => Promise<void> | void;
  onBack?: () => Promise<void> | void;
};

function fakeSwitcherDevice(input: FakeSwitcherDeviceInput): Device {
  const nodes = () => (typeof input.nodes === "function" ? input.nodes() : input.nodes);
  return {
    capture: {
      snapshot: async () => ({ nodes: structuredClone(nodes()) }),
    },
    interactions: {
      press: async (command: unknown) => {
        input.commands.push(`press:${JSON.stringify(command)}`);
        await input.onPress?.(command);
      },
      pan: async (command: unknown) => {
        input.commands.push(`pan:${JSON.stringify(command)}`);
        await input.onPan?.(command);
      },
      scroll: async (command: unknown) => {
        input.commands.push(`scroll:${JSON.stringify(command)}`);
        await input.onScroll?.(command);
      },
    },
    command: {
      wait: async () => undefined,
      back: async () => {
        input.commands.push("back");
        await input.onBack?.();
      },
    },
  } as unknown as Device;
}

function useFakeSwitcherDevice(device: Device): void {
  setLocalDeviceProvider({
    kind: "device",
    create: () => device,
  });
}

function languagePickerNodes(width = 390, height = 844): SnapshotNode[] {
  return [
    {
      index: 0,
      depth: 0,
      type: "Application",
      label: "Settings",
      rect: { x: 0, y: 0, width, height },
    },
    {
      index: 1,
      parentIndex: 0,
      type: "Cell",
      label: "English",
      hittable: true,
      rect: { x: Math.round(width * 0.52), y: 140, width: Math.round(width * 0.42), height: 48 },
    },
    {
      index: 2,
      parentIndex: 0,
      type: "Cell",
      label: "Italiano",
      hittable: true,
      rect: { x: Math.round(width * 0.52), y: 198, width: Math.round(width * 0.42), height: 48 },
    },
    {
      index: 3,
      parentIndex: 0,
      type: "Cell",
      label: "Português (Brasil)",
      hittable: true,
      rect: { x: Math.round(width * 0.52), y: 256, width: Math.round(width * 0.42), height: 48 },
    },
  ];
}

async function unknownScan(input: Parameters<typeof scanSwitcherPicker>[0]) {
  try {
    await scanSwitcherPicker(input);
  } catch (error) {
    assert.ok(error instanceof IosMutationOutcomeUnknownError);
    return error;
  }
  assert.fail("expected an unknown iOS mutation outcome");
}

test("inferOptionId covers language and non-language options", () => {
  assert.equal(inferOptionId("English"), "en");
  assert.equal(inferOptionId("Português (Brasil)", "Portuguese (Brazil)"), "pt-BR");
  assert.equal(inferOptionId("Staging"), "staging");
  assert.equal(inferOptionId("Dark mode", "Dark"), "dark");
  assert.equal(inferOptionId("Production"), "production");
  assert.equal(inferOptionId("العربية", "Arabic"), "ar");
  assert.equal(
    inferOptionId("العربية (المملكة العربية السعودية)", "Arabic (Saudi Arabia)"),
    "ar-SA",
  );
  assert.equal(inferOptionId("Čeština", "Czech"), "cs");
});

test("extractSwitcherOptionsFromNodes is kind-agnostic", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Cell",
      label: "Staging",
      hittable: true,
      visibleToUser: true,
      enabled: true,
      rect: { x: 0, y: 80, width: 400, height: 44 },
    },
    {
      index: 1,
      type: "Cell",
      label: "Production",
      hittable: true,
      visibleToUser: true,
      enabled: true,
      rect: { x: 0, y: 130, width: 400, height: 44 },
    },
    {
      index: 2,
      type: "StaticText",
      label: "Environment",
      visibleToUser: true,
      rect: { x: 0, y: 0, width: 120, height: 20 },
    },
  ];
  const options = extractSwitcherOptionsFromNodes(nodes);
  const ids = options.map((option) => option.id).sort();
  assert.deepEqual(ids, ["production", "staging"]);
  assert.ok(!options.some((option) => option.label === "Environment"));
});

test("grok language seed is a language-kind switcher", async () => {
  await workspace();
  const profile = await getSwitcherProfile("grok-ios");
  assert.ok(profile);
  assert.equal(profile!.kind, "language");
  assert.equal(profile!.id, "grok-ios-language");
  assert.ok(profile!.options.some((option) => option.id === "pt-BR"));
});


test("saveSwitcherProfile persists account-kind profiles", async () => {
  await workspace();
  await saveSwitcherProfile({
    id: "demo-accounts",
    name: "Demo · accounts",
    kind: "account",
    app: "com.example.app",
    entryPath: [{ kind: "tap", target: { label: "Profile" } }],
    pickerPath: [{ kind: "tap", target: { label: "Switch account" } }],
    options: [
      { id: "qa", label: "QA Tester" },
      { id: "admin", label: "Admin" },
    ],
    defaultOptionId: "qa",
    scanned: false,
  });
  const listed = await listSwitcherProfiles({ kind: "account" });
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.options.length, 2);
  const all = await listSwitcherProfiles();
  assert.ok(all.some((profile) => profile.kind === "language"));
  assert.ok(all.some((profile) => profile.kind === "account"));
});

test("extractSwitcherOptionsFromNodes prefers right-pane language cells", () => {
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      depth: 0,
      type: "Application",
      label: "Settings",
      rect: { x: 0, y: 0, width: 1112, height: 834 },
    },
    {
      index: 1,
      depth: 1,
      type: "Cell",
      label: "Airplane Mode",
      rect: { x: 20, y: 100, width: 400, height: 44 },
      parentIndex: 0,
      hittable: true,
    },
    {
      index: 2,
      depth: 1,
      type: "Cell",
      label: "English, Default",
      rect: { x: 600, y: 120, width: 480, height: 52 },
      parentIndex: 0,
      hittable: true,
    },
    {
      index: 3,
      depth: 1,
      type: "Cell",
      label: "Português (Brasil), Portuguese (Brazil)",
      rect: { x: 600, y: 180, width: 480, height: 52 },
      parentIndex: 0,
      hittable: true,
    },
    {
      index: 4,
      depth: 1,
      type: "Cell",
      label: "Italiano, Italian",
      rect: { x: 600, y: 240, width: 480, height: 52 },
      parentIndex: 0,
      hittable: true,
    },
  ];
  const options = extractSwitcherOptionsFromNodes(nodes);
  assert.deepEqual(options.map((option) => option.id).sort(), ["en", "it", "pt-BR"]);
  assert.ok(options.every((option) => !/airplane/i.test(option.label)));
});

test("reads each language row's own gloss and identifier, not a neighbour's", () => {
  // Shape observed on the physical iPad in Settings › Grok › Preferred Language:
  // the cell carries the native name plus an English gloss in `value`, and the
  // accessibility identifier sits on the title label child.
  const row = (index: number, y: number, label: string, gloss: string): SnapshotNode[] => [
    {
      index,
      parentIndex: 0,
      type: "Cell",
      label,
      value: gloss,
      enabled: true,
      rect: { x: 396, y, width: 697, height: 58 },
    },
    {
      index: index + 1,
      parentIndex: index,
      type: "StaticText",
      label,
      identifier: label,
      enabled: true,
      rect: { x: 412, y: y + 9, width: 665, height: 21 },
    },
    {
      index: index + 2,
      parentIndex: index,
      type: "StaticText",
      label: gloss,
      enabled: true,
      rect: { x: 412, y: y + 32, width: 200, height: 15 },
    },
  ];
  const nodes: SnapshotNode[] = [
    {
      index: 0,
      type: "Table",
      label: "SUGGESTED LANGUAGES",
      rect: { x: 376, y: 0, width: 737, height: 834 },
    },
    ...row(1, 184, "Bahasa Melayu", "Malay"),
    ...row(4, 242, "Čeština", "Czech"),
    ...row(7, 300, "Hrvatski", "Croatian"),
    ...row(10, 358, "मराठी", "Marathi"),
  ];
  const options = extractSwitcherOptionsFromNodes(nodes);
  assert.deepEqual(
    options.map((option) => [option.label, option.id, option.identifier]),
    [
      ["Bahasa Melayu", "ms", "Bahasa Melayu"],
      ["Čeština", "cs", "Čeština"],
      ["Hrvatski", "hr", "Hrvatski"],
      ["मराठी", "mr", "मराठी"],
    ],
  );
});

test("mergeSwitcherOptions unions scanned into seed without wipe", () => {
  const merged = mergeSwitcherOptions(
    [
      { id: "en", label: "English" },
      { id: "pt-BR", label: "Português (Brasil)" },
      { id: "it", label: "Italiano" },
    ],
    [{ id: "ja", label: "日本語", identifier: "lang.ja" }],
  );
  assert.deepEqual(merged.map((option) => option.id).sort(), ["en", "it", "ja", "pt-BR"]);
  assert.equal(merged.find((option) => option.id === "ja")?.identifier, "lang.ja");
});

test("stops an unknown iOS label press before the text fallback and retains a repair package", async () => {
  const commands: string[] = [];
  useFakeSwitcherDevice(
    fakeSwitcherDevice({
      commands,
      nodes: [
        {
          index: 0,
          type: "Cell",
          label: "Open picker",
          hittable: true,
          rect: { x: 0, y: 100, width: 390, height: 48 },
        },
      ],
      onPress: () => {
        throw new Error("XCTest connection lost after dispatch");
      },
    }),
  );

  const error = await unknownScan({
    serial: "switcher-unknown-label",
    app: "com.example.switcher",
    kind: "language",
    platform: "ios",
    openApp: false,
    save: false,
    entryPath: [{ kind: "tap", target: { label: "Open picker" } }],
    pickerPath: [{ kind: "wait", ms: 1 }],
  });

  assert.equal(commands.length, 1);
  assert.match(commands[0]!, /selector.*label=\\"Open picker\\"/);
  assert.doesNotMatch(commands[0]!, /label\*=/);
  const diagnostic = switcherScanOutcomeUnknownDiagnostic(error);
  assert.deepEqual(diagnostic?.repair, {
    terminal: true,
    nextAction: "capture-current-screen-before-any-retry",
    blocked: ["fallback-target", "retry-launch", "path-step", "next-scan-page", "second-scan-pass"],
  });
  assert.equal(diagnostic?.phase, "entry-path");
  assert.equal(diagnostic?.picker.proven, false);
});

test("stops an unknown iOS Back before the next switcher path step", async () => {
  const commands: string[] = [];
  useFakeSwitcherDevice(
    fakeSwitcherDevice({
      commands,
      nodes: [],
      onBack: () => {
        throw new Error("XCTest connection lost after dispatch");
      },
    }),
  );

  const error = await unknownScan({
    serial: "switcher-unknown-back",
    app: "com.example.switcher",
    kind: "language",
    platform: "ios",
    openApp: false,
    save: false,
    entryPath: [
      { kind: "back" },
      { kind: "tap", target: { label: "must not run after unknown Back" } },
    ],
    pickerPath: [{ kind: "wait", ms: 1 }],
  });

  assert.deepEqual(commands, ["back"]);
  assert.equal(switcherScanOutcomeUnknownDiagnostic(error)?.phase, "entry-path");
});

test("stops an unknown wide-pane swipe before generic scroll recovery and retains picker rows", async () => {
  const commands: string[] = [];
  useFakeSwitcherDevice(
    fakeSwitcherDevice({
      commands,
      nodes: languagePickerNodes(1112, 834),
      onPan: () => {
        throw new Error("XCTest connection lost after dispatch");
      },
    }),
  );

  const error = await unknownScan({
    serial: "switcher-unknown-wide-swipe",
    app: "com.example.switcher",
    kind: "language",
    platform: "ios",
    openApp: false,
    save: false,
    maxScrolls: 1,
    entryPath: [{ kind: "wait", ms: 1 }],
    pickerPath: [{ kind: "wait", ms: 1 }],
  });

  assert.equal(commands.length, 1);
  assert.match(commands[0]!, /^pan:/);
  assert.ok(!commands.some((command) => command.startsWith("scroll:")));
  const diagnostic = switcherScanOutcomeUnknownDiagnostic(error);
  assert.equal(diagnostic?.phase, "scan");
  assert.equal(diagnostic?.scanPass, 1);
  assert.equal(diagnostic?.picker.proven, true);
  assert.deepEqual(diagnostic?.picker.partialRows.map((row) => row.id).sort(), [
    "en",
    "it",
    "pt-BR",
  ]);
  assert.equal(diagnostic?.picker.scrollsCompleted, 0);
});

test("does not launch a second scan pass after an unknown first-pass iOS scroll", async () => {
  const commands: string[] = [];
  useFakeSwitcherDevice(
    fakeSwitcherDevice({
      commands,
      nodes: languagePickerNodes(),
      onPan: () => {
        throw new Error("XCTest connection lost after dispatch");
      },
    }),
  );

  const error = await unknownScan({
    serial: "switcher-unknown-first-pass",
    app: "com.example.switcher",
    kind: "language",
    platform: "ios",
    openApp: false,
    save: false,
    maxScrolls: 1,
    entryPath: [{ kind: "wait", ms: 1 }],
    pickerPath: [{ kind: "wait", ms: 1 }],
  });

  assert.deepEqual(
    commands.map((command) => command.split(":", 1)[0]),
    ["pan"],
  );
  const diagnostic = switcherScanOutcomeUnknownDiagnostic(error);
  assert.equal(diagnostic?.scanPass, 1);
  assert.ok(diagnostic?.repair.blocked.includes("second-scan-pass"));
});

test("keeps selector-miss recovery available when the initial iOS press was not dispatched", async () => {
  const commands: string[] = [];
  let presses = 0;
  const nodes = [
    {
      index: 4,
      type: "Cell",
      label: "Open picker",
      hittable: true,
      rect: { x: 0, y: 80, width: 390, height: 48 },
    },
    ...languagePickerNodes(),
  ];
  useFakeSwitcherDevice(
    fakeSwitcherDevice({
      commands,
      nodes,
      onPress: () => {
        presses += 1;
        if (presses === 1) throw new Error("No matching element");
      },
    }),
  );

  const result = await scanSwitcherPicker({
    serial: "switcher-selector-miss",
    app: "com.example.switcher",
    kind: "language",
    platform: "ios",
    openApp: false,
    save: false,
    maxScrolls: 1,
    entryPath: [{ kind: "tap", target: { label: "Open picker" } }],
    pickerPath: [{ kind: "wait", ms: 1 }],
  });

  assert.equal(result.optionsFound, 4);
  assert.equal(presses, 2);
  assert.match(commands[0]!, /selector/);
  assert.match(commands[0]!, /Open picker/);
  assert.ok(commands[1]?.includes('"x":195'));
});
