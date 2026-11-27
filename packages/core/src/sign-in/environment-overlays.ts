import { DEFAULT_SAVED_SIGN_IN_KEY } from "@relay/protocol";
import { normalizeSavedSignInKey } from "./saved-sign-ins.js";

export type SavedSignInEnvironment = Readonly<Record<string, string | undefined>>;

export type SavedSignInEnvironmentOverlay =
  | Readonly<{
      status: "complete";
      key: string;
      username: string;
      password: string;
      usernameVariable: string;
      passwordVariable: string;
    }>
  | Readonly<{
      status: "partial";
      key: string;
      missing: "username" | "password";
      usernameVariable: string;
      passwordVariable: string;
    }>
  | Readonly<{
      status: "absent";
      key: string;
      usernameVariable: string;
      passwordVariable: string;
    }>;

export function savedSignInEnvironmentSuffix(keyInput?: string): string {
  const key = normalizeSavedSignInKey(keyInput ?? DEFAULT_SAVED_SIGN_IN_KEY);
  return key.toUpperCase().replace(/[^A-Z0-9]+/gu, "_");
}

export function savedSignInEnvironmentVariableNames(key?: string): {
  usernameVariable: string;
  passwordVariable: string;
} {
  const suffix = savedSignInEnvironmentSuffix(key);
  return {
    usernameVariable: `RELAY_SIGN_IN_${suffix}_USERNAME`,
    passwordVariable: `RELAY_SIGN_IN_${suffix}_PASSWORD`,
  };
}

/** CI overlay inspection. Presence means a non-empty value; a partial pair is
 * explicit and must fail closed rather than silently falling back to disk. */
export function inspectSavedSignInEnvironmentOverlay(
  keyInput?: string,
  env: SavedSignInEnvironment = process.env,
): SavedSignInEnvironmentOverlay {
  const key = normalizeSavedSignInKey(keyInput ?? DEFAULT_SAVED_SIGN_IN_KEY);
  const { usernameVariable, passwordVariable } = savedSignInEnvironmentVariableNames(key);
  const username = env[usernameVariable];
  const password = env[passwordVariable];
  const hasUsername = typeof username === "string" && username.length > 0;
  const hasPassword = typeof password === "string" && password.length > 0;
  if (hasUsername && hasPassword) {
    return Object.freeze({
      status: "complete",
      key,
      username: username!,
      password: password!,
      usernameVariable,
      passwordVariable,
    });
  }
  if (hasUsername !== hasPassword) {
    return Object.freeze({
      status: "partial",
      key,
      missing: hasUsername ? "password" : "username",
      usernameVariable,
      passwordVariable,
    });
  }
  return Object.freeze({ status: "absent", key, usernameVariable, passwordVariable });
}

export type TestInboxEnvironment = SavedSignInEnvironment;

const TEST_INBOX_REQUIRED = ["host", "port", "secure", "mailbox", "username", "password"] as const;
export type TestInboxRequiredEnvironmentField = (typeof TEST_INBOX_REQUIRED)[number];

export type TestInboxEnvironmentOverlay =
  | Readonly<{
      status: "complete";
      key: string;
      host: string;
      port: number;
      secure: boolean;
      mailbox: string;
      recipient?: string;
      username: string;
      password: string;
      variables: Record<`${TestInboxRequiredEnvironmentField | "recipient"}Variable`, string>;
    }>
  | Readonly<{
      status: "partial";
      key: string;
      missing: TestInboxRequiredEnvironmentField[];
      variables: Record<`${TestInboxRequiredEnvironmentField | "recipient"}Variable`, string>;
    }>
  | Readonly<{
      status: "invalid";
      key: string;
      field: "port" | "secure";
      variables: Record<`${TestInboxRequiredEnvironmentField | "recipient"}Variable`, string>;
    }>
  | Readonly<{
      status: "absent";
      key: string;
      variables: Record<`${TestInboxRequiredEnvironmentField | "recipient"}Variable`, string>;
    }>;

export function testInboxEnvironmentVariableNames(
  keyInput?: string,
): Record<`${TestInboxRequiredEnvironmentField | "recipient"}Variable`, string> {
  const suffix = savedSignInEnvironmentSuffix(normalizeTestInboxKeyForOverlay(keyInput));
  return {
    hostVariable: `RELAY_INBOX_${suffix}_HOST`,
    portVariable: `RELAY_INBOX_${suffix}_PORT`,
    secureVariable: `RELAY_INBOX_${suffix}_SECURE`,
    mailboxVariable: `RELAY_INBOX_${suffix}_MAILBOX`,
    usernameVariable: `RELAY_INBOX_${suffix}_USERNAME`,
    passwordVariable: `RELAY_INBOX_${suffix}_PASSWORD`,
    recipientVariable: `RELAY_INBOX_${suffix}_RECIPIENT`,
  };
}

function normalizeTestInboxKeyForOverlay(key?: string): string {
  return normalizeSavedSignInKey(key ?? DEFAULT_SAVED_SIGN_IN_KEY);
}

function parsePort(value: string): number | undefined {
  if (!/^[0-9]+$/u.test(value)) return undefined;
  const port = Number(value);
  return Number.isSafeInteger(port) && port >= 1 && port <= 65_535 ? port : undefined;
}

function parseSecure(value: string): boolean | undefined {
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  return undefined;
}

/** CI overlay inspection. Any required value makes the overlay explicit; the
 * optional recipient never creates an overlay by itself. A partial or invalid
 * overlay is terminal and never falls back to the encrypted local store. */
export function inspectTestInboxEnvironmentOverlay(
  keyInput?: string,
  env: TestInboxEnvironment = process.env,
): TestInboxEnvironmentOverlay {
  const key = normalizeTestInboxKeyForOverlay(keyInput);
  const variables = testInboxEnvironmentVariableNames(key);
  const values = {
    host: env[variables.hostVariable],
    port: env[variables.portVariable],
    secure: env[variables.secureVariable],
    mailbox: env[variables.mailboxVariable],
    username: env[variables.usernameVariable],
    password: env[variables.passwordVariable],
    recipient: env[variables.recipientVariable],
  };
  const present = TEST_INBOX_REQUIRED.filter((field) => {
    const value = values[field];
    return typeof value === "string" && value.length > 0;
  });
  if (!present.length) return Object.freeze({ status: "absent", key, variables });
  const missing = TEST_INBOX_REQUIRED.filter((field) => !present.includes(field));
  if (missing.length)
    return Object.freeze({ status: "partial", key, missing: [...missing], variables });
  const port = parsePort(values.port!);
  if (port === undefined)
    return Object.freeze({ status: "invalid", key, field: "port", variables });
  const secure = parseSecure(values.secure!);
  if (secure === undefined)
    return Object.freeze({ status: "invalid", key, field: "secure", variables });
  return Object.freeze({
    status: "complete",
    key,
    host: values.host!,
    port,
    secure,
    mailbox: values.mailbox!,
    ...(values.recipient ? { recipient: values.recipient } : {}),
    username: values.username!,
    password: values.password!,
    variables,
  });
}
