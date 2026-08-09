import assert from "node:assert/strict";
import test from "node:test";
import {
  androidInspectionState,
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
    <hierarchy><node index="0" text="" resource-id="root" class="android.widget.FrameLayout" package="ai.x.grok" clickable="false" enabled="true" bounds="[0,0][1080,2400]">
      <node index="0" text="Continue" content-desc="Continue setup" resource-id="app:id/continue" class="android.widget.Button" package="ai.x.grok" clickable="true" enabled="true" focused="false" bounds="[80,1900][1000,2020]" />
    </node></hierarchy>`);

  assert.equal(nodes.length, 2);
  assert.deepEqual(nodes[0]?.rect, { x: 0, y: 0, width: 1080, height: 2400 });
  assert.equal(nodes[1]?.label, "Continue setup");
  assert.equal(nodes[1]?.value, "Continue");
  assert.equal(nodes[1]?.identifier, "app:id/continue");
  assert.equal(nodes[1]?.bundleId, "ai.x.grok");
  assert.equal(nodes[1]?.hittable, true);
  assert.equal(nodes[1]?.parentIndex, 0);
});

test("binds Android snapshots to the app that owns the visible display", () => {
  const output = `topResumedActivity=ActivityRecord{89162151 u0 ai.x.grok/.main.GrokActivity t62670}`;
  assert.equal(parseAndroidForegroundApp(output), "ai.x.grok");

  const grokNodes = [
    { bundleId: "com.android.systemui" },
    { bundleId: "com.touchtype.swiftkey" },
    { bundleId: "ai.x.grok" },
    { bundleId: "ai.x.grok" },
  ];
  assert.equal(androidSnapshotApplication(grokNodes), "ai.x.grok");
  assert.equal(androidSnapshotMatchesForeground(grokNodes, "ai.x.grok"), true);
  assert.equal(androidSnapshotMatchesForeground(grokNodes, "com.Slack"), false);
  assert.equal(androidSnapshotNodesForForeground(grokNodes, "ai.x.grok"), grokNodes);
  assert.deepEqual(androidSnapshotNodesForForeground(grokNodes, "com.Slack"), []);
});

test("reassembles chunked snapshot-helper instrumentation XML", () => {
  const xml =
    '<?xml version=\'1.0\' encoding=\'UTF-8\' standalone=\'yes\' ?><hierarchy rotation="0"><node index="0" text="Ask" package="ai.x.grok" clickable="true" bounds="[0,0][100,80]" /></hierarchy>';
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
  assert.equal(nodes[0]?.bundleId, "ai.x.grok");
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
