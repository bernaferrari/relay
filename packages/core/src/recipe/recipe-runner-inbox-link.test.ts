import assert from "node:assert/strict";
import test from "node:test";
import type { Device } from "../device/device.js";
import { redactPrivateValue } from "../input/private-inputs.js";
import type { TestJob } from "../session/session-contract.js";
import { INBOX_LINK_REFERENCE, type ActiveSignInSecrets } from "../sign-in/secret-references.js";
import type { TestInboxMessage } from "../sign-in/imap-test-inbox.js";
import {
  currentTargetContext,
  runWithTargetContext,
  type TargetContext,
} from "../target/target-context.js";
import { registerActDecider } from "./recipe-runner-act.js";
import {
  registerTestInboxClientFactory,
  runInboxStep,
  TestInboxStepError,
} from "./recipe-runner-inbox.js";

const linkCanary = "https://auth.example.test/continue?token=magic-link-canary";
const usernameCanary = "member@example.test";
const passwordCanary = "password-canary";

type OpenCall = {
  input: { url?: string; platform?: string; serial?: string; udid?: string };
  target: TargetContext;
};

function fakeDevice(calls: { opens: OpenCall[]; openError?: Error }): Device {
  return {
    apps: {
      open: async (input: OpenCall["input"]) => {
        calls.opens.push({ input, target: currentTargetContext() });
        if (calls.openError) throw calls.openError;
        return {};
      },
    },
    command: { wait: async () => ({}) },
    capture: { snapshot: async () => ({ nodes: [] }) },
    interactions: {},
  } as unknown as Device;
}

function useInboxEnvironment(t: test.TestContext): void {
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
}

function message(bodyText: string, bodyHtml?: string): TestInboxMessage {
  return {
    uid: 11,
    internalDateMs: Date.now(),
    recipients: ["member@example.test"],
    subject: "Sign in",
    bodyText,
    ...(bodyHtml ? { bodyHtml } : {}),
  };
}

function harness(messages: TestInboxMessage[]) {
  const artifacts: { kind: string; capturedAt: number; data: unknown }[] = [];
  const job = {
    id: `job-link-${Math.random()}`,
    projectId: "project",
    resolvedInputs: {},
    sensitiveInputNames: [],
    artifacts,
  } as unknown as TestJob;
  const ctx = {
    log: () => {},
    artifacts,
    job,
    runtime: {
      activeSignIn: {
        accountKey: "member",
        username: usernameCanary,
        password: passwordCanary,
        source: "environment",
        inboxKey: "member",
        startedAt: Date.now(),
      } satisfies ActiveSignInSecrets as ActiveSignInSecrets,
    },
  };
  const unregisterInbox = registerTestInboxClientFactory(async () => ({
    async fetchMessagesSince(input) {
      return messages.map((item) => ({
        ...item,
        internalDateMs: Math.max(item.internalDateMs, input.sinceMs + 1),
      }));
    },
    async close() {},
  }));
  return { artifacts, job, ctx, unregisterInbox };
}

async function runLinkStep(
  device: Device,
  ctx: Parameters<typeof runInboxStep>[2],
  target: TargetContext,
): Promise<void> {
  await runWithTargetContext(target, () =>
    runInboxStep(device, { kind: "inbox", action: "open-link", timeoutMs: 10 }, ctx, async () => {
      throw new Error("open-link must not create model act steps");
    }),
  );
}

test("browser magic-link step opens through the controlled target, asks no model, and redacts the token carrier", async (t) => {
  useInboxEnvironment(t);
  const { artifacts, job, ctx, unregisterInbox } = harness([
    message("", `<a href="${linkCanary.replace("&", "&amp;")}">Sign in</a>`),
  ]);
  const unregisterAct = registerActDecider(async () => {
    throw new Error("the model must not see or decide a magic-link step");
  });
  t.after(() => {
    unregisterInbox();
    unregisterAct();
  });
  const calls = { opens: [] as OpenCall[] };
  await runLinkStep(fakeDevice(calls), ctx, {
    kind: "browser",
    platform: "browser",
    targetId: "browser-test",
  });

  assert.equal(calls.opens.length, 1);
  assert.equal(calls.opens[0]!.target.kind, "browser");
  assert.equal(calls.opens[0]!.input.url, linkCanary);
  assert.equal(job.resolvedInputs["inbox.member.link"], linkCanary);
  assert.ok(job.sensitiveInputNames?.includes("inbox.member.link"));
  const artifactJson = JSON.stringify(artifacts);
  assert.equal(artifactJson.includes(linkCanary), false);
  assert.equal(artifactJson.includes(INBOX_LINK_REFERENCE), true);
  assert.equal(artifactJson.includes("Sign in"), false);
  const persisted = redactPrivateValue(
    { artifacts, logs: [`opened ${linkCanary}`], resolvedInputs: job.resolvedInputs },
    job.resolvedInputs,
    job.sensitiveInputNames ?? [],
  );
  assert.equal(JSON.stringify(persisted).includes(linkCanary), false);
});

test("native magic-link step hands the URL to the controlled device open path", async (t) => {
  useInboxEnvironment(t);
  const { ctx, unregisterInbox } = harness([message(`Sign in [${linkCanary}]`)]);
  t.after(unregisterInbox);
  const calls = { opens: [] as OpenCall[] };
  await runLinkStep(fakeDevice(calls), ctx, {
    kind: "device",
    platform: "android",
    serial: "emulator-5554",
  });
  assert.equal(calls.opens.length, 1);
  assert.equal(calls.opens[0]!.target.kind, "device");
  assert.equal(calls.opens[0]!.input.platform, "android");
  assert.equal(calls.opens[0]!.input.serial, "emulator-5554");
  assert.equal(calls.opens[0]!.input.url, linkCanary);
});

test("magic-link failures are typed as timeout, no-link, and ambiguous-link", async (t) => {
  useInboxEnvironment(t);
  const cases = [
    { messages: [], reason: "timeout", copy: /No sign-in email arrived/u },
    {
      messages: [message("Welcome. No usable authentication URL is present.")],
      reason: "no-link",
      copy: /did not contain a usable sign-in link/u,
    },
    {
      messages: [
        message(
          "",
          '<a href="https://auth.example.test/one">Sign in</a><a href="https://auth.example.test/two">Sign in</a>',
        ),
      ],
      reason: "ambiguous-link",
      copy: /two equally plausible sign-in links/u,
    },
  ] as const;
  for (const item of cases) {
    const { ctx, unregisterInbox } = harness([...item.messages]);
    const calls = { opens: [] as OpenCall[] };
    await assert.rejects(
      runLinkStep(fakeDevice(calls), ctx, {
        kind: "browser",
        platform: "browser",
        targetId: "browser-test",
      }),
      (error: unknown) =>
        error instanceof TestInboxStepError &&
        error.classification === "blocked" &&
        error.reason === item.reason &&
        item.copy.test(error.message),
    );
    assert.equal(calls.opens.length, 0);
    unregisterInbox();
  }
});

test("magic-link open errors never echo the token carrier", async (t) => {
  useInboxEnvironment(t);
  const { ctx, unregisterInbox } = harness([message(`Sign in [${linkCanary}]`)]);
  t.after(unregisterInbox);
  const calls = { opens: [] as OpenCall[], openError: new Error(`cannot open ${linkCanary}`) };
  await assert.rejects(
    runLinkStep(fakeDevice(calls), ctx, {
      kind: "device",
      platform: "ios",
      serial: "00000000-0000000000000000",
    }),
    (error: unknown) =>
      error instanceof TestInboxStepError &&
      error.reason === "open" &&
      !error.message.includes(linkCanary),
  );
});

test("a sign-in without an explicit link uses the inbox that shares its key", async (t) => {
  useInboxEnvironment(t);
  const { ctx, unregisterInbox } = harness([message(`Sign in [${linkCanary}]`)]);
  t.after(unregisterInbox);
  const linked = ctx.runtime.activeSignIn as ActiveSignInSecrets;
  ctx.runtime.activeSignIn = {
    accountKey: linked.accountKey,
    username: linked.username,
    password: linked.password,
    source: linked.source,
    startedAt: linked.startedAt,
  };
  const calls = { opens: [] as OpenCall[] };
  await runLinkStep(fakeDevice(calls), ctx, {
    kind: "browser",
    platform: "browser",
    targetId: "browser-test",
  });
  assert.equal(calls.opens.length, 1);
  assert.equal(calls.opens[0]!.input.url, linkCanary);
});

test("an explicit inbox link wins over the same-key fallback", async (t) => {
  process.env.RELAY_INBOX_OTHER_HOST = "imap.other.test";
  process.env.RELAY_INBOX_OTHER_PORT = "993";
  process.env.RELAY_INBOX_OTHER_SECURE = "true";
  process.env.RELAY_INBOX_OTHER_MAILBOX = "INBOX";
  process.env.RELAY_INBOX_OTHER_USERNAME = "other-user";
  process.env.RELAY_INBOX_OTHER_PASSWORD = "other-pass";
  t.after(() => {
    for (const name of ["HOST", "PORT", "SECURE", "MAILBOX", "USERNAME", "PASSWORD"]) {
      delete process.env[`RELAY_INBOX_OTHER_${name}`];
    }
  });
  useInboxEnvironment(t);
  const { ctx, job, unregisterInbox } = harness([message(`Sign in [${linkCanary}]`)]);
  t.after(unregisterInbox);
  ctx.runtime.activeSignIn = { ...ctx.runtime.activeSignIn, inboxKey: "other" };
  const calls = { opens: [] as OpenCall[] };
  await runLinkStep(fakeDevice(calls), ctx, {
    kind: "browser",
    platform: "browser",
    targetId: "browser-test",
  });
  assert.equal(calls.opens.length, 1);
  assert.equal(calls.opens[0]!.input.url, linkCanary);
  assert.equal(job.resolvedInputs["inbox.other.link"], linkCanary);
  assert.equal(job.resolvedInputs["inbox.member.link"], undefined);
});
