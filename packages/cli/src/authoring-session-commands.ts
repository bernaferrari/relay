import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

/** Live recording, Take editing, replay, and proposal lifecycle commands. */
export const authoringSessionCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped("authoring.session.list", path("session list")),
  mapped(
    "authoring.session.get",
    path("session get", ["sessionId"]),
    path("proposal get", ["sessionId"], undefined, {
      summary: "Get a recording proposal",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.create",
    path("session create", [], undefined, {
      summary: "Start a recording session on an App Map and device",
      inputHelp: [
        { name: "appMapId", type: "string", required: true, description: "App Map identifier" },
        { name: "target", type: "object", required: true, description: "Device or browser target" },
        { name: "leaseId", type: "string", required: true, description: "Exclusive target lease" },
        {
          name: "expectedAppMapRevision",
          type: "number",
          required: true,
          description: "Current map revision",
        },
        {
          name: "sourceScreenId",
          type: "string",
          description: "Mapped source screen when automatic matching is uncertain",
        },
        {
          name: "pendingConnectionId",
          type: "string",
          description: "Existing connection this recording should complete",
        },
        {
          name: "group",
          type: "string",
          description: "Optional visual Group for newly captured screens",
        },
      ],
    }),
    path("proposal create", [], undefined, {
      summary: "Create a proposal attached to an App Map and device",
      inputHelp: [
        { name: "appMapId", type: "string", required: true, description: "App Map identifier" },
        { name: "target", type: "object", required: true, description: "Device or browser target" },
        { name: "leaseId", type: "string", required: true, description: "Exclusive target lease" },
        {
          name: "expectedAppMapRevision",
          type: "number",
          required: true,
          description: "Current map revision",
        },
        {
          name: "sourceScreenId",
          type: "string",
          description: "Mapped source screen when automatic matching is uncertain",
        },
        {
          name: "pendingConnectionId",
          type: "string",
          description: "Existing connection this proposal should complete",
        },
        {
          name: "group",
          type: "string",
          description: "Optional visual Group for newly captured screens",
        },
      ],
    }),
  ),
  mapped(
    "authoring.session.begin",
    path("session begin", [], undefined, {
      summary: "Create a session, observe the target, and start recording",
    }),
    path("proposal begin", [], undefined, {
      summary: "Begin a ready-to-record proposal in one operation",
      inputHelp: [
        { name: "appMapId", type: "string", required: true, description: "App Map identifier" },
        { name: "target", type: "object", required: true, description: "Device or browser target" },
        { name: "leaseId", type: "string", required: true, description: "Exclusive target lease" },
        {
          name: "expectedAppMapRevision",
          type: "number",
          required: true,
          description: "Current map revision",
        },
        {
          name: "sourceScreenId",
          type: "string",
          description: "Mapped source screen when automatic matching is uncertain",
        },
        {
          name: "pendingConnectionId",
          type: "string",
          description: "Existing connection this proposal should complete",
        },
        { name: "group", type: "string", description: "Optional visual Group" },
      ],
    }),
  ),
  mapped(
    "authoring.session.observe",
    path("session observe", ["sessionId"]),
    path("proposal observe", ["sessionId"], undefined, {
      summary: "Capture the proposal's current device state",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.capture",
    path("session capture", ["sessionId"], undefined, {
      summary: "Capture one durable screen without starting video recording",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.start",
    path("session start", ["sessionId"]),
    path("proposal record", ["sessionId"], undefined, {
      summary: "Start recording a proposal",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.interact",
    path("session interact", ["sessionId"], undefined, {
      summary: "Perform an explicit interaction while recording",
      inputHelp: [
        {
          name: "interaction",
          type: "object",
          required: true,
          description: "Tap, type, swipe, key, wait, or screenshot interaction",
        },
      ],
    }),
    path("session tap", ["sessionId"], { interaction: { kind: "tap" } }),
    path("session type", ["sessionId"], { interaction: { kind: "type" } }),
    path("session swipe", ["sessionId"], { interaction: { kind: "swipe" } }),
    path("session back", ["sessionId"], { interaction: { kind: "key", key: "back" } }),
    path("session wait", ["sessionId"], { interaction: { kind: "wait" } }),
    path("session screenshot", ["sessionId"], { interaction: { kind: "screenshot" } }),
    path("proposal interact", ["sessionId"], undefined, {
      summary: "Perform an explicit interaction while recording",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
      inputHelp: [
        {
          name: "interaction",
          type: "object",
          required: true,
          description: "Authoring interaction",
        },
      ],
    }),
    path(
      "proposal tap",
      ["sessionId"],
      { interaction: { kind: "tap" } },
      {
        summary: "Tap while recording",
        argumentHelp: [
          { name: "proposalId", type: "string", description: "Authoring session identifier" },
        ],
        inputHelp: [
          {
            name: "interaction.target",
            type: "object",
            required: true,
            description:
              "Semantic target or coordinates; point.relativeTo anchors an exact offset inside a stable element",
          },
        ],
      },
    ),
    path(
      "proposal type",
      ["sessionId"],
      { interaction: { kind: "type" } },
      {
        summary: "Enter text while recording",
        argumentHelp: [
          { name: "proposalId", type: "string", description: "Authoring session identifier" },
        ],
        inputHelp: [
          {
            name: "interaction.text",
            type: "string",
            required: true,
            description: "Text to enter",
          },
        ],
      },
    ),
    path(
      "proposal swipe",
      ["sessionId"],
      { interaction: { kind: "swipe" } },
      {
        summary: "Swipe while recording",
        argumentHelp: [
          { name: "proposalId", type: "string", description: "Authoring session identifier" },
        ],
        inputHelp: [
          { name: "interaction.from", type: "object", required: true, description: "Start point" },
          { name: "interaction.to", type: "object", required: true, description: "End point" },
          {
            name: "interaction.durationMs",
            type: "number",
            description: "Optional gesture duration",
          },
        ],
      },
    ),
    path(
      "proposal back",
      ["sessionId"],
      { interaction: { kind: "key", key: "back" } },
      {
        summary: "Press Back while recording",
        argumentHelp: [
          { name: "proposalId", type: "string", description: "Authoring session identifier" },
        ],
      },
    ),
    path(
      "proposal wait",
      ["sessionId"],
      { interaction: { kind: "wait" } },
      {
        summary: "Wait while recording",
        argumentHelp: [
          { name: "proposalId", type: "string", description: "Authoring session identifier" },
        ],
        inputHelp: [
          {
            name: "interaction.ms",
            type: "number",
            required: true,
            description: "Wait duration in milliseconds",
          },
        ],
      },
    ),
    path(
      "proposal screenshot",
      ["sessionId"],
      { interaction: { kind: "screenshot" } },
      {
        summary: "Add a screenshot checkpoint",
        argumentHelp: [
          { name: "proposalId", type: "string", description: "Authoring session identifier" },
        ],
      },
    ),
    path(
      "proposal batch",
      ["sessionId"],
      { interaction: { kind: "steps" } },
      {
        summary: "Perform timing-sensitive steps as one recorded interaction",
        argumentHelp: [
          { name: "proposalId", type: "string", description: "Authoring session identifier" },
        ],
        inputHelp: [
          {
            name: "interaction.steps",
            type: "object[]",
            required: true,
            description: "Recipe steps executed in order without CLI round trips",
          },
          {
            name: "interaction.label",
            type: "string",
            description: "Human-readable task boundary for the recorded batch",
          },
        ],
      },
    ),
  ),
  mapped(
    "authoring.session.stop",
    path("session stop", ["sessionId"]),
    path("proposal stop", ["sessionId"], undefined, {
      summary: "Stop recording and open the proposal for review",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.take.trim",
    path("take trim", ["sessionId"]),
    path("proposal trim", ["sessionId"], undefined, {
      summary: "Trim recorded proposal actions or video",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
      inputHelp: [
        { name: "fromMs", type: "number", description: "Clip start in milliseconds" },
        { name: "toMs", type: "number", description: "Clip end in milliseconds" },
        { name: "actionIds", type: "string[]", description: "Actions to keep" },
      ],
    }),
  ),
  mapped(
    "authoring.take.reorder",
    path("take reorder", ["sessionId"]),
    path("proposal reorder", ["sessionId"], undefined, {
      summary: "Reorder proposal actions",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
      inputHelp: [
        {
          name: "actionIds",
          type: "string[]",
          required: true,
          description: "Action identifiers in desired order",
        },
      ],
    }),
  ),
  mapped(
    "authoring.take.replace",
    path("take replace", ["sessionId", "actionId"]),
    path("proposal replace", ["sessionId", "actionId"], undefined, {
      summary: "Replace one proposal action",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
        { name: "actionId", type: "string", description: "Recorded action identifier" },
      ],
      inputHelp: [
        {
          name: "interaction",
          type: "object",
          required: true,
          description: "Replacement interaction",
        },
      ],
    }),
  ),
  mapped(
    "authoring.take.replay",
    path("take replay", ["sessionId"]),
    path("session replay", ["sessionId"], undefined, {
      summary: "Replay the current Take on its device before committing",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
      examples: ["relay session replay authoring-123"],
      note: "Return the device to the recorded source screen first. An unedited live recording that landed on the expected screen can be committed without a second pass. Editing the Take still requires a passing replay.",
    }),
    path("proposal replay", ["sessionId"], undefined, {
      summary: "Replay a proposal on its device",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.commit",
    path("session commit", ["sessionId"], undefined, {
      summary: "Commit a demonstrated Take to the App Map",
      inputHelp: [
        {
          name: "destination",
          type: "object",
          description: "Existing screen, new screen, or end destination",
        },
        {
          name: "mode",
          type: "interaction | automatic | reusable",
          description: "Connection execution mode",
        },
      ],
    }),
    path("proposal accept", ["sessionId"], undefined, {
      summary: "Accept a proposal into the App Map",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
      inputHelp: [
        {
          name: "destination",
          type: "object",
          description: "Existing screen, new screen, or end destination",
        },
        {
          name: "mode",
          type: "interaction | automatic | reusable",
          description: "Connection execution mode",
        },
      ],
    }),
  ),
  mapped(
    "authoring.session.discard",
    path("session discard", ["sessionId"]),
    path("proposal discard", ["sessionId"], undefined, {
      summary: "Discard the current proposal take",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.cancel",
    path("session cancel", ["sessionId"]),
    path("proposal cancel", ["sessionId"], undefined, {
      summary: "Cancel a proposal",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.cleanup",
    path("session cleanup", ["sessionId"]),
    path("proposal cleanup", ["sessionId"], undefined, {
      summary: "Remove a finished proposal session",
      argumentHelp: [
        { name: "proposalId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
];
