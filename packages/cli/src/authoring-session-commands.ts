import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

/** Live recording, Take editing, replay, and commit commands. */
export const authoringSessionCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped("authoring.session.list", path("recording list")),
  mapped(
    "authoring.session.get",
    path("recording get", ["sessionId"], undefined, {
      summary: "Get a recording session",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.create",
    path("recording create", [], undefined, {
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
    path("recording begin", [], undefined, {
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
    path("recording observe", ["sessionId"], undefined, {
      summary: "Capture the recording's current device state",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.capture",
    path("recording capture", ["sessionId"], undefined, {
      summary: "Capture one durable screen without starting video recording",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.start",
    path("recording start", ["sessionId"], undefined, {
      summary: "Start recording",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.interact",
    path("recording interact", ["sessionId"], undefined, {
      summary: "Perform an explicit interaction while recording",
      inputHelp: [
        {
          name: "interaction",
          type: "object",
          required: true,
          description:
            'Tap, type, swipe, key, wait ({"kind":"wait","ms":500}), screenshot, or steps ({"kind":"steps","steps":[...]}: timing-sensitive steps as one recorded interaction)',
        },
      ],
    }),
    path(
      "recording tap",
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
      "recording type",
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
      "recording swipe",
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
      "recording back",
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
      "recording screenshot",
      ["sessionId"],
      { interaction: { kind: "screenshot" } },
      {
        summary: "Add a screenshot checkpoint",
        argumentHelp: [
          { name: "sessionId", type: "string", description: "Authoring session identifier" },
        ],
      },
    ),
  ),
  mapped(
    "authoring.session.stop",
    path("recording stop", ["sessionId"], undefined, {
      summary: "Stop recording and open the Take for review",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.take.optimization.get",
    path("recording optimize", ["sessionId"], undefined, {
      summary: "Review non-destructive raw-recording optimization suggestions",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
      note: "Suggestions never modify the Take. Apply reviewed edits explicitly, then replay to verify them.",
    }),
  ),
  mapped(
    "authoring.take.trim",
    path("recording trim", ["sessionId"], undefined, {
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
    path("recording reorder", ["sessionId"], undefined, {
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
    path("recording replace", ["sessionId", "actionId"], undefined, {
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
    path("recording replay", ["sessionId"], undefined, {
      summary: "Replay the current Take on its device before committing",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
      examples: ["relay recording replay authoring-123"],
      note: "Return the device to the recorded source screen first. An unedited live recording that landed on the expected screen can be committed without a second pass. Editing the Take still requires a passing replay.",
    }),
  ),
  mapped(
    "authoring.session.commit",
    path("recording commit", ["sessionId"], undefined, {
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
    path("recording discard", ["sessionId"], undefined, {
      summary: "Discard the current recording take",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.cancel",
    path("recording cancel", ["sessionId"], undefined, {
      summary: "Cancel a recording",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
  mapped(
    "authoring.session.cleanup",
    path("recording cleanup", ["sessionId"], undefined, {
      summary: "Remove a finished recording session",
      argumentHelp: [
        { name: "sessionId", type: "string", description: "Authoring session identifier" },
      ],
    }),
  ),
];
