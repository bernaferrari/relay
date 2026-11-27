import test from "node:test";
import assert from "node:assert/strict";
import type { Device } from "../device/device.js";
import type { RecipeStep } from "@relay/protocol";
import { redactPrivateValue } from "../input/private-inputs.js";
import { runWithTargetContext } from "../target/target-context.js";
import type { TestJob } from "../session/session-contract.js";
import {
  SIGN_IN_PASSWORD_REFERENCE,
  SIGN_IN_USERNAME_REFERENCE,
} from "../sign-in/secret-references.js";
import { runTypeStep } from "./recipe-runner-extended-steps.js";
import {
  registerActDecider,
  runActStep,
  type ActDecision,
  type ActObservation,
} from "./recipe-runner-act.js";

const usernameCanary = "signin-user-canary@example.test";
const passwordCanary = "signin-password-canary-value";

function fakeDevice(calls: { fill: string[]; type: string[]; press: unknown[] }): Device {
  return {
    interactions: {
      fill: async (input: { text?: string }) => {
        calls.fill.push(String(input.text ?? ""));
        return {};
      },
      type: async (input: { text?: string }) => {
        calls.type.push(String(input.text ?? ""));
        return {};
      },
      press: async (input: unknown) => {
        calls.press.push(input);
        return {};
      },
      find: async () => ({}),
    },
    command: { wait: async () => ({}) },
    capture: { snapshot: async () => ({ nodes: [] }) },
  } as unknown as Device;
}

function signInScreen(): ActObservation {
  return {
    candidates: [
      {
        id: "c1",
        identifier: "username",
        label: "Email",
        editable: true,
        target: { identifier: "username", label: "Email" },
      },
      {
        id: "c2",
        identifier: "password",
        label: "Password",
        editable: true,
        target: { identifier: "password", label: "Password" },
      },
      {
        id: "c3",
        label: "Sign in",
        target: { label: "Sign in", point: { x: 10, y: 10 } },
      },
    ],
    screenshot: { mimeType: "image/png", data: "c2hvdWxkLW5vdC1iZS1zZW50" },
  };
}

test("sign-in act types plaintext only at the device boundary and artifacts keep references", async (t) => {
  process.env.RELAY_SIGN_IN_MEMBER_USERNAME = usernameCanary;
  process.env.RELAY_SIGN_IN_MEMBER_PASSWORD = passwordCanary;
  t.after(() => {
    delete process.env.RELAY_SIGN_IN_MEMBER_USERNAME;
    delete process.env.RELAY_SIGN_IN_MEMBER_PASSWORD;
  });
  const prompts: string[] = [];
  const screenshots: unknown[] = [];
  const decisions: ActDecision[] = [
    { action: "type", text: SIGN_IN_USERNAME_REFERENCE, candidateId: "c1", reason: "email field" },
    {
      action: "type",
      text: SIGN_IN_PASSWORD_REFERENCE,
      candidateId: "c2",
      reason: "password field",
    },
    { action: "tap", candidateId: "c3", reason: "submit", finishesIntent: true },
  ];
  const unregister = registerActDecider(async (input) => {
    screenshots.push(input.screenshot);
    prompts.push(JSON.stringify(input.candidates));
    assert.equal(input.auth?.accountKey, "member");
    return decisions.shift() ?? { action: "done", reason: "done" };
  });
  t.after(unregister);
  const calls = { fill: [] as string[], type: [] as string[], press: [] as unknown[] };
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const job = {
    projectId: "project",
    resolvedInputs: {},
    sensitiveInputNames: [],
    artifacts,
  } as unknown as TestJob;
  const runtime = {};
  const ctx = {
    log: () => {},
    artifacts,
    job,
    runtime,
  };
  const device = fakeDevice(calls);
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "browser-test" },
    () =>
      runActStep(
        device,
        {
          kind: "act",
          intent: 'Sign in with the saved account "member"',
          auth: { type: "sign-in", accountKey: "member" },
        },
        ctx,
        async (step: RecipeStep) => {
          if (step.kind === "type") await runTypeStep(device, step, ctx);
        },
        async () => signInScreen(),
      ),
  );

  assert.deepEqual(calls.fill, [usernameCanary, passwordCanary]);
  assert.equal(
    screenshots.every((shot) => shot === undefined),
    true,
  );
  assert.equal(
    prompts.some((text) => text.includes(usernameCanary) || text.includes(passwordCanary)),
    false,
  );
  const artifactJson = JSON.stringify(artifacts);
  assert.equal(artifactJson.includes(usernameCanary), false);
  assert.equal(artifactJson.includes(passwordCanary), false);
  assert.equal(artifactJson.includes(SIGN_IN_USERNAME_REFERENCE), true);
  assert.equal(artifactJson.includes(SIGN_IN_PASSWORD_REFERENCE), true);
  assert.equal((runtime as { activeSignIn?: unknown }).activeSignIn, undefined);
  assert.equal(job.resolvedInputs["signin.member.username"], usernameCanary);
  assert.deepEqual(
    job.sensitiveInputNames,
    ["signin.member.password", "signin.member.username"].sort(),
  );

  const persistedShape = redactPrivateValue(
    {
      artifacts,
      logs: [`typed ${usernameCanary} and ${passwordCanary}`],
      resolvedInputs: job.resolvedInputs,
    },
    job.resolvedInputs,
    job.sensitiveInputNames ?? [],
  );
  const persistedJson = JSON.stringify(persistedShape);
  assert.equal(persistedJson.includes(usernameCanary), false);
  assert.equal(persistedJson.includes(passwordCanary), false);
});

test("unknown and out-of-context secret references throw before any device input", async () => {
  const calls = { fill: [] as string[], type: [] as string[], press: [] as unknown[] };
  const device = fakeDevice(calls);
  const ctx = { log: () => {}, runtime: {} };
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "browser-test" },
    async () => {
      await assert.rejects(
        runTypeStep(
          device,
          {
            kind: "type",
            text: SIGN_IN_PASSWORD_REFERENCE,
            mode: "replace",
            target: { identifier: "password" },
          },
          ctx,
        ),
        /active saved sign-in/u,
      );
      await assert.rejects(
        runTypeStep(
          device,
          {
            kind: "type",
            text: "secret:unknown.value",
            mode: "replace",
            target: { identifier: "password" },
          },
          ctx,
        ),
        /Unknown secret reference/u,
      );
    },
  );
  assert.deepEqual(calls, { fill: [], type: [], press: [] });
});

test("a sign-in model cannot type invented credential text", async (t) => {
  process.env.RELAY_SIGN_IN_MEMBER_USERNAME = usernameCanary;
  process.env.RELAY_SIGN_IN_MEMBER_PASSWORD = passwordCanary;
  t.after(() => {
    delete process.env.RELAY_SIGN_IN_MEMBER_USERNAME;
    delete process.env.RELAY_SIGN_IN_MEMBER_PASSWORD;
  });
  const unregister = registerActDecider(async () => ({
    action: "type",
    text: "invented@example.test",
    candidateId: "c1",
    reason: "invented credential",
  }));
  t.after(unregister);
  const calls = { fill: [] as string[], type: [] as string[], press: [] as unknown[] };
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const job = {
    projectId: "project",
    resolvedInputs: {},
    sensitiveInputNames: [],
    artifacts,
  } as unknown as TestJob;
  const ctx = { log: () => {}, artifacts, job, runtime: {} };
  await assert.rejects(
    runActStep(
      fakeDevice(calls),
      {
        kind: "act",
        intent: "Sign in with the saved account",
        auth: { type: "sign-in", accountKey: "member" },
      },
      ctx,
      async () => {},
      async () => signInScreen(),
    ),
    /required secret reference/u,
  );
  assert.deepEqual(calls.fill, []);
  assert.equal(JSON.stringify(artifacts).includes("invented@example.test"), false);
});
