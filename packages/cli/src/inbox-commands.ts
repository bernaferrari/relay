import {
  commandPath as path,
  mappedOperation as mapped,
  type CliOperationDescriptor,
} from "./command-descriptors.js";

const keyArgument = {
  name: "key",
  type: "string",
  description: 'Test inbox key such as "member" (default: default)',
} as const;

const inboxInputHelp = [
  { name: "name", type: "string", required: true, description: "Human-readable inbox name" },
  { name: "host", type: "string", required: true, description: "IMAP host" },
  { name: "port", type: "number", required: true, description: "IMAP port" },
  { name: "secure", type: "boolean", required: true, description: "Use direct TLS" },
  { name: "mailbox", type: "string", required: true, description: "Mailbox path such as INBOX" },
  { name: "recipient", type: "string", description: "Optional non-secret recipient filter" },
  { name: "usernameHint", type: "string", description: "Optional non-secret reminder" },
  {
    name: "username",
    type: "string",
    required: true,
    description: "Secret username; never echoed",
  },
  {
    name: "password",
    type: "string",
    required: true,
    description: "Secret password; never echoed",
  },
] as const;

/** Human test-inbox management. Plaintext crosses the request boundary once;
 * operation output is metadata-only by contract. */
export const inboxCommandDescriptors: readonly CliOperationDescriptor[] = [
  mapped(
    "inbox.save",
    path("inbox save", ["key"], undefined, {
      summary: "Save an encrypted IMAP test inbox",
      argumentHelp: [keyArgument],
      inputHelp: inboxInputHelp,
      examples: [
        'relay inbox save member --input \'{"name":"Member inbox","host":"imap.example.com","port":993,"secure":true,"mailbox":"INBOX","username":"tests@example.com","password":"..."}\' --confirm --json',
      ],
      note: "Human-only. Plaintext is used once for encrypted local storage and is never returned.",
    }),
  ),
  mapped(
    "inbox.rotate",
    path("inbox rotate", ["key"], undefined, {
      summary: "Rotate a test inbox to a new secret revision",
      argumentHelp: [keyArgument],
      inputHelp: inboxInputHelp.filter(({ name }) => name !== "name"),
      examples: [
        'relay inbox rotate member --input \'{"username":"tests@example.com","password":"..."}\' --confirm --json',
      ],
      note: "Human-only. Rotation creates a new exact revision; older revisions remain encrypted history.",
    }),
  ),
  mapped(
    "inbox.list",
    path("inbox list", [], undefined, {
      summary: "List test inbox metadata without secrets",
      examples: ["relay inbox list --json"],
      note: "Metadata only. There is no command that reads or exports inbox credentials.",
    }),
  ),
  mapped(
    "inbox.revoke",
    path("inbox revoke", ["key"], undefined, {
      summary: "Revoke a test inbox",
      argumentHelp: [keyArgument],
      examples: ["relay inbox revoke member --confirm --json"],
      note: "Human-only. A revoked test inbox fails closed before a Run acquires a target.",
    }),
  ),
  mapped(
    "inbox.check",
    path("inbox check", ["key"], undefined, {
      summary: "Verify test inbox connectivity without exposing secrets or mail",
      argumentHelp: [keyArgument],
      examples: ["relay inbox check member --json"],
      note: "Reports metadata and connectivity status only; never credentials, subjects, bodies, or codes.",
    }),
  ),
];
