import { ImapFlow, AuthenticationFailure } from "imapflow";
import { simpleParser } from "mailparser";

export const INBOX_DEFAULT_TIMEOUT_MS = 60_000;
export const INBOX_POLL_MS = 2_000;
export const INBOX_MAX_MESSAGE_BYTES = 256 * 1024;
export const INBOX_MAX_CANDIDATES = 20;

export type TestInboxConnection = Readonly<{
  host: string;
  port: number;
  secure: boolean;
  mailbox: string;
  recipient?: string;
}>;

export type TestInboxCredentials = Readonly<{ username: string; password: string }>;

/** Secret-bearing message projection used only inside the run process. The
 * subject is present here because OTPs often appear in it, and the HTML body
 * is present because sign-in links often exist only as anchor hrefs. None of
 * these fields may be copied to artifacts, logs, errors, or model prompts. */
export type TestInboxMessage = Readonly<{
  uid: number;
  internalDateMs: number;
  recipients: string[];
  subject?: string;
  bodyText: string;
  bodyHtml?: string;
}>;

/** Narrow test seam. Production adapts IMAP; tests fake message fetching and
 * never need an external inbox or a fake IMAP protocol server. */
export type TestInboxClient = Readonly<{
  fetchMessagesSince(input: {
    sinceMs: number;
    recipient?: string;
    maxMessages: number;
    maxMessageBytes: number;
  }): Promise<TestInboxMessage[]>;
  close(): Promise<void>;
}>;

export type TestInboxClientFactory = (
  connection: TestInboxConnection,
  credentials: TestInboxCredentials,
) => Promise<TestInboxClient>;

export function isTestInboxAuthenticationFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  // imapflow only raises AuthenticationFailure for client-side detection (no
  // password configured, LOGINDISABLED). A server that refuses LOGIN with a
  // tagged NO surfaces as a plain Error("Command failed") instead, carrying
  // its classification on these properties — the message never carries it.
  const properties = error as Error & {
    authenticationFailed?: unknown;
    serverResponseCode?: unknown;
  };
  if (error instanceof AuthenticationFailure || properties.authenticationFailed === true)
    return true;
  if (
    typeof properties.serverResponseCode === "string" &&
    properties.serverResponseCode.toUpperCase() === "AUTHENTICATIONFAILED"
  )
    return true;
  return /authentication|invalid credentials|authenticationfailed|invalid login/i.test(
    error.message,
  );
}

function addresses(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  const records = Array.isArray(value) ? value : [value];
  return records.flatMap((entry) => {
    const address = (entry as { address?: unknown }).address;
    return typeof address === "string" && address.trim() ? [address.trim().toLowerCase()] : [];
  });
}

function bodyText(parsed: { text?: string | false; html?: string | false }): string {
  if (typeof parsed.text === "string" && parsed.text.trim()) return parsed.text;
  if (typeof parsed.html === "string") {
    return parsed.html
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/giu, " ")
      .replace(/<[^>]+>/gu, " ")
      .replace(/&nbsp;/giu, " ");
  }
  return "";
}

/** Fetch-on-demand IMAP adapter. The mailbox is opened read-only and messages
 * are fetched without body-part mutation APIs, flags changes, deletes, moves,
 * or mark-read operations. No IDLE/background daemon is started. */
export async function createImapTestInboxClient(
  connection: TestInboxConnection,
  credentials: TestInboxCredentials,
): Promise<TestInboxClient> {
  const client = new ImapFlow({
    host: connection.host,
    port: connection.port,
    secure: connection.secure,
    auth: { user: credentials.username, pass: credentials.password },
    logger: false,
    disableAutoIdle: true,
    connectionTimeout: INBOX_DEFAULT_TIMEOUT_MS,
    greetingTimeout: INBOX_DEFAULT_TIMEOUT_MS,
    socketTimeout: INBOX_DEFAULT_TIMEOUT_MS,
    tls: { servername: connection.host },
  });
  await client.connect();
  const mailbox = await client.mailboxOpen(connection.mailbox, {
    readOnly: true,
    description: "Relay test inbox read-only polling",
  });
  if (mailbox.readOnly !== true) {
    await client.logout().catch(() => false);
    throw new Error("test inbox mailbox could not be opened read-only");
  }
  let closed = false;
  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    try {
      await client.logout();
    } catch {
      client.close();
    }
  }
  return Object.freeze({
    async fetchMessagesSince(input) {
      const query = {
        since: new Date(input.sinceMs),
        ...(input.recipient ? { to: input.recipient } : {}),
      };
      const found = await client.search(query, { uid: true, strict: true });
      if (!Array.isArray(found)) throw new Error("test inbox search was rejected by the server");
      const uids = found.slice(-input.maxMessages);
      if (!uids.length) return [];
      const range = uids.join(",");
      const messages: TestInboxMessage[] = [];
      for await (const fetched of client.fetch(
        range,
        {
          uid: true,
          envelope: true,
          internalDate: true,
          size: true,
          source: { maxLength: input.maxMessageBytes + 1 },
        },
        { uid: true },
      )) {
        if ((fetched.size ?? 0) > input.maxMessageBytes) continue;
        if (!fetched.source || fetched.source.length > input.maxMessageBytes) continue;
        const parsed = await simpleParser(fetched.source);
        const date =
          fetched.internalDate instanceof Date
            ? fetched.internalDate.getTime()
            : Date.parse(String(fetched.internalDate ?? ""));
        if (!Number.isFinite(date)) continue;
        messages.push({
          uid: fetched.uid,
          internalDateMs: date,
          recipients: [
            ...addresses(fetched.envelope?.to),
            ...addresses(fetched.envelope?.cc),
            ...addresses(fetched.envelope?.bcc),
          ],
          ...(fetched.envelope?.subject ? { subject: fetched.envelope.subject } : {}),
          bodyText: bodyText(parsed),
          ...(typeof parsed.html === "string" ? { bodyHtml: parsed.html } : {}),
        });
      }
      return messages.sort(
        (left, right) => right.internalDateMs - left.internalDateMs || right.uid - left.uid,
      );
    },
    close,
  });
}

/** Connectivity probe used by `inbox check`. It authenticates and opens the
 * mailbox read-only, then closes without fetching message content. */
export async function checkImapTestInboxConnectivity(
  connection: TestInboxConnection,
  credentials: TestInboxCredentials,
): Promise<void> {
  const client = await createImapTestInboxClient(connection, credentials);
  await client.close();
}
