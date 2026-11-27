import test from "node:test";
import assert from "node:assert/strict";
import type { Device } from "../device/device.js";
import type { RecipeStep } from "@relay/protocol";
import { redactPrivateValue } from "../input/private-inputs.js";
import { runWithTargetContext } from "../target/target-context.js";
import type { TestJob } from "../session/session-contract.js";
import {
  INBOX_CODE_REFERENCE,
  SIGN_IN_PASSWORD_REFERENCE,
  SIGN_IN_USERNAME_REFERENCE,
} from "../sign-in/secret-references.js";
import { registerTestInboxClientFactory, runInboxStep } from "./recipe-runner-inbox.js";
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
    assert.equal(input.auth?.type === "sign-in" ? input.auth.accountKey : undefined, "member");
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
  const active = (runtime as { activeSignIn?: { accountKey?: string; startedAt?: number } })
    .activeSignIn;
  assert.equal(active?.accountKey, "member");
  assert.equal(typeof active?.startedAt, "number");
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

test("inbox code polls after sign-in start, types only through the opaque reference, and artifacts stay metadata-only", async (t) => {
  const codeCanary = "246810";
  process.env.RELAY_INBOX_MEMBER_HOST = "imap.example.test";
  process.env.RELAY_INBOX_MEMBER_PORT = "993";
  process.env.RELAY_INBOX_MEMBER_SECURE = "true";
  process.env.RELAY_INBOX_MEMBER_MAILBOX = "INBOX";
  process.env.RELAY_INBOX_MEMBER_USERNAME = "inbox-user";
  process.env.RELAY_INBOX_MEMBER_PASSWORD = "inbox-pass";
  t.after(() => {
    for (const name of ["HOST", "PORT", "SECURE", "MAILBOX", "USERNAME", "PASSWORD"]) {
      delete process.env[`RELAY_INBOX_MEMBER_${name}`];
    }
  });
  const unregisterInbox = registerTestInboxClientFactory(async () => ({
    async fetchMessagesSince(input) {
      return [
        {
          uid: 9,
          internalDateMs: input.sinceMs + 1000,
          recipients: ["member@example.test"],
          subject: "Your sign-in code",
          bodyText: `Your sign-in code is ${codeCanary}.`,
        },
      ];
    },
    async close() {},
  }));
  const decisions: ActDecision[] = [
    {
      action: "type",
      text: INBOX_CODE_REFERENCE,
      candidateId: "c1",
      reason: "code field",
      finishesIntent: true,
    },
  ];
  const prompts: unknown[] = [];
  const unregisterAct = registerActDecider(async (input) => {
    prompts.push(input.auth);
    assert.equal(input.screenshot, undefined);
    return decisions.shift() ?? { action: "done", reason: "done" };
  });
  t.after(() => {
    unregisterInbox();
    unregisterAct();
  });
  const calls = { fill: [] as string[], type: [] as string[], press: [] as unknown[] };
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const job = {
    id: "job-inbox",
    projectId: "project",
    resolvedInputs: {},
    sensitiveInputNames: [],
    artifacts,
  } as unknown as TestJob;
  const runtime = {
    activeSignIn: {
      accountKey: "member",
      username: usernameCanary,
      password: passwordCanary,
      source: "environment" as const,
      inboxKey: "member",
      startedAt: Date.now(),
    },
  };
  const ctx = { log: () => {}, artifacts, job, runtime };
  await runWithTargetContext(
    { kind: "browser", platform: "browser", targetId: "browser-test" },
    () =>
      runInboxStep(
        fakeDevice(calls),
        { kind: "inbox", action: "type-code", timeoutMs: 1_000 },
        ctx,
        async (step: RecipeStep) => {
          if (step.kind === "type") await runTypeStep(fakeDevice(calls), step, ctx);
        },
        async () => ({
          candidates: [
            {
              id: "c1",
              identifier: "code",
              label: "Verification code",
              editable: true,
              target: { identifier: "code", label: "Verification code" },
            },
          ],
          screenshot: { mimeType: "image/png", data: "c2hvdWxkLW5vdC1iZS1zZW50" },
        }),
      ),
  );

  assert.deepEqual(calls.fill, [codeCanary]);
  assert.deepEqual(prompts, [{ type: "inbox-code", inboxKey: "member" }]);
  const artifactJson = JSON.stringify(artifacts);
  assert.equal(artifactJson.includes(codeCanary), false);
  assert.equal(artifactJson.includes(INBOX_CODE_REFERENCE), true);
  assert.equal(artifactJson.includes("Your sign-in code"), false);
  assert.equal(job.resolvedInputs["inbox.member.code"], codeCanary);
  assert.ok(job.sensitiveInputNames?.includes("inbox.member.code"));
});
