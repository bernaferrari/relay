import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

/** Live recording, Take editing, replay, and commit commands. */
export const authoringSessionCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped("authoring.session.list", path("session list")),
  mapped(
    "authoring.session.get",
    path("session get", ["sessionId"], undefined, {
      summary: "Get a recording session",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.create",
    path("session create", [], undefined, {
      summary: "Start a Relay-controlled recording session on an App Map and device",
      inputHelp: [
        { name: "appMapId", type: "string", required: true, description: "App Map identifier" },
        { name: "target", type: "object", required: true, description: "Device or browser target" },
        {
          name: "originApplication",
          type: "string",
          description: "Explicit native application package or bundle identifier",
        },
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
  ),
  mapped(
    "authoring.session.begin",
    path("session begin", [], undefined, {
      summary: "Create a session, observe the target, and start Relay-controlled recording",
      inputHelp: [
        {
          name: "originApplication",
          type: "string",
          description: "Explicit native application package or bundle identifier",
        },
      ],
    }),
  ),
  mapped(
    "authoring.session.observe",
    path("session observe", ["sessionId"], undefined, {
      summary: "Capture the recording's current device state",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
    path("session start", ["sessionId"], undefined, {
      summary: "Start recording",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
    path(
      "session tap",
      ["sessionId"],
      { interaction: { kind: "tap" } },
      {
        summary: "Tap while recording",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
      "session type",
      ["sessionId"],
      { interaction: { kind: "type" } },
      {
        summary: "Enter text while recording",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
      "session swipe",
      ["sessionId"],
      { interaction: { kind: "swipe" } },
      {
        summary: "Swipe while recording",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
      "session back",
      ["sessionId"],
      { interaction: { kind: "key", key: "back" } },
      {
        summary: "Press Back while recording",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
        ],
      },
    ),
    path(
      "session wait",
      ["sessionId"],
      { interaction: { kind: "wait" } },
      {
        summary: "Wait while recording",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
      "session screenshot",
      ["sessionId"],
      { interaction: { kind: "screenshot" } },
      {
        summary: "Add a screenshot checkpoint",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
        ],
      },
    ),
    path(
      "session batch",
      ["sessionId"],
      { interaction: { kind: "steps" } },
      {
        summary: "Perform timing-sensitive steps as one recorded interaction",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
        ],
        inputHelp: [
          {
            name: "interaction.steps",
            type: "object[]",
            required: true,
            description: "Execution steps performed in order without CLI round trips",
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
    path("session stop", ["sessionId"], undefined, {
      summary: "Stop recording and open the Take for review",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.take.optimization.get",
    path("take optimize", ["sessionId"], undefined, {
      summary: "Review non-destructive raw-recording optimization suggestions",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
      note: "Suggestions never modify the Take. Apply reviewed edits explicitly, then replay to verify them.",
    }),
  ),
  mapped(
    "authoring.take.trim",
    path("take trim", ["sessionId"], undefined, {
      summary: "Trim recorded actions or video",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
    path("take reorder", ["sessionId"], undefined, {
      summary: "Reorder recording actions",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
    path("take replace", ["sessionId", "actionId"], undefined, {
      summary: "Replace one recording action",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
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
    path("take replay", ["sessionId"], undefined, {
      summary: "Replay a recording on its device",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
    path("session replay", ["sessionId"], undefined, {
      summary: "Replay the current Take on its device before committing",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
      examples: ["relay session replay authoring-123"],
      note: "Return the device to the recorded source screen first. An unedited live recording that landed on the expected screen can be committed without a second pass. Editing the Take still requires a passing replay.",
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
  ),
  mapped(
    "authoring.session.discard",
    path("session discard", ["sessionId"], undefined, {
      summary: "Discard the current recording take",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.cancel",
    path("session cancel", ["sessionId"], undefined, {
      summary: "Cancel a recording",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.cleanup",
    path("session cleanup", ["sessionId"], undefined, {
      summary: "Remove a finished recording session",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
];
