import type { TestInboxMetadata, TestInboxResolution } from "@relay/protocol";
import {
  inspectTestInboxEnvironmentOverlay,
  testInboxEnvironmentVariableNames,
  type TestInboxEnvironment,
} from "./environment-overlays.js";
import {
  isTestInboxAuthenticationFailure,
  type TestInboxClientFactory,
  createImapTestInboxClient,
} from "./imap-test-inbox.js";
import {
  latestNonRevokedTestInbox,
  listTestInboxes,
  loadTestInboxSecret,
  normalizeTestInboxKey,
  TestInboxStoreError,
} from "./test-inboxes.js";

export type TestInboxResolutionErrorCode =
  | "missing"
  | "revoked"
  | "partial-environment"
  | "authentication-failure"
  | "connection-failure"
  | "unavailable";

export class TestInboxResolutionError extends Error {
  constructor(
    readonly code: TestInboxResolutionErrorCode,
    readonly key: string,
    message: string,
    readonly recovery: string,
    readonly metadata?: TestInboxMetadata,
  ) {
    super(message);
    this.name = "TestInboxResolutionError";
  }
}

export type ResolvedTestInbox = Readonly<{
  key: string;
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  recipient?: string;
  username: string;
  password: string;
  source: "environment" | "local";
  reference?: string;
  metadata?: TestInboxMetadata;
}>;

function environmentRecovery(key: string): string {
  const names = testInboxEnvironmentVariableNames(key);
  return `Set all ${names.hostVariable}, ${names.portVariable}, ${names.secureVariable}, ${names.mailboxVariable}, ${names.usernameVariable} and ${names.passwordVariable}, unset them all, or save and rotate the local test inbox as a person.`;
}

function fail(
  code: TestInboxResolutionErrorCode,
  key: string,
  detail: string,
  recovery: string,
  metadata?: TestInboxMetadata,
): TestInboxResolutionError {
  return new TestInboxResolutionError(code, key, detail, recovery, metadata);
}

/** Resolve the active test inbox. A complete environment overlay wins; every
 * partial or invalid overlay fails closed rather than falling back to disk. */
export async function resolveTestInbox(input: {
  projectId: string;
  key?: string;
  env?: TestInboxEnvironment;
  workspaceRoot?: string;
}): Promise<ResolvedTestInbox> {
  const key = normalizeTestInboxKey(input.key);
  const overlay = inspectTestInboxEnvironmentOverlay(key, input.env ?? process.env);
  const names = testInboxEnvironmentVariableNames(key);
  if (overlay.status === "partial") {
    throw fail(
      "partial-environment",
      key,
      `Test inbox "${key}" has an incomplete environment overlay: ${overlay.missing.join(", ")} is missing. Relay will not use the local test inbox as a fallback.`,
      environmentRecovery(key),
    );
  }
  if (overlay.status === "invalid") {
    throw fail(
      "partial-environment",
      key,
      `Test inbox "${key}" has an invalid environment overlay value for ${overlay.field}.`,
      environmentRecovery(key),
    );
  }
  if (overlay.status === "complete") {
    return Object.freeze({
      key,
      host: overlay.host,
      port: overlay.port,
      secure: overlay.secure,
      mailbox: overlay.mailbox,
      ...(overlay.recipient ? { recipient: overlay.recipient } : {}),
      username: overlay.username,
      password: overlay.password,
      source: "environment",
    });
  }

  let records: TestInboxMetadata[];
  try {
    records = await listTestInboxes({
      projectId: input.projectId,
      key,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    });
  } catch (error) {
    if (error instanceof TestInboxStoreError) {
      throw fail(
        "unavailable",
        key,
        `Test inbox "${key}" cannot be read safely.`,
        "Inspect the local .relay/test-inboxes store permissions and integrity, then rotate the test inbox as a person.",
      );
    }
    throw error;
  }
  if (!records.length) {
    throw fail(
      "missing",
      key,
      `Test inbox "${key}" was not found.`,
      `Save it with relay inbox save, or set the complete ${names.hostVariable} environment overlay.`,
    );
  }
  const latest = latestNonRevokedTestInbox(records, key);
  if (!latest) {
    throw fail(
      "revoked",
      key,
      `Test inbox "${key}" is revoked.`,
      "Rotate it with relay inbox rotate as a person, or set the complete environment overlay.",
      records.at(-1),
    );
  }
  try {
    const loaded = await loadTestInboxSecret({
      projectId: input.projectId,
      reference: latest.reference,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {}),
    });
    return Object.freeze({
      key,
      host: latest.host,
      port: latest.port,
      secure: latest.secure,
      mailbox: latest.mailbox,
      ...(latest.recipient ? { recipient: latest.recipient } : {}),
      username: loaded.secret.username,
      password: loaded.secret.password,
      source: "local",
      reference: latest.reference,
      metadata: latest,
    });
  } catch (error) {
    if (error instanceof TestInboxStoreError) {
      throw fail(
        error.code === "revoked" ? "revoked" : "unavailable",
        key,
        error.code === "revoked"
          ? `Test inbox "${key}" is revoked.`
          : `Test inbox "${key}" cannot be decrypted safely.`,
        "Rotate the test inbox as a person; do not edit encrypted vault files by hand.",
        latest,
      );
    }
    throw error;
  }
}

function resolutionForError(key: string, error: TestInboxResolutionError): TestInboxResolution {
  const names = testInboxEnvironmentVariableNames(key);
  return {
    schemaVersion: 1,
    key,
    status: error.code,
    source: "none",
    ...(error.metadata ? { inbox: error.metadata } : {}),
    detail: error.message,
    recovery: error.recovery,
    ...(error.code === "partial-environment" ? { environment: { ...names } } : {}),
  };
}

/** Metadata-only connectivity probe. The output never carries credentials,
 * message subjects, bodies, or codes. */
export async function checkTestInboxResolution(input: {
  projectId: string;
  key?: string;
  env?: TestInboxEnvironment;
  workspaceRoot?: string;
  clientFactory?: TestInboxClientFactory;
}): Promise<TestInboxResolution> {
  const key = normalizeTestInboxKey(input.key);
  try {
    const resolved = await resolveTestInbox(input);
    const factory = input.clientFactory ?? createImapTestInboxClient;
    try {
      const client = await factory(resolved, resolved);
      await client.close();
    } catch (error) {
      const authentication = isTestInboxAuthenticationFailure(error);
      throw fail(
        authentication ? "authentication-failure" : "connection-failure",
        key,
        authentication
          ? `Test inbox "${key}" authentication failed.`
          : `Test inbox "${key}" could not be reached or opened safely.`,
        authentication
          ? "Rotate the test inbox credentials as a person, then run relay inbox check again."
          : "Check the host, port, TLS setting, mailbox name, and network path, then run relay inbox check again.",
        resolved.metadata,
      );
    }
    return {
      schemaVersion: 1,
      key,
      status: "ready",
      source: resolved.source,
      ...(resolved.reference ? { reference: resolved.reference } : {}),
      ...(resolved.metadata ? { inbox: resolved.metadata } : {}),
      detail:
        resolved.source === "environment"
          ? `Test inbox "${key}" is available from the environment overlay.`
          : `Test inbox "${key}" is available from local encrypted storage.`,
      recovery: "No action is needed.",
    };
  } catch (error) {
    if (!(error instanceof TestInboxResolutionError)) throw error;
    return resolutionForError(key, error);
  }
}
