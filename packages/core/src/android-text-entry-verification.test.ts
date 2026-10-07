import assert from "node:assert/strict";
import test from "node:test";
import {
  exactAndroidTextInsertion,
  verifyAndroidTextEntry,
} from "./android-text-entry-verification.js";
import { NativeTextEntryVerificationError } from "./input-not-dispatched.js";
import { runCampaignCheck } from "./recipe-runner-campaign-checks.js";
import { runRecipeStep } from "./recipe-runner.js";
import type { RecipeStepContext } from "./recipe-runner-context.js";
import { typeDeviceText } from "./device-android-text.js";
import type { Device, SnapshotNode } from "./device-capabilities.js";
import { runWithTargetContext } from "./target-context.js";

const requested = "Relay QA FAST_B: Reply with exactly RELAY_FAST_B_OK and no other text.";
const corrupted = "Relay QA FAST_B: Reply with exactly RELAY_FAST_A_OK and no other text. ";

function fixture(transform: (text: string) => string, initial = "") {
  let value = initial;
  let typed = 0;
  const shellPayloads: string[] = [];
  const nodes = (): SnapshotNode[] => [
    {
      identifier: "chat_text_input",
      bundleId: "ai.x.grok",
      editable: true,
      focused: true,
      value,
    },
  ];
  const device = {
    command: {
      clipboard: async () => {
        throw new Error("Android clipboard is unsupported");
      },
    },
    interactions: {
      type: async ({ text }: { text: string }) => {
        typed++;
        value = transform(text);
      },
    },
  } as unknown as Device;
  const dependencies = {
    snapshot: async () => nodes(),
    mutateCurrentTarget: async <T>(operation: () => Promise<T>) => operation(),
    typeViaLiveIosListener: async () => false,
    execAndroidAdb: async (args: string[]) => {
      if (args[4] === "text") {
        typed++;
        shellPayloads.push(args[5]!);
        value = transform(args[5]!.replaceAll("%s", " "));
      }
      return { stdout: "", stderr: "" };
    },
  };
  return { device, dependencies, shellPayloads, typed: () => typed, value: () => value };
}

test("the actual Android shell fallback rejects the observed B-to-A corruption before a following Send", async () => {
  const input = fixture(() => corrupted);
  let sent = false;
  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "text-integrity-fixture" },
      async () => {
        await typeDeviceText(input.device, requested, input.dependencies);
        sent = true;
      },
    ),
    /text entry.*(?:mismatch|match|requested)/i,
  );
  assert.equal(input.value(), corrupted);
  assert.equal(input.typed(), 1, "a failed readback never repeats native typing");
  assert.equal(sent, false);
});

test("the canonical Android fallback dispatches one complete ASCII payload and accepts exact readback", async () => {
  const input = fixture((text) => text);
  await runWithTargetContext(
    { kind: "device", platform: "android", serial: "text-integrity-fixture" },
    () => typeDeviceText(input.device, requested, input.dependencies),
  );
  assert.equal(input.typed(), 1);
  assert.deepEqual(input.shellPayloads, [requested.replaceAll(" ", "%s")]);
  assert.equal(input.value(), requested);
});

test("pixel-only text entry remains available with an honest unverified receipt", async () => {
  const input = fixture((text) => text);
  input.dependencies.snapshot = async () => [];
  const receipt = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "text-pixels-fixture" },
    () => typeDeviceText(input.device, requested, input.dependencies),
  );
  assert.equal(input.typed(), 1);
  assert.equal(receipt?.verification, "unverified");
  assert.equal(receipt?.reason, "focused-field-unavailable");
});

test("exact insertion preserves existing text, casing and whitespace", () => {
  assert.equal(exactAndroidTextInsertion("before after", "new ", "before new after"), true);
  assert.equal(exactAndroidTextInsertion("", requested, corrupted), false);
  assert.equal(exactAndroidTextInsertion("old", "NEW", "oldNew"), false);
  assert.equal(exactAndroidTextInsertion("old", "", "old"), true);
});

test("a known field changing owner or identity is terminal without polling for another target", async () => {
  let reads = 0;
  await assert.rejects(
    verifyAndroidTextEntry({
      before: {
        bundleId: "ai.x.grok",
        identifier: "chat_text_input",
        focused: true,
        editable: true,
        value: "",
      },
      text: requested,
      transport: "adb-shell",
      sleep: async () => {},
      snapshot: async () => {
        reads++;
        return [
          {
            bundleId: "other.app",
            identifier: "chat_text_input",
            focused: true,
            editable: true,
            value: requested,
          },
        ];
      },
    }),
    (error: unknown) => {
      assert.ok(error instanceof NativeTextEntryVerificationError);
      assert.equal(error.textEntry?.reason, "focused-field-changed");
      return true;
    },
  );
  assert.equal(reads, 1);
});

test("a paste acknowledgement failure never falls back to another native type", async () => {
  const input = fixture((text) => text);
  (
    input.device as unknown as {
      command: { clipboard: (request: { action: string; text?: string }) => Promise<unknown> };
    }
  ).command.clipboard = async (request: { action: string; text?: string }) =>
    request.action === "read" ? { action: "read", text: "existing" } : { action: "write" };
  let pasteAttempts = 0;
  input.dependencies.execAndroidAdb = async () => {
    pasteAttempts++;
    throw new Error("Android clipboard paste failed after dispatch");
  };
  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "text-paste-fixture" },
      () => typeDeviceText(input.device, requested, input.dependencies),
    ),
    /Input outcome unknown/,
  );
  assert.equal(pasteAttempts, 1);
  assert.equal(input.typed(), 0);
});

test("observed text corruption escapes a campaign and prevents cleanup or the next Send", async () => {
  const input = fixture(() => corrupted);
  const executions: string[] = [];
  const ctx: RecipeStepContext = { log: () => {}, runtime: {} };
  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "text-campaign-fixture" },
      () =>
        runCampaignCheck(
          input.device,
          {
            kind: "sleep",
            ms: 1,
            check: {
              id: "prompt",
              title: "Send the requested prompt",
              cleanup: { recipeId: "cleanup", terminalScreenId: "home", onCancel: "skip" },
            },
          },
          ctx,
          async (recipeId) => {
            executions.push(recipeId ?? "primary");
            await typeDeviceText(input.device, requested, input.dependencies);
            executions.push("Send");
          },
        ),
    ),
    NativeTextEntryVerificationError,
  );
  assert.deepEqual(executions, ["primary"]);
  assert.equal(input.typed(), 1);
});

test("an optional recipe step cannot swallow a native text verification error", async () => {
  const failure = new NativeTextEntryVerificationError("observed text mismatch");
  const device = {
    command: { wait: async () => ({}) },
    interactions: {
      press: async () => {
        throw failure;
      },
    },
    capture: {
      snapshot: async () => ({
        nodes: [{ identifier: "Send", label: "Send", rect: { x: 0, y: 0, width: 10, height: 10 } }],
      }),
    },
  } as unknown as Device;
  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "text-optional-fixture" },
      () =>
        runRecipeStep(
          device,
          {
            kind: "tap",
            target: { point: { x: 5, y: 5 } },
            fallbackTargets: [{ point: { x: 10, y: 10 } }],
            optional: true,
          },
          { log: () => {} },
        ),
    ),
    failure,
  );
});

test("multiline shell fallback rejects before any input or Enter can submit", async () => {
  const input = fixture((text) => text);
  let nativeAttempts = 0;
  input.dependencies.execAndroidAdb = async () => {
    nativeAttempts++;
    return { stdout: "", stderr: "" };
  };
  await assert.rejects(
    runWithTargetContext(
      { kind: "device", platform: "android", serial: "text-newline-fixture" },
      () => typeDeviceText(input.device, "first\nsecond", input.dependencies),
    ),
    /one bounded ASCII line/,
  );
  assert.equal(nativeAttempts, 0);
  assert.equal(input.typed(), 0);
});

test("the observed normal prompt accepts one IME trailing ASCII blank with a normalized receipt", async () => {
  const normal = "Explain how a paper airplane flies in three short, clear sentences.";
  const input = fixture((text) => text + " ");
  const receipt = await runWithTargetContext(
    { kind: "device", platform: "android", serial: "text-normal-prompt-fixture" },
    () => typeDeviceText(input.device, normal, input.dependencies),
  );
  assert.equal(input.value(), normal + " ");
  assert.equal(input.typed(), 1);
  assert.equal(receipt?.verification, "normalized");
  assert.equal(receipt?.normalization, "ime-trailing-space");
});

test("trailing-blank normalization never applies to requested whitespace, multiple blanks or clipboard entry", async () => {
  const before = {
    bundleId: "ai.x.grok",
    identifier: "chat_text_input",
    focused: true,
    editable: true,
    value: "",
  };
  for (const example of [
    { text: "normal ", after: "normal  ", transport: "adb-shell" as const },
    { text: "normal", after: "normal  ", transport: "adb-shell" as const },
    { text: "normal", after: "normal ", transport: "clipboard" as const },
    { text: "two words", after: "two  words ", transport: "adb-shell" as const },
  ]) {
    await assert.rejects(
      verifyAndroidTextEntry({
        before,
        text: example.text,
        transport: example.transport,
        sleep: async () => {},
        snapshot: async () => [{ ...before, value: example.after }],
      }),
      NativeTextEntryVerificationError,
    );
  }
});
