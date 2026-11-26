import assert from "node:assert/strict";
import test from "node:test";
import { defaultComposer } from "../device/device-prompt.js";
import { androidTextEntryField } from "./android-text-entry-verification.js";
import {
  androidInspectionState,
  androidOptionalTreeDegradationLabel,
  androidScreenIsInspectable,
  androidSnapshotApplication,
  androidSnapshotCapturePlan,
  androidSnapshotMatchesForeground,
  androidSnapshotNodesForForeground,
  androidUiAutomatorDumpLooksEmpty,
  androidUiAutomatorDumpLooksKilled,
  parseAndroidForegroundApp,
  parseAndroidSnapshotHelperInstrumentation,
  parseAndroidUiSnapshot,
} from "./android-ui-snapshot.js";

test("parses Android UI dump into semantic, nested Relay nodes", () => {
  const nodes = parseAndroidUiSnapshot(`<?xml version="1.0"?>
    <hierarchy><node index="0" text="" resource-id="root" class="android.widget.FrameLayout" package="dev.relay.fixture" clickable="false" enabled="true" bounds="[0,0][1080,2400]">
      <node index="0" text="Continue" content-desc="Continue setup" resource-id="app:id/continue" class="android.widget.Button" package="dev.relay.fixture" clickable="true" enabled="true" focused="false" bounds="[80,1900][1000,2020]" />
    </node></hierarchy>`);

  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes[0]?.rect, { x: 0, y: 0, width: 1080, height: 2400 });
  assert.equal(nodes[1]?.label, "Continue setup");
  assert.equal(nodes[1]?.description, "Continue setup");
  assert.equal(nodes[1]?.value, "Continue");
  assert.equal(nodes[1]?.identifier, "app:id/continue");
  assert.equal(nodes[1]?.bundleId, "dev.relay.fixture");
  assert.equal(nodes[1]?.hittable, true);
  assert.equal(nodes[1]?.parentIndex, 0);
});

test("prefers the focused window to an activity behind it", () => {
  const output = [
    "topResumedActivity=ActivityRecord{89162151 u0 com.example.primary/.MainActivity t62670}",
    "  Display: mDisplayId=2",
    "  mCurrentFocus=Window{912bff u0 com.example.external/.ExternalActivity}",
    "  Display: mDisplayId=0 (organized)",
    "  mCurrentFocus=Window{91ffef u0 com.example.floating/.FloatingActivity}",
  ].join("\n");
  assert.equal(parseAndroidForegroundApp(output), "com.example.floating");
  assert.equal(parseAndroidForegroundApp(output.replace(/Window\{91ffef.*/u, "null")), undefined);
  assert.equal(
    parseAndroidForegroundApp(output.replace("com.example.floating", "com.android.systemui")),
    undefined,
  );
});

test("a blank editable composer in a second window remains actionable", () => {
  const nodes = parseAndroidUiSnapshot(`<hierarchy>
    <node package="dev.relay.fixture" window-index="0" visible-to-user="false">
      <node package="dev.relay.fixture" resource-id="dev.relay.fixture:id/search" editable="true"
        focused="true" text="background" bounds="[0,100][800,200]" />
    </node>
    <node package="dev.relay.fixture" window-index="1" window-focused="true">
      <node package="dev.relay.fixture" resource-id="dev.relay.fixture:id/composer" class="android.view.View"
        editable="true" focusable="true" focused="true" hint-showing="true"
        text="Write a message" bounds="[0,1000][800,1080]" />
      <node package="dev.relay.fixture" text="Send" clickable="true" bounds="[805,1000][880,1080]" />
    </node>
  </hierarchy>`);
  assert.deepEqual(defaultComposer(nodes), { identifier: "dev.relay.fixture:id/composer" });
  assert.equal(androidTextEntryField(nodes)?.value, "");
  assert.equal(nodes.find(({ label }) => label === "Send")?.parentIndex, 2);
});

test("editable values preserve whitespace and omit password readback", () => {
  const [input, password] = parseAndroidUiSnapshot(`<hierarchy>
    <node class="android.widget.EditText" text="  exact  " />
    <node class="android.widget.EditText" text="private" password="true" />
  </hierarchy>`);
  assert.equal(input?.editable, true);
  assert.equal(input?.value, "  exact  ");
  assert.equal(password?.value, undefined);
  assert.notEqual(password?.label, "private");
});

test("binds Android snapshots to the app that owns the visible display", () => {
  const appNodes = [
    { bundleId: "com.android.systemui" },
    { bundleId: "com.touchtype.swiftkey" },
    ...Array.from({ length: 5 }, () => ({ bundleId: "com.example.other", visibleToUser: false })),
    { bundleId: "dev.relay.fixture" },
    { bundleId: "dev.relay.fixture" },
  ];
  assert.equal(androidSnapshotApplication(appNodes), "dev.relay.fixture");
  assert.equal(androidSnapshotMatchesForeground(appNodes, "dev.relay.fixture"), true);
  assert.equal(androidSnapshotMatchesForeground(appNodes, "com.example.other"), false);
  assert.equal(androidSnapshotNodesForForeground(appNodes, "dev.relay.fixture"), appNodes);
  assert.deepEqual(androidSnapshotNodesForForeground(appNodes, "com.example.other"), []);
});

test("reassembles chunked snapshot-helper instrumentation XML", () => {
  const xml =
    '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?><hierarchy rotation="0"><node index="0" text="Ask" package="dev.relay.fixture" clickable="true" bounds="[0,0][100,80]" /></hierarchy>';
  const bytes = Buffer.from(xml, "utf8");
  const mid = Math.ceil(bytes.length / 2);
  const output = [
    "INSTRUMENTATION_STATUS: agentDeviceProtocol=android-snapshot-helper-v1",
    "INSTRUMENTATION_STATUS: chunkCount=2",
    "INSTRUMENTATION_STATUS: chunkIndex=0",
    "INSTRUMENTATION_STATUS: outputFormat=uiautomator-xml",
    `INSTRUMENTATION_STATUS: payloadBase64=${bytes.subarray(0, mid).toString("base64")}`,
    "INSTRUMENTATION_STATUS_CODE: 1",
    "INSTRUMENTATION_STATUS: agentDeviceProtocol=android-snapshot-helper-v1",
    "INSTRUMENTATION_STATUS: chunkCount=2",
    "INSTRUMENTATION_STATUS: chunkIndex=1",
    "INSTRUMENTATION_STATUS: outputFormat=uiautomator-xml",
    `INSTRUMENTATION_STATUS: payloadBase64=${bytes.subarray(mid).toString("base64")}`,
    "INSTRUMENTATION_STATUS_CODE: 1",
    "INSTRUMENTATION_RESULT: agentDeviceProtocol=android-snapshot-helper-v1",
    "INSTRUMENTATION_RESULT: ok=true",
    "INSTRUMENTATION_RESULT: nodeCount=1",
    "INSTRUMENTATION_CODE: 0",
  ].join("\n");

  const decoded = parseAndroidSnapshotHelperInstrumentation(output);
  assert.equal(decoded, xml);
  const nodes = parseAndroidUiSnapshot(decoded!);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.value, "Ask");
  assert.equal(nodes[0]?.bundleId, "dev.relay.fixture");
});

test("ignores incomplete snapshot-helper instrumentation", () => {
  assert.equal(
    parseAndroidSnapshotHelperInstrumentation(
      "INSTRUMENTATION_RESULT: ok=false\nINSTRUMENTATION_CODE: 0",
    ),
    undefined,
  );
  assert.equal(
    parseAndroidSnapshotHelperInstrumentation(
      "INSTRUMENTATION_STATUS: agentDeviceProtocol=android-snapshot-helper-v1\nINSTRUMENTATION_STATUS: chunkCount=2\nINSTRUMENTATION_STATUS: chunkIndex=0\nINSTRUMENTATION_STATUS: outputFormat=uiautomator-xml\nINSTRUMENTATION_STATUS: payloadBase64=PGg+\nINSTRUMENTATION_STATUS_CODE: 1\nINSTRUMENTATION_RESULT: ok=true\nINSTRUMENTATION_CODE: 0",
    ),
    undefined,
  );
});

test("never competes with a live helper for the only UiAutomation slot", () => {
  assert.deepEqual(
    androidSnapshotCapturePlan({
      helperProcessRunning: true,
      helperAvailable: true,
      dumpBlocked: false,
    }),
    [],
  );
  assert.deepEqual(
    androidSnapshotCapturePlan({
      helperProcessRunning: true,
      helperAvailable: false,
      dumpBlocked: true,
    }),
    [],
  );
  assert.deepEqual(
    androidSnapshotCapturePlan({
      helperProcessRunning: false,
      helperAvailable: true,
      dumpBlocked: false,
    }),
    ["helper", "dump"],
  );
  assert.deepEqual(
    androidSnapshotCapturePlan({
      helperProcessRunning: false,
      helperAvailable: true,
      dumpBlocked: true,
    }),
    ["helper"],
  );
  assert.deepEqual(
    androidSnapshotCapturePlan({
      helperProcessRunning: false,
      helperAvailable: false,
      dumpBlocked: false,
    }),
    ["dump"],
  );
  assert.deepEqual(
    androidSnapshotCapturePlan({
      helperProcessRunning: false,
      helperAvailable: false,
      dumpBlocked: true,
    }),
    ["dump"],
  );
});

test("recognizes dump death from a taken UiAutomation slot", () => {
  assert.equal(
    androidUiAutomatorDumpLooksKilled(
      "java.lang.IllegalStateException: UiAutomationService already registered!",
    ),
    true,
  );
  assert.equal(androidUiAutomatorDumpLooksKilled("Killed\n"), true);
  assert.equal(androidUiAutomatorDumpLooksKilled("Command failed: exit 137"), true);
  assert.equal(
    androidUiAutomatorDumpLooksEmpty("ERROR: null root node returned by UiTestAutomationBridge."),
    true,
  );
  assert.equal(
    androidUiAutomatorDumpLooksEmpty("UI hierchary dumped to: /data/local/tmp/relay-uidump.xml"),
    false,
  );
  assert.equal(
    androidUiAutomatorDumpLooksKilled(
      '<?xml version="1.0"?><hierarchy><node text="Ask 137" /></hierarchy>',
    ),
    false,
  );
});

test("does not inspect a keyguard or sleeping screen", () => {
  assert.equal(
    androidScreenIsInspectable(`
      KeyguardServiceDelegate
        showing=true
      screenState=SCREEN_STATE_OFF
      interactiveState=INTERACTIVE_STATE_SLEEP
    `),
    false,
  );
  assert.equal(
    androidInspectionState(
      "showing=true\nscreenState=SCREEN_STATE_ON\ninteractiveState=INTERACTIVE_STATE_AWAKE",
    ),
    "keyguard",
  );
  assert.equal(
    androidInspectionState(
      "screenState=SCREEN_STATE_OFF\ninteractiveState=INTERACTIVE_STATE_SLEEP",
    ),
    "asleep",
  );
  assert.equal(
    androidScreenIsInspectable(
      "screenState=SCREEN_STATE_ON\ninteractiveState=INTERACTIVE_STATE_AWAKE",
    ),
    true,
  );
});

test("optional-tree degradation stays labeled helper vs dump and never dumps while helper is alive", () => {
  assert.deepEqual(
    androidSnapshotCapturePlan({
      helperProcessRunning: true,
      helperAvailable: true,
      dumpBlocked: false,
    }),
    [],
  );
  assert.equal(
    androidSnapshotCapturePlan({
      helperProcessRunning: true,
      helperAvailable: true,
      dumpBlocked: false,
    }).includes("dump"),
    false,
  );
  assert.equal(
    androidOptionalTreeDegradationLabel({ treeBackend: "helper", inspectable: true }),
    "android-helper",
  );
  assert.equal(
    androidOptionalTreeDegradationLabel({ treeBackend: "dump", inspectable: true }),
    "android-dump",
  );
  assert.match(
    androidOptionalTreeDegradationLabel({ treeBackend: "helper", inspectable: false }),
    /helper UiAutomation/u,
  );
  assert.match(
    androidOptionalTreeDegradationLabel({ treeBackend: "dump", inspectable: false }),
    /uiautomator dump/u,
  );
});
