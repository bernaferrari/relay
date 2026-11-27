import {
  commandPath as path,
  mappedOperation as mapped,
  type CliOperationDescriptor,
} from "./command-descriptors.js";

const keyArgument = {
  name: "key",
  type: "string",
  description: 'Saved sign-in key such as "member" (default: default)',
} as const;

const secretInputHelp = [
  { name: "appMapId", type: "string", required: true, description: "App this sign-in belongs to" },
  { name: "name", type: "string", required: true, description: "Human-readable account name" },
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
  {
    name: "usernameHint",
    type: "string",
    description: "Optional non-secret reminder shown in metadata",
  },
] as const;

/** Human saved-sign-in management. Save/rotate requests carry plaintext once;
 * responses and list output are metadata-only by contract. */
export const signInCommandDescriptors: readonly CliOperationDescriptor[] = [
  mapped(
    "sign-in.save",
    path("sign-in save", ["key"], undefined, {
      summary: "Save an encrypted username/password sign-in",
      argumentHelp: [keyArgument],
      inputHelp: secretInputHelp,
      examples: [
        'relay sign-in save member --input \'{"appMapId":"shop","name":"Member account","username":"person@example.com","password":"..."}\' --confirm --json',
      ],
      note: "Human-only. Plaintext is used once for encrypted local storage and is never returned.",
    }),
  ),
  mapped(
    "sign-in.rotate",
    path("sign-in rotate", ["key"], undefined, {
      summary: "Rotate a saved sign-in to a new secret revision",
      argumentHelp: [keyArgument],
      inputHelp: secretInputHelp.filter(({ name }) => name !== "appMapId" && name !== "name"),
      examples: [
        'relay sign-in rotate member --input \'{"username":"person@example.com","password":"..."}\' --confirm --json',
      ],
      note: "Human-only. Rotation creates a new exact revision; older revisions remain encrypted history.",
    }),
  ),
  mapped(
    "sign-in.list",
    path("sign-in list", [], undefined, {
      summary: "List saved sign-in metadata without secrets",
      examples: ["relay sign-in list --json"],
      note: "Metadata only. There is no command that reads or exports a saved secret.",
    }),
  ),
  mapped(
    "sign-in.revoke",
    path("sign-in revoke", ["key"], undefined, {
      summary: "Revoke a saved sign-in",
      argumentHelp: [keyArgument],
      examples: ["relay sign-in revoke member --confirm --json"],
      note: "Human-only. A revoked saved sign-in fails closed before a Run acquires a target.",
    }),
  ),
  mapped(
    "sign-in.resolve-check",
    path("sign-in resolve-check", ["key"], undefined, {
      summary: "Check whether a saved sign-in can resolve without exposing it",
      argumentHelp: [keyArgument],
      examples: ["relay sign-in resolve-check member --json"],
      note: "Reports metadata and environment-overlay status only; never the username or password.",
    }),
  ),
];
