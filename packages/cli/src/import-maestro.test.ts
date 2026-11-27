import assert from "node:assert/strict";
import test from "node:test";
import { parseTestYaml } from "@relay/core";
import { convertMaestroFlow } from "./import-maestro.js";

function yamlSteps(parsed: ReturnType<typeof parseTestYaml>) {
  return (parsed.steps ?? []).map((step) =>
    typeof step === "string"
      ? step
      : step.kind === "validation"
        ? { check: step.intent }
        : step.intent,
  );
}

function convert(source: string, overrides?: Record<string, string>) {
  return convertMaestroFlow({
    source,
    sourceName: "flows/checkout.yaml",
    fileName: "checkout.yaml",
    ...(overrides ? { overrides } : {}),
  });
}

test("Maestro conversion covers common actions, checks, and warning comments", () => {
  const result = convert(`appId: com.example.shop
name: Checkout flow
---
- launchApp
- tapOn: Checkout
- tapOn:
    id: email-input
    repeat: 2
    waitToSettleTimeoutMs: 500
- longPressOn: Help
- inputText: me@example.com
- assertVisible: Order total
- assertVisible:
    text: Pay now
    enabled: true
    checked: false
- assertNotVisible:
    id: spinner
- swipe:
    direction: UP
- scroll
- back
- pressKey: Home
- hideKeyboard
- eraseText
- openLink: https://shop.example/help
- waitForAnimationToEnd
- runScript: echo hi
`);
  const parsed = parseTestYaml(result.yaml);
  assert.equal(parsed.name, "Checkout flow");
  assert.equal(parsed.app, "com.example.shop");
  assert.deepEqual(yamlSteps(parsed), [
    'Tap "Checkout"',
    "Tap the control with identifier email-input 2 times",
    'Long press "Help"',
    'Type "me@example.com"',
    { check: "Order total is visible" },
    { check: "Pay now is visible and is enabled and is not checked" },
    { check: "The control with identifier spinner is not visible" },
    "Swipe up",
    "Swipe up to see more content",
    "Go back",
    "Press Home",
    "Hide the keyboard",
    "Clear the current text field",
    "Open https://shop.example/help",
  ]);
  assert.match(result.yaml, /^# Imported from Maestro flow/u);
  assert.match(result.yaml, /# - step 16: skipped waitForAnimationToEnd/u);
  assert.match(result.yaml, /# - step 17: skipped runScript/u);
  assert.match(result.yaml, /timing and retry detail is not represented/u);
  assert.equal(result.stepCount, 14);
  assert.equal(result.outputFileName, "checkout.yaml");
});

test("Maestro single-document commands form, environment values, and repeat flattening", () => {
  const result = convert(`appId: com.example.shop
commands:
  - tapOn: "Sign in"
  - inputText: "\${EMAIL}"
  - repeat:
      times: 2
      commands:
        - tapOn: Next
        - assertVisible: Done
`);
  const parsed = parseTestYaml(result.yaml);
  assert.deepEqual(yamlSteps(parsed), [
    'Tap "Sign in"',
    'Type "{{EMAIL}}"',
    'Tap "Next"',
    { check: "Done is visible" },
    'Tap "Next"',
    { check: "Done is visible" },
  ]);
  assert.ok(
    result.warnings.some((warning) => warning.includes("environment values were rewritten")),
  );
});

test("Maestro conditional repeat becomes one explicit plain-English instruction", () => {
  const result = convert(`appId: com.example.shop
---
- repeat:
    while:
      visible: Load more
    commands:
      - swipe:
          direction: DOWN
      - tapOn: Load more
`);
  const parsed = parseTestYaml(result.yaml);
  assert.equal(yamlSteps(parsed).length, 1);
  assert.match(String(yamlSteps(parsed)[0]), /^Repeat these steps while Load more is visible:/u);
  assert.match(String(yamlSteps(parsed)[0]), /Swipe down; Tap "Load more"/u);
  assert.ok(result.warnings.some((warning) => warning.includes("review the repetition")));
});

test("Maestro url and overrides choose the Relay target", () => {
  const web = convert(`url: https://shop.example
---
- tapOn: Checkout
`);
  assert.equal(parseTestYaml(web.yaml).url, "https://shop.example");
  const overridden = convert(
    `appId: com.example.shop
---
- tapOn: Checkout
`,
    { app: "Shop", name: "Imported checkout" },
  );
  const parsed = parseTestYaml(overridden.yaml);
  assert.equal(parsed.app, "Shop");
  assert.equal(parsed.name, "Imported checkout");
  assert.ok(!overridden.warnings.some((warning) => warning.includes("appId")));
});

test("Maestro invalid YAML and targetless flows are usage errors", () => {
  assert.throws(() => convert("not: [valid"), /invalid YAML/u);
  assert.throws(() => convert(`---\n- tapOn: Checkout\n`), /no target was found/u);
  assert.throws(
    () => convert(`appId: com.example\n---\n- runScript: echo hi\n`),
    /produced no steps/u,
  );
});

test("Maestro exact output is stable YAML with warning comments", () => {
  const result = convert(`appId: com.example.shop
---
- tapOn: Checkout
- assertVisible: Total
- runScript: echo hi
`);
  assert.equal(
    result.yaml,
    `# Imported from Maestro flow flows/checkout.yaml. Review the plain-English steps before running.
# Warnings:
# - step 3: skipped runScript; scripts are not represented in Relay test files
# - appId com.example.shop was copied to app; confirm that a Relay App uses that name or id
name: Checkout
app: com.example.shop
steps:
  - Tap "Checkout"
  - check: Total is visible
`,
  );
});

test("Maestro inline runFlow commands are inlined and file flows are explicit warnings", () => {
  const result = convert(`appId: com.example.shop
---
- runFlow:
    commands:
      - tapOn: Sign in
      - inputText: me@example.com
- runFlow: Login.yaml
`);
  assert.deepEqual(yamlSteps(parseTestYaml(result.yaml)), [
    'Tap "Sign in"',
    'Type "me@example.com"',
  ]);
  assert.ok(result.warnings.some((warning) => warning.includes("separate flow files")));
});
