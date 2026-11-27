import assert from "node:assert/strict";
import net from "node:net";
import test from "node:test";
import {
  createImapTestInboxClient,
  isTestInboxAuthenticationFailure,
  type TestInboxMessage,
} from "./imap-test-inbox.js";

// Wire-level integration tests for the production IMAP test-inbox adapter.
// The fake server below implements just enough IMAP4rev1 grammar for imapflow's
// real parser: literals in untagged FETCH responses, bracketed response codes,
// and synchronizing literals in client commands. Every command the adapter
// sends is recorded, so the tests prove the read-only contract on the wire:
// EXAMINE instead of SELECT, BODY.PEEK instead of BODY, and no mutation or
// IDLE commands ever reaching the server.

type WireCommand = Readonly<{
  tag: string;
  command: string;
  args: string;
  raw: string;
}>;

type FakeImapFixture = Readonly<{
  uid: number;
  internalDateMs: number;
  source: string;
  from: { name: string; mailbox: string; host: string };
  to: string[];
  subject: string;
  messageId: string;
  /** When set, RFC822.SIZE reports this instead of the true source length. */
  reportedSize?: number;
}>;

type FakeImapServer = Readonly<{
  port: number;
  received: WireCommand[];
  close(): Promise<void>;
}>;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** IMAP date-time format used in INTERNALDATE responses, always UTC. */
function imapDateTime(ms: number): string {
  const date = new Date(ms);
  return (
    `${pad2(date.getUTCDate())}-${MONTHS[date.getUTCMonth()]}-${date.getUTCFullYear()} ` +
    `${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} +0000`
  );
}

/** RFC 3501 date-only format used by the SINCE search criterion. */
function parseImapDate(token: string): number {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(token);
  assert.ok(match, `fake server received unparseable date token: ${token}`);
  const month = MONTHS.findIndex((entry) => entry.toLowerCase() === match[2]!.toLowerCase());
  assert.ok(month >= 0, `fake server received unknown month: ${token}`);
  return Date.UTC(Number(match[3]), month, Number(match[1]));
}

/** UTC calendar-day number, so SINCE compares dates the way IMAP does:
 * disregarding the time of day entirely. */
function utcDay(ms: number): number {
  return Math.floor(ms / 86_400_000);
}

function quoted(value: string): string {
  return `"${value.replace(/["\\]/g, (char) => `\\${char}`)}"`;
}

function envelopeAddress(name: string | null, mailbox: string, host: string): string {
  return `(${name === null ? "NIL" : quoted(name)} NIL ${quoted(mailbox)} ${quoted(host)})`;
}

function envelope(fixture: FakeImapFixture): string {
  const date = new Date(fixture.internalDateMs).toUTCString();
  const from = envelopeAddress(fixture.from.name, fixture.from.mailbox, fixture.from.host);
  const toList = fixture.to
    .map((recipient) => {
      const at = recipient.lastIndexOf("@");
      return envelopeAddress(null, recipient.slice(0, at), recipient.slice(at + 1));
    })
    .join(" ");
  return [
    `(${quoted(date)}`,
    quoted(fixture.subject),
    `(${from})`,
    `(${from})`,
    `(${from})`,
    `(${toList})`,
    "NIL NIL NIL",
    `${quoted(fixture.messageId)})`,
  ].join(" ");
}

/** Splits a command argument string into tokens, honoring double-quoted
 * strings with backslash escapes. Parentheses are kept inside the tokens they
 * belong to only by accident of not containing spaces; the fake never needs
 * full list grammar on the client side. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuote = false;
  let escaped = false;
  let started = false;
  for (const char of input) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (inQuote && char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      started = true;
      continue;
    }
    if (!inQuote && (char === " " || char === "\t")) {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    current += char;
  }
  if (started || current) tokens.push(current);
  return tokens;
}

type SearchCriteria = Readonly<{ sinceMs?: number; to?: string }>;

function parseSearchCriteria(args: string): SearchCriteria {
  const tokens = tokenize(args);
  let sinceMs: number | undefined;
  let to: string | undefined;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!.toUpperCase();
    if (token === "SINCE" && tokens[index + 1] !== undefined) {
      sinceMs = parseImapDate(tokens[index + 1]!);
      index++;
    } else if (token === "TO" && tokens[index + 1] !== undefined) {
      to = tokens[index + 1]!.toLowerCase();
      index++;
    } else if (token === "CHARSET" && tokens[index + 1] !== undefined) {
      index++;
    }
  }
  return { ...(sinceMs !== undefined ? { sinceMs } : {}), ...(to !== undefined ? { to } : {}) };
}

/** Expands the comma-separated uid lists the adapter sends. Ranges are
 * supported for completeness even though the adapter never emits them. */
function parseUidSet(range: string): number[] {
  const uids: number[] = [];
  for (const part of range.split(",")) {
    const colon = part.indexOf(":");
    if (colon === -1) {
      uids.push(Number(part));
      continue;
    }
    const first = Number(part.slice(0, colon));
    const second = Number(part.slice(colon + 1));
    for (let uid = Math.min(first, second); uid <= Math.max(first, second); uid++) uids.push(uid);
  }
  return uids;
}

type FakeServerOptions = Readonly<{
  fixtures: FakeImapFixture[];
  rejectAuth?: boolean;
  /** Answer EXAMINE with READ-WRITE, simulating a server that refuses
   * read-only opens. The adapter must fail rather than poll read-write. */
  grantReadWrite?: boolean;
}>;

async function startFakeImapServer(options: FakeServerOptions): Promise<FakeImapServer> {
  const received: WireCommand[] = [];
  const sockets = new Set<net.Socket>();
  const fixtures = [...options.fixtures].sort((left, right) => left.uid - right.uid);

  function search(criteria: SearchCriteria): FakeImapFixture[] {
    return fixtures.filter((fixture) => {
      if (
        criteria.sinceMs !== undefined &&
        utcDay(fixture.internalDateMs) < utcDay(criteria.sinceMs)
      )
        return false;
      if (
        criteria.to !== undefined &&
        !fixture.to.some((recipient) => recipient.toLowerCase().includes(criteria.to!))
      )
        return false;
      return true;
    });
  }

  function fetchResponses(range: string, items: string): string[] {
    const partial = /<(\d+)(?:\.(\d+))?>/i.exec(items);
    const maxLength = partial?.[2] !== undefined ? Number(partial[2]) : undefined;
    const responses: string[] = [];
    for (const uid of parseUidSet(range)) {
      const index = fixtures.findIndex((fixture) => fixture.uid === uid);
      if (index === -1) continue;
      const fixture = fixtures[index]!;
      const source = Buffer.from(fixture.source, "utf8");
      const truncated =
        maxLength !== undefined && source.length > maxLength
          ? source.subarray(0, maxLength)
          : source;
      const size = fixture.reportedSize ?? source.length;
      const head =
        `* ${index + 1} FETCH (UID ${fixture.uid} ENVELOPE ${envelope(fixture)} ` +
        `INTERNALDATE "${imapDateTime(fixture.internalDateMs)}" RFC822.SIZE ${size} ` +
        `BODY[]<0> {${truncated.length}}\r\n`;
      responses.push(head + truncated.toString("utf8") + ")\r\n");
    }
    return responses;
  }

  function handleCommand(line: string, socket: net.Socket): void {
    const space = line.indexOf(" ");
    const tag = line.slice(0, space);
    const rest = line.slice(space + 1);
    const restSpace = rest.indexOf(" ");
    const verb = (restSpace === -1 ? rest : rest.slice(0, restSpace)).toUpperCase();
    let args = restSpace === -1 ? "" : rest.slice(restSpace + 1);
    let command = verb;
    if (verb === "UID") {
      const subSpace = args.indexOf(" ");
      const sub = (subSpace === -1 ? args : args.slice(0, subSpace)).toUpperCase();
      args = subSpace === -1 ? "" : args.slice(subSpace + 1);
      command = `UID ${sub}`;
    }
    received.push({ tag, command, args, raw: line });
    const write = (text: string) => socket.write(text);
    switch (command) {
      case "CAPABILITY":
        write(`* CAPABILITY IMAP4rev1 NAMESPACE\r\n${tag} OK CAPABILITY completed\r\n`);
        return;
      case "LOGIN":
        if (options.rejectAuth) {
          write(`${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else {
          write(`${tag} OK LOGIN completed\r\n`);
        }
        return;
      case "NAMESPACE":
        write(`* NAMESPACE (("" "/")) NIL NIL\r\n${tag} OK NAMESPACE completed\r\n`);
        return;
      case "LIST":
        write(`* LIST (\\HasNoChildren) "/" INBOX\r\n${tag} OK LIST completed\r\n`);
        return;
      case "LSUB":
        write(`${tag} OK LSUB completed\r\n`);
        return;
      case "EXAMINE":
      case "SELECT":
        write(
          `* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)\r\n` +
            `* ${fixtures.length} EXISTS\r\n` +
            `* 0 RECENT\r\n` +
            `* OK [UIDVALIDITY 1000] UIDs valid\r\n` +
            `* OK [UIDNEXT ${Math.max(...fixtures.map((fixture) => fixture.uid)) + 1}] Predicted next UID\r\n` +
            `${tag} OK [${options.grantReadWrite ? "READ-WRITE" : "READ-ONLY"}] ${command} completed\r\n`,
        );
        return;
      case "UID SEARCH": {
        const matches = search(parseSearchCriteria(args));
        write(
          `* SEARCH${matches.length ? ` ${matches.map((fixture) => fixture.uid).join(" ")}` : ""}\r\n${tag} OK SEARCH completed\r\n`,
        );
        return;
      }
      case "UID FETCH": {
        const itemsSpace = args.indexOf(" ");
        const range = args.slice(0, itemsSpace);
        const items = args.slice(itemsSpace + 1);
        for (const response of fetchResponses(range, items)) write(response);
        write(`${tag} OK FETCH completed\r\n`);
        return;
      }
      case "LOGOUT":
        write(`* BYE Logging out\r\n${tag} OK LOGOUT completed\r\n`);
        return;
      default:
        write(`${tag} BAD unsupported command\r\n`);
    }
  }

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => {});
    socket.write("* OK [CAPABILITY IMAP4rev1 NAMESPACE] fake IMAP server ready\r\n");
    // Client commands are line-based except for synchronizing literals: a line
    // ending in "{N}" asks for a continuation, after which exactly N bytes of
    // literal data belong to the same command. Non-ASCII search values take
    // this path, so the state machine is load-bearing rather than defensive:
    // without it the client waits for the continuation forever.
    let buffer = Buffer.alloc(0);
    let literalBytesNeeded = 0;
    let assembled = "";
    const pump = () => {
      for (;;) {
        if (literalBytesNeeded > 0) {
          if (buffer.length < literalBytesNeeded + 2) return;
          const literal = buffer.subarray(0, literalBytesNeeded).toString("utf8");
          buffer = buffer.subarray(literalBytesNeeded);
          literalBytesNeeded = 0;
          assembled += literal;
          continue;
        }
        const end = buffer.indexOf("\r\n");
        if (end === -1) return;
        const line = buffer.subarray(0, end).toString("utf8");
        buffer = buffer.subarray(end + 2);
        assembled += line;
        const literalMarker = /\{(\d+)\}$/.exec(line);
        if (literalMarker) {
          literalBytesNeeded = Number(literalMarker[1]);
          socket.write("+ Ready for additional command text\r\n");
          assembled = assembled.slice(0, assembled.length - literalMarker[0].length);
          continue;
        }
        const complete = assembled;
        assembled = "";
        handleCommand(complete, socket);
      }
    };
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      pump();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object", "fake IMAP server did not bind a port");
  return {
    port: address.port,
    received,
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

// --- Fixtures -------------------------------------------------------------

const recipient = "member+test@example.test";

function fixtureSource(input: {
  from: string;
  to: string;
  subject: string;
  messageId: string;
  dateHeader: string;
  body: string;
  html?: string;
}): string {
  const headers = [
    `From: ${input.from}`,
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    `Date: ${input.dateHeader}`,
    `Message-ID: ${input.messageId}`,
    "MIME-Version: 1.0",
  ];
  if (input.html === undefined) {
    return [...headers, "Content-Type: text/plain; charset=utf-8", "", input.body, ""].join("\r\n");
  }
  return [
    ...headers,
    'Content-Type: multipart/alternative; boundary="relay-boundary"',
    "",
    "--relay-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    input.body,
    "--relay-boundary",
    "Content-Type: text/html; charset=utf-8",
    "",
    input.html,
    "--relay-boundary--",
    "",
  ].join("\r\n");
}

function fixture(input: {
  uid: number;
  internalDateMs: number;
  to?: string[];
  subject: string;
  body: string;
  html?: string;
  reportedSize?: number;
}): FakeImapFixture {
  const to = input.to ?? [recipient];
  return {
    uid: input.uid,
    internalDateMs: input.internalDateMs,
    source: fixtureSource({
      from: "Example Auth <auth@example.test>",
      to: to.join(", "),
      subject: input.subject,
      messageId: `<m${input.uid}@example.test>`,
      dateHeader: new Date(input.internalDateMs).toUTCString(),
      body: input.body,
      ...(input.html !== undefined ? { html: input.html } : {}),
    }),
    from: { name: "Example Auth", mailbox: "auth", host: "example.test" },
    to,
    subject: input.subject,
    messageId: `<m${input.uid}@example.test>`,
    ...(input.reportedSize !== undefined ? { reportedSize: input.reportedSize } : {}),
  };
}

const signInLink = "https://auth.example.test/continue?token=secret-token";

/** Old enough to be excluded by the baseline used in the tests. */
const oldFixture = fixture({
  uid: 100,
  internalDateMs: Date.parse("2024-01-10T10:00:00Z"),
  subject: "Old sign-in",
  body: `Old sign-in email ${signInLink}`,
});

const multipartFixture = fixture({
  uid: 101,
  internalDateMs: Date.parse("2024-01-15T10:00:00Z"),
  subject: "Sign in to Example",
  body: `Sign in at ${signInLink}`,
  html: `<p>Welcome.</p><a href="${signInLink}">Sign in</a>`,
});

const otpFixture = fixture({
  uid: 102,
  internalDateMs: Date.parse("2024-01-15T11:00:00Z"),
  subject: "Your sign-in code",
  body: "Your sign-in code is 123456.",
});

const otherRecipientFixture = fixture({
  uid: 103,
  internalDateMs: Date.parse("2024-01-15T12:00:00Z"),
  to: ["other@example.test"],
  subject: "Someone else's code",
  body: "Your sign-in code is 654321.",
});

const allFixtures = [oldFixture, multipartFixture, otpFixture, otherRecipientFixture];

const baselineMs = Date.parse("2024-01-14T00:00:00Z");

// --- Test helpers ---------------------------------------------------------

function commands(server: FakeImapServer, command: string): WireCommand[] {
  return server.received.filter((entry) => entry.command === command);
}

const MUTATION_COMMANDS = new Set([
  "STORE",
  "UID STORE",
  "COPY",
  "UID COPY",
  "MOVE",
  "UID MOVE",
  "EXPUNGE",
  "UID EXPUNGE",
  "DELETE",
  "CREATE",
  "RENAME",
  "APPEND",
  "CLOSE",
  "SUBSCRIBE",
  "UNSUBSCRIBE",
]);

async function connectAndFetch(
  server: FakeImapServer,
  input: {
    sinceMs?: number;
    recipient?: string;
    maxMessages?: number;
    maxMessageBytes?: number;
  } = {},
): Promise<TestInboxMessage[]> {
  const client = await createImapTestInboxClient(
    {
      host: "127.0.0.1",
      port: server.port,
      secure: false,
      mailbox: "INBOX",
      ...(input.recipient ? { recipient: input.recipient } : {}),
    },
    { username: "inbox-user", password: "inbox-password" },
  );
  try {
    return await client.fetchMessagesSince({
      sinceMs: input.sinceMs ?? baselineMs,
      ...(input.recipient ? { recipient: input.recipient } : {}),
      maxMessages: input.maxMessages ?? 20,
      maxMessageBytes: input.maxMessageBytes ?? 256 * 1024,
    });
  } finally {
    await client.close();
  }
}

async function withServer<T>(
  options: FakeServerOptions,
  run: (server: FakeImapServer) => Promise<T>,
): Promise<T> {
  const server = await startFakeImapServer(options);
  try {
    return await run(server);
  } finally {
    await server.close();
  }
}

// --- Tests ----------------------------------------------------------------

test("wire: adapter authenticates, examines read-only, and fetches parsed messages newest-first", async () => {
  await withServer({ fixtures: allFixtures }, async (server) => {
    const messages = await connectAndFetch(server);
    assert.deepEqual(
      messages.map((message) => message.uid),
      [103, 102, 101],
    );

    const link = messages[0]!;
    assert.equal(link.subject, "Someone else's code");
    assert.deepEqual(link.recipients, ["other@example.test"]);
    assert.equal(link.internalDateMs, Date.parse("2024-01-15T12:00:00Z"));
    assert.match(link.bodyText, /654321/u);
    assert.equal(link.bodyHtml, undefined);

    const otp = messages[1]!;
    assert.equal(otp.subject, "Your sign-in code");
    assert.deepEqual(otp.recipients, [recipient]);
    assert.match(otp.bodyText, /123456/u);

    const multipart = messages[2]!;
    assert.equal(multipart.subject, "Sign in to Example");
    assert.deepEqual(multipart.recipients, [recipient]);
    assert.match(multipart.bodyText, /Sign in at/u);
    assert.ok(multipart.bodyHtml?.includes(`href="${signInLink}"`));

    // The stale message never reaches the adapter because the server-side
    // SINCE filter excludes it.
    assert.equal(
      messages.some((message) => message.uid === 100),
      false,
    );
  });
});

test("wire: mailbox is opened with EXAMINE and no mutation or IDLE command reaches the server", async () => {
  await withServer({ fixtures: allFixtures }, async (server) => {
    await connectAndFetch(server);
    assert.equal(commands(server, "EXAMINE").length, 1);
    assert.equal(commands(server, "SELECT").length, 0);
    assert.equal(commands(server, "IDLE").length, 0);
    const mutations = server.received.filter((entry) => MUTATION_COMMANDS.has(entry.command));
    assert.deepEqual(mutations, []);
    // Every source request must be a PEEK fetch: a plain BODY[] fetch would
    // mark the message \Seen on a real server even inside a read-only session.
    const fetches = commands(server, "UID FETCH");
    assert.ok(fetches.length >= 1);
    for (const fetch of fetches) {
      assert.match(fetch.args, /BODY\.PEEK\[\]/u);
      assert.doesNotMatch(fetch.args.replace(/BODY\.PEEK/gu, ""), /BODY\[\]/u);
    }
  });
});

test("wire: since baseline reaches the server as a SINCE criterion and filters behaviorally", async () => {
  await withServer({ fixtures: allFixtures }, async (server) => {
    const messages = await connectAndFetch(server, { sinceMs: baselineMs });
    const searches = commands(server, "UID SEARCH");
    assert.equal(searches.length, 1);
    assert.match(searches[0]!.args, /(^|\s)SINCE 14-Jan-2024(\s|$)/u);
    // The fake filters server-side, so the pre-baseline message is absent even
    // though it matches every other criterion.
    assert.equal(
      messages.some((message) => message.uid === oldFixture.uid),
      false,
    );
    // And the server never even fetched it: the FETCH range carries only the
    // post-baseline uids.
    const fetches = commands(server, "UID FETCH");
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0]!.args.split(" ")[0], "101,102,103");
  });
});

test("wire: recipient narrowing reaches the server as a TO criterion", async () => {
  await withServer({ fixtures: allFixtures }, async (server) => {
    const messages = await connectAndFetch(server, { recipient });
    const searches = commands(server, "UID SEARCH");
    assert.equal(searches.length, 1);
    assert.match(searches[0]!.args, /(^|\s)TO member\+test@example\.test(\s|$)/u);
    assert.deepEqual(
      messages.map((message) => message.uid),
      [102, 101],
    );
    assert.equal(
      messages.every((message) => message.recipients.includes(recipient)),
      true,
    );
  });
});

test("wire: messages larger than the byte cap are skipped, even when RFC822.SIZE lies", async () => {
  const truthfulBig = multipartFixture;
  const lyingSmall = fixture({
    uid: 104,
    internalDateMs: Date.parse("2024-01-15T13:00:00Z"),
    subject: "Underreported size",
    body:
      "A body padded well past the byte cap so its true length exceeds it even " +
      `though the server lies about the size. ${signInLink} ${"x".repeat(200)}`,
    reportedSize: 10,
  });
  await withServer({ fixtures: [otpFixture, truthfulBig, lyingSmall] }, async (server) => {
    const cap = 300;
    assert.ok(
      Buffer.byteLength(otpFixture.source) < cap,
      "the small fixture must fit under the cap for this test to mean anything",
    );
    assert.ok(Buffer.byteLength(truthfulBig.source) > cap, "the big fixture must exceed the cap");
    assert.ok(
      Buffer.byteLength(lyingSmall.source) > cap,
      "the lying fixture must truly exceed the cap",
    );
    const messages = await connectAndFetch(server, { maxMessageBytes: cap });
    assert.deepEqual(
      messages.map((message) => message.uid),
      [otpFixture.uid],
    );
    // The adapter asks for cap+1 bytes so an oversize message is detectable
    // even when the server truncates honestly.
    const fetches = commands(server, "UID FETCH");
    assert.equal(fetches.length, 1);
    assert.match(fetches[0]!.args, new RegExp(`BODY\\.PEEK\\[\\]<0\\.${cap + 1}>`, "u"));
  });
});

test("wire: candidate cap bounds the fetch to the newest matching messages", async () => {
  await withServer({ fixtures: allFixtures }, async (server) => {
    const messages = await connectAndFetch(server, { maxMessages: 2 });
    assert.deepEqual(
      messages.map((message) => message.uid),
      [103, 102],
    );
    const fetches = commands(server, "UID FETCH");
    assert.equal(fetches.length, 1);
    assert.equal(fetches[0]!.args.split(" ")[0], "102,103");
  });
});

test("wire: equal internal dates sort newest-first by uid", async () => {
  const sameMs = Date.parse("2024-01-15T10:00:00Z");
  const lower = fixture({ uid: 105, internalDateMs: sameMs, subject: "Same second A", body: "a" });
  const higher = fixture({ uid: 106, internalDateMs: sameMs, subject: "Same second B", body: "b" });
  await withServer({ fixtures: [lower, higher] }, async (server) => {
    const messages = await connectAndFetch(server);
    assert.deepEqual(
      messages.map((message) => message.uid),
      [106, 105],
    );
  });
});

test("wire: a non-ASCII recipient travels as a synchronizing literal and narrows the search", async () => {
  const unicodeRecipient = "member+ünïcode@example.test";
  const unicodeFixture = fixture({
    uid: 107,
    internalDateMs: Date.parse("2024-01-15T10:00:00Z"),
    to: [unicodeRecipient],
    subject: "Unicode recipient",
    body: "Your sign-in code is 998877.",
  });
  await withServer({ fixtures: [unicodeFixture, otpFixture] }, async (server) => {
    const messages = await connectAndFetch(server, { recipient: unicodeRecipient });
    const searches = commands(server, "UID SEARCH");
    assert.equal(searches.length, 1);
    // Non-ASCII search values cannot fit a 7-bit quoted string, so imapflow
    // sends CHARSET UTF-8 and the value as a synchronizing literal. The fake
    // reassembles literals inline, so the recorded command carries the exact
    // recipient bytes the adapter was configured with.
    assert.match(searches[0]!.args, /(^|\s)CHARSET UTF-8(\s|$)/u);
    assert.ok(
      searches[0]!.args.includes(`TO ${unicodeRecipient}`),
      `expected the literal recipient in the search command, got: ${searches[0]!.args}`,
    );
    assert.deepEqual(
      messages.map((message) => message.uid),
      [unicodeFixture.uid],
    );
    assert.deepEqual(messages[0]!.recipients, [unicodeRecipient]);
  });
});

test("wire: authentication refusal is classified as an authentication failure", async () => {
  await withServer({ fixtures: allFixtures, rejectAuth: true }, async (server) => {
    const error = await createImapTestInboxClient(
      { host: "127.0.0.1", port: server.port, secure: false, mailbox: "INBOX" },
      { username: "inbox-user", password: "wrong-password" },
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof Error, "authentication refusal must reject the connect");
    assert.equal(
      isTestInboxAuthenticationFailure(error),
      true,
      `expected an authentication failure classification, got: ${error.message}`,
    );
  });
});

test("wire: connection refusal is not classified as an authentication failure", async () => {
  // Bind a port and release it, so nothing listens there anymore.
  const probe = net.createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const address = probe.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  await new Promise<void>((resolve) => probe.close(() => resolve()));

  const error = await createImapTestInboxClient(
    { host: "127.0.0.1", port, secure: false, mailbox: "INBOX" },
    { username: "inbox-user", password: "inbox-password" },
  ).then(
    () => undefined,
    (caught: unknown) => caught,
  );
  assert.ok(error instanceof Error, "a dead port must reject the connect");
  assert.equal(isTestInboxAuthenticationFailure(error), false);
});

test("wire: a server that grants only read-write access is refused", async () => {
  await withServer({ fixtures: allFixtures, grantReadWrite: true }, async (server) => {
    const error = await createImapTestInboxClient(
      { host: "127.0.0.1", port: server.port, secure: false, mailbox: "INBOX" },
      { username: "inbox-user", password: "inbox-password" },
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    );
    assert.ok(error instanceof Error);
    assert.match(error.message, /read-only/u);
  });
});
