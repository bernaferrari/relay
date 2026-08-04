import { operationDefinitions, type OperationId } from "@relay/protocol";
import { UsageError } from "./errors.js";

export type CliExclusionReason = "ui-only" | "internal" | "unsafe";

export type CommandBehavior = "event-stream" | "job-start-watch" | "job-watch" | "screenshot";

export type CommandArgumentHelp = {
  name: string;
  type: string;
  description: string;
};

export type CommandInputHelp = {
  name: string;
  type: string;
  required?: boolean;
  description: string;
};

export type CommandHelp = {
  summary?: string;
  argumentHelp?: readonly CommandArgumentHelp[];
  inputHelp?: readonly CommandInputHelp[];
  examples?: readonly string[];
  note?: string;
  behavior?: CommandBehavior;
};

export type CommandPathDescriptor = {
  command: string;
  arguments?: readonly string[];
  fixedInput?: Readonly<Record<string, unknown>>;
} & CommandHelp;

export type MappedOperationDescriptor = {
  operationId: OperationId;
  paths: readonly CommandPathDescriptor[];
};

export type ExcludedOperationDescriptor = {
  operationId: OperationId;
  exclusion: CliExclusionReason;
  reason: string;
};

export type CliOperationDescriptor = MappedOperationDescriptor | ExcludedOperationDescriptor;

const path = (
  command: string,
  arguments_: readonly string[] = [],
  fixedInput?: Readonly<Record<string, unknown>>,
  help: CommandHelp = {},
): CommandPathDescriptor => ({
  command,
  ...(arguments_.length ? { arguments: arguments_ } : {}),
  ...(fixedInput ? { fixedInput } : {}),
  ...help,
});

const mapped = (
  operationId: OperationId,
  ...paths: readonly CommandPathDescriptor[]
): MappedOperationDescriptor => ({ operationId, paths });

/**
 * The canonical human CLI vocabulary. This is routing metadata only: it may
 * construct an operation input, but it must never implement domain behavior.
 * Keep each registry operation in exactly one descriptor; aliases belong in
 * that descriptor's paths array.
 */
export const cliOperationDescriptors: readonly CliOperationDescriptor[] = [
  mapped("system.health.get", path("system health")),
  mapped("system.doctor.get", path("system doctor")),
  mapped(
    "system.audit.list",
    path("system audit list"),
    path("activity audit", [], undefined, {
      summary: "List operation audit records",
    }),
  ),
  mapped(
    "event.stream",
    path("system events follow", [], undefined, { behavior: "event-stream" }),
    path("activity follow", [], undefined, {
      summary: "Follow live project activity",
      examples: ["relay activity follow --ndjson"],
      behavior: "event-stream",
    }),
  ),

  mapped("workspace.privacy.get", path("policy privacy get")),
  mapped("workspace.privacy.update", path("policy privacy update")),
  mapped("workspace.evidence.get", path("policy evidence get")),
  mapped("workspace.evidence.update", path("policy evidence update")),
  mapped("workspace.apple-device.update", path("workspace apple-device update")),
  mapped("workspace.variables.get", path("data variables get")),
  mapped("workspace.variables.update", path("data variables update")),

  mapped("target.actions.list", path("action list")),
  mapped(
    "target.devices.list",
    path("target device list"),
    path("device list", [], undefined, {
      summary: "List connected devices",
      examples: ["relay device list"],
    }),
  ),
  mapped("target.list", path("target list")),
  mapped("target.create", path("target create")),
  mapped("target.delete", path("target delete", ["targetId"])),
  mapped("target.preflight", path("target preflight", ["targetId"])),
  mapped("target.open", path("target open", ["targetId"])),
  mapped(
    "target.boot",
    path("target boot", ["serial"]),
    path("device boot", ["serial"], undefined, {
      summary: "Boot a device",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
  ),
  mapped(
    "target.authorize",
    path("target authorize", ["serial"]),
    path("device authorize", ["serial"], undefined, {
      summary: "Authorize a device for control",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
  ),
  mapped(
    "target.snapshot.capture",
    path("target observe", ["serial"]),
    path("target snapshot", ["serial"]),
    path("device observe", ["serial"], undefined, {
      summary: "Read the current accessibility structure",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
    path("device snapshot", ["serial"], undefined, {
      summary: "Read the current accessibility structure",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
  ),
  mapped(
    "target.screenshot.capture",
    path("target screenshot", ["serial"], undefined, { behavior: "screenshot" }),
    path("device screenshot", ["serial"], undefined, {
      summary: "Capture the current screen as PNG",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      examples: [
        "relay device screenshot emulator-5554 --file current.png",
        "relay device screenshot emulator-5554 --binary > current.png",
      ],
      note: "Use --file <path> for a PNG file or --binary for raw PNG bytes on stdout.",
      behavior: "screenshot",
    }),
  ),
  mapped(
    "target.app.launch",
    path("target app launch", ["serial", "app"]),
    path("device launch", ["serial", "app"], undefined, {
      summary: "Launch an app and make it the active device session",
      argumentHelp: [
        { name: "serial", type: "string", description: "Connected device serial" },
        { name: "app", type: "string", description: "App name, package, or bundle identifier" },
      ],
      inputHelp: [
        {
          name: "relaunch",
          type: "boolean",
          description: "Terminate first for a clean launch; defaults to false",
        },
      ],
      examples: [
        "relay device launch emulator-5554 com.example.app",
        "relay device launch 00008110 Settings",
      ],
    }),
  ),
  mapped(
    "target.recover",
    path("target recover", ["serial"]),
    path("device recover", ["serial"], undefined, {
      summary: "Repair an Apple device connection and restore its active app",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "reason",
          type: "connect | observe | control | record | auto",
          description: "Recovery phase for Activity attribution",
        },
      ],
      examples: ['relay device recover 00008110 --input \'{"reason":"control"}\''],
    }),
  ),
  mapped(
    "target.interact",
    path("target interact", ["serial"]),
    path("device interact", ["serial"], undefined, {
      summary: "Perform a semantic device interaction",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "kind",
          type: "identifier | label | point | ref | find | text-match | swipe | type",
          required: true,
          description: "Semantic interaction kind",
        },
      ],
      examples: [
        "relay lease create 00008110 --actor agent:mapper",
        'relay device interact 00008110 --actor agent:mapper --input \'{"kind":"label","label":"Continue"}\'',
      ],
      note: "Device input requires an active exclusive lease owned by the same --actor. Observation and screenshots remain shareable.",
    }),
  ),
  mapped(
    "target.touch",
    path("target touch", ["serial"]),
    path("device touch", ["serial"], undefined, {
      summary: "Send a low-level touch event",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "action",
          type: "down | move | up | cancel",
          required: true,
          description: "Touch phase",
        },
        { name: "x", type: "number", required: true, description: "Normalized x coordinate" },
        { name: "y", type: "number", required: true, description: "Normalized y coordinate" },
      ],
      note: "Requires an active exclusive lease owned by the same --actor. Create one with relay lease create <serial> --actor <id>.",
    }),
  ),
  mapped(
    "target.key",
    path("target key", ["serial"]),
    path("device key", ["serial"], undefined, {
      summary: "Send a device key",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "kind",
          type: "text | key",
          required: true,
          description: "Keyboard input kind",
        },
        { name: "text", type: "string", description: "Required when kind is text" },
        { name: "key", type: "enter | backspace", description: "Required when kind is key" },
      ],
      note: "Requires an active exclusive lease owned by the same --actor. Create one with relay lease create <serial> --actor <id>.",
    }),
  ),
  mapped(
    "target.scroll",
    path("target scroll", ["serial"]),
    path("device scroll", ["serial"], undefined, {
      summary: "Scroll the current device screen",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        { name: "x", type: "number", required: true, description: "Gesture origin x" },
        { name: "y", type: "number", required: true, description: "Gesture origin y" },
        { name: "scrollX", type: "number", required: true, description: "Horizontal delta" },
        { name: "scrollY", type: "number", required: true, description: "Vertical delta" },
      ],
      note: "Requires an active exclusive lease owned by the same --actor. Create one with relay lease create <serial> --actor <id>.",
    }),
  ),
  mapped(
    "target.video.start",
    path("target video", ["serial"]),
    path("device video", ["serial"], undefined, {
      summary: "Record device video",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "action",
          type: "start | stop",
          required: true,
          description: "Recording action (Apple devices)",
        },
      ],
    }),
  ),

  mapped("project.list", path("project list")),
  mapped("project.save", path("project save")),
  mapped("build.list", path("build list")),
  mapped("build.save", path("build save")),
  mapped("build.preflight", path("build preflight", ["buildId"])),
  mapped("build.install", path("build install", ["buildId", "serial"])),
  mapped("build.launch", path("build launch", ["buildId", "serial"])),
  mapped("device-pool.list", path("device-pool list")),
  mapped("device-pool.save", path("device-pool save")),
  mapped("device-pool.preflight", path("device-pool preflight", ["poolId"])),
  mapped("target-worker.list", path("target worker list")),
  mapped(
    "lease.list",
    path(
      "lease list",
      [],
      { status: "active" },
      {
        summary: "List active target leases",
      },
    ),
    path(
      "lease history",
      [],
      { status: "all" },
      {
        summary: "List active and historical target leases",
      },
    ),
  ),
  mapped(
    "lease.create",
    path(
      "lease create",
      ["deviceSerial"],
      { poolId: "local" },
      {
        summary: "Take exclusive control of a local device for 15 minutes",
        argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
        inputHelp: [
          {
            name: "expiresAt",
            type: "number",
            description: "Optional Unix time in milliseconds; defaults to 15 minutes from now",
          },
        ],
        examples: [
          "relay lease create 00008110 --actor human:bernardo",
          "relay lease create emulator-5554 --actor agent:mapper --json",
        ],
        note: "Use the same --actor for subsequent device input. Read-only observation and screenshots do not require a lease.",
      },
    ),
    path("lease create-in-pool", ["poolId", "deviceSerial"], undefined, {
      summary: "Take exclusive control of a device from a named pool for 15 minutes",
      argumentHelp: [
        { name: "pool", type: "string", description: "Device-pool identifier" },
        { name: "serial", type: "string", description: "Connected device serial" },
      ],
      inputHelp: [
        {
          name: "expiresAt",
          type: "number",
          description: "Optional Unix time in milliseconds; defaults to 15 minutes from now",
        },
      ],
      examples: ["relay lease create-in-pool cloud-ios iphone-16 --actor agent:mapper"],
    }),
  ),
  mapped(
    "lease.takeover",
    path("lease takeover", ["leaseId"], undefined, {
      summary: "Explicitly take control from an observed active lease",
      argumentHelp: [
        { name: "leaseId", type: "string", description: "Exact active lease to replace" },
      ],
      inputHelp: [
        {
          name: "expiresAt",
          type: "number",
          description: "Optional new lease expiry; defaults to 15 minutes from now",
        },
        { name: "reason", type: "string", required: true, description: "Auditable handoff reason" },
        { name: "confirm", type: "true", required: true, description: "Explicit user approval" },
      ],
    }),
  ),
  mapped("lease.release", path("lease release", ["leaseId"])),

  mapped(
    "app-map.list",
    path("map list", [], undefined, {
      summary: "List App Maps",
      examples: ["relay map list"],
    }),
  ),
  mapped(
    "app-map.get",
    path("map get", ["appMapId"], undefined, {
      summary: "Inspect an App Map",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      examples: ["relay map get checkout"],
    }),
    path("screen list", ["appMapId"]),
    path("connection list", ["appMapId"]),
    path("connect list", ["appMapId"]),
    path("flow list", ["appMapId"]),
    path("routine list", ["appMapId"]),
    path("proposal list", ["appMapId"]),
  ),
  mapped(
    "app-map.create",
    path("map create", ["appMapId"], undefined, {
      summary: "Create an empty App Map",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "Stable App Map identifier" },
      ],
      inputHelp: [{ name: "name", type: "string", required: true, description: "Map name" }],
      examples: ['relay map create checkout --input \'{"name":"Checkout"}\''],
    }),
  ),
  mapped(
    "app-map.duplicate",
    path("map duplicate", ["sourceAppMapId", "appMapId"], undefined, {
      summary: "Duplicate an App Map without copying run history",
      argumentHelp: [
        { name: "sourceAppMapId", type: "string", description: "Source App Map identifier" },
        { name: "appMapId", type: "string", description: "New App Map identifier" },
      ],
      inputHelp: [{ name: "name", type: "string", description: "Optional copy name" }],
      examples: ["relay map duplicate checkout checkout-copy"],
    }),
  ),
  mapped(
    "app-map.remove",
    path("map delete", ["appMapId"], undefined, {
      summary: "Delete an App Map",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
    }),
  ),
  mapped(
    "app-map.export",
    path("map export", ["appMapId"], undefined, {
      summary: "Export deterministic App Map YAML",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      examples: ["relay map export checkout --json"],
    }),
  ),
  mapped(
    "app-map.import",
    path("map import", [], undefined, {
      summary: "Import an App Map",
      inputHelp: [
        { name: "yaml", type: "string", required: true, description: "Portable App Map YAML" },
        { name: "dryRun", type: "boolean", description: "Validate without saving" },
        {
          name: "conflict",
          type: "reject | replace | copy",
          description: "How to handle an existing App Map",
        },
      ],
    }),
  ),
  mapped(
    "app-map.update",
    path("map update", ["appMapId"], undefined, {
      summary: "Update App Map metadata",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current revision",
        },
        {
          name: "patch",
          type: "object",
          required: true,
          description: "Name and/or description update",
        },
      ],
      examples: [
        'relay map update checkout --input \'{"expectedRevision":3,"patch":{"description":"Checkout coverage"}}\'',
      ],
    }),
  ),
  mapped(
    "app-map.commit",
    path("map commit", ["appMapId"], undefined, {
      summary: "Apply one atomic App Map revision",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current revision",
        },
        {
          name: "changes",
          type: "array",
          required: true,
          description: "Ordered screen, connection, Group, and flow changes",
        },
        { name: "patch", type: "object", description: "Optional map metadata or notes patch" },
        { name: "summary", type: "string", description: "Activity summary" },
      ],
    }),
  ),
  mapped(
    "app-map.screen.add",
    path("screen add", ["appMapId"], undefined, {
      summary: "Add a named screen without persistence metadata",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current revision",
        },
        {
          name: "screen.id",
          type: "string",
          required: true,
          description: "Stable screen identifier",
        },
        {
          name: "screen.title",
          type: "string",
          required: true,
          description: "Human-readable screen name",
        },
        { name: "screen.position", type: "{x,y}", description: "Optional canvas position" },
      ],
      examples: [
        'relay screen add checkout --input \'{"expectedRevision":2,"screen":{"id":"confirmation","title":"Confirmation","position":{"x":640,"y":240}}}\'',
      ],
    }),
  ),
  mapped(
    "app-map.screen.capture",
    path("screen capture", ["appMapId"], undefined, {
      summary: "Save the current target screen to an App Map",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "target",
          type: "object",
          required: true,
          description: "Explicit device or browser target",
        },
        {
          name: "leaseId",
          type: "string",
          required: true,
          description: "Exclusive control lease for the target",
        },
        { name: "title", type: "string", description: "Optional title for a new screen" },
        { name: "position", type: "{x,y}", description: "Optional initial canvas position" },
      ],
      examples: [
        'relay screen capture onboarding --input \'{"expectedRevision":0,"target":{"kind":"device","platform":"ios","targetId":"<serial>"},"leaseId":"<lease>"}\'',
      ],
    }),
  ),
  mapped("app-map.screen.update", path("screen update", ["appMapId", "screenId"])),
  mapped("app-map.screen.remove", path("screen remove", ["appMapId", "screenId"])),
  mapped(
    "app-map.connection.create",
    path("connect create", ["appMapId"], undefined, {
      summary: "Connect two screens with optional replayable actions",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current revision",
        },
        {
          name: "connection.id",
          type: "string",
          required: true,
          description: "Stable connection identifier",
        },
        {
          name: "connection.fromScreenId",
          type: "string",
          required: true,
          description: "Source screen",
        },
        {
          name: "connection.destination",
          type: "{kind,screenId?}",
          required: true,
          description: "Screen or end destination",
        },
        { name: "connection.label", type: "string", description: "Action-oriented label" },
        {
          name: "connection.actions",
          type: "array",
          description: "Optional declarative or recorded actions",
        },
      ],
      examples: [
        'relay connect create checkout --input \'{"expectedRevision":3,"connection":{"id":"submit-order","fromScreenId":"cart","destination":{"kind":"screen","screenId":"confirmation"},"label":"Submit order"}}\'',
      ],
    }),
  ),
  mapped(
    "app-map.connection.update",
    path("connect update", ["appMapId", "connectionId"]),
    path("connection update", ["appMapId", "connectionId"]),
  ),
  mapped("app-map.connection.remove", path("connect remove", ["appMapId", "connectionId"])),
  mapped(
    "app-map.connection.run",
    path("connect run", ["appMapId", "connectionId"], undefined, {
      summary: "Replay one saved connection and verify its destination",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "connectionId", type: "string", description: "Saved connection identifier" },
      ],
      inputHelp: [
        { name: "serial", type: "string", description: "Device serial" },
        { name: "platform", type: "android | ios", description: "Device platform" },
      ],
      examples: ['relay connect run settings open-connections --input \'{"serial":"device-id"}\''],
      behavior: "job-start-watch",
    }),
  ),
  mapped("app-map.group.save", path("group save", ["appMapId", "groupId"])),
  mapped("app-map.group.remove", path("group remove", ["appMapId", "groupId"])),
  mapped(
    "app-map.flow.save",
    path("flow save", ["appMapId", "flowId"], undefined, {
      summary: "Save a reusable path; Relay owns scope and timestamps",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "flowId", type: "string", description: "Stable flow identifier" },
      ],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current revision",
        },
        {
          name: "flow.name",
          type: "string",
          required: true,
          description: "Human-readable flow name",
        },
        {
          name: "flow.startScreenId",
          type: "string",
          required: true,
          description: "Starting screen",
        },
        {
          name: "flow.connectionIds",
          type: "string[]",
          required: true,
          description: "Ordered connection path",
        },
        {
          name: "flow.setup",
          type: "{routineId,bindings?}",
          description: "Optional auditable Routine to reach the entry screen before verification",
        },
      ],
      examples: [
        'relay flow save checkout purchase --input \'{"expectedRevision":4,"flow":{"name":"Purchase","startScreenId":"cart","connectionIds":["submit-order"]}}\'',
      ],
    }),
  ),
  mapped("app-map.flow.remove", path("flow remove", ["appMapId", "flowId"])),
  mapped("app-map.case-stack.save", path("case-stack save", ["appMapId", "caseStackId"])),
  mapped(
    "app-map.case-stack.attach",
    path("case-stack apply", ["appMapId", "connectionId", "caseStackId"]),
  ),
  mapped("app-map.case-stack.remove", path("case-stack remove", ["appMapId", "caseStackId"])),
  mapped(
    "app-map.flow.run",
    path("flow run", ["appMapId", "flowId"], undefined, {
      summary: "Run a saved App Map flow",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "flowId", type: "string", description: "Saved flow identifier" },
      ],
      inputHelp: [
        { name: "serial", type: "string", description: "Device serial" },
        { name: "platform", type: "android | ios", description: "Device platform" },
      ],
      examples: ['relay flow run checkout main --input \'{"serial":"emulator-5554"}\''],
      behavior: "job-start-watch",
    }),
  ),
  mapped(
    "app-map.routine.save",
    path("routine save", ["appMapId", "routineId"], undefined, {
      summary: "Save reusable actions without persistence metadata",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "routineId", type: "string", description: "Stable Routine identifier" },
      ],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current revision",
        },
        {
          name: "routine.name",
          type: "string",
          required: true,
          description: "Human-readable Routine name",
        },
        {
          name: "routine.actions",
          type: "array",
          required: true,
          description: "Reusable action specifications",
        },
      ],
      examples: [
        'relay routine save grok start-clean --input \'{"expectedRevision":5,"routine":{"name":"Start clean","actions":[{"id":"new","kind":"tap","target":{"identifier":"grok-compose"}}]}}\'',
      ],
    }),
  ),
  mapped("app-map.routine.remove", path("routine remove", ["appMapId", "routineId"])),
  mapped("app-map.proposal.submit", path("proposal submit", ["appMapId"])),
  mapped(
    "app-map.observations.propose",
    path("proposal from-observations", ["appMapId", "sessionId"], undefined, {
      summary: "Turn observed device paths into a reviewable proposal",
    }),
  ),
  mapped("app-map.proposal.approve", path("proposal approve", ["appMapId", "proposalId"])),
  mapped("app-map.proposal.reject", path("proposal reject", ["appMapId", "proposalId"])),

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
            description: "Semantic target or coordinates",
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
      summary: "Commit a successfully replayed recording to the App Map",
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

  mapped("schedule.list", path("schedule list")),
  mapped("schedule.create", path("schedule create")),
  mapped("schedule.delete", path("schedule delete", ["scheduleId"])),
  mapped("matrix.list", path("matrix list")),
  mapped("matrix.create", path("matrix create")),
  mapped("matrix.update", path("matrix update", ["matrixId"])),
  mapped("matrix.delete", path("matrix delete", ["matrixId"])),
  mapped("matrix.import", path("matrix import")),
  mapped("matrix.resolve", path("matrix resolve", ["matrixId"])),

  mapped("discovery.list", path("discovery list")),
  mapped("discovery.create", path("discovery create")),
  mapped("discovery.rename", path("discovery rename", ["sessionId"])),
  mapped("discovery.status.update", path("discovery status update", ["sessionId"])),
  mapped("discovery.capture", path("discovery capture", ["sessionId", "serial"])),
  mapped("discovery.interact", path("discovery interact", ["sessionId", "serial"])),
  mapped("discovery.promote", path("discovery promote", ["sessionId"])),

  mapped("job.list", path("job list")),
  mapped(
    "job.get",
    path("job get", ["jobId"]),
    path("job watch", ["jobId"], undefined, { behavior: "job-watch" }),
    path("run watch", ["jobId"], undefined, {
      summary: "Watch an execution job until it finishes",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
      behavior: "job-watch",
    }),
  ),
  mapped(
    "job.start",
    path("job start"),
    path("run start", ["recipe"], undefined, {
      summary: "Start an execution job",
      argumentHelp: [
        { name: "recipe", type: "string", description: "Compiled Flow recipe identifier" },
      ],
      inputHelp: [{ name: "serial", type: "string", description: "Optional target device serial" }],
    }),
  ),
  mapped(
    "job.retry",
    path("job retry", ["jobId"]),
    path("run retry", ["jobId"], undefined, {
      summary: "Retry an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.cancel",
    path("job cancel", ["jobId"]),
    path("run cancel", ["jobId"], undefined, {
      summary: "Cancel an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.pause",
    path("job pause", ["jobId"]),
    path("run pause", ["jobId"], undefined, {
      summary: "Pause an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped(
    "job.resume",
    path("job resume", ["jobId"]),
    path("run resume", ["jobId"], undefined, {
      summary: "Resume an execution job",
      argumentHelp: [{ name: "jobId", type: "string", description: "Execution job identifier" }],
    }),
  ),
  mapped("job.active.cancel", path("job active cancel")),
  mapped("job.matrix.start", path("job matrix start")),
  mapped("job.compatibility-matrix.start", path("job compatibility-matrix start")),
  mapped("job.soak.start", path("job soak start")),

  ...(
    [
      "recipe.list",
      "recipe.get",
      "recipe.create",
      "recipe.update",
      "recipe.delete",
      "recipe.yaml.get",
      "recipe.import",
      "recipe.evidence.create",
      "recipe.history.list",
      "recipe.history.restore",
      "recipe.stability.get",
    ] as const
  ).map((operationId) => ({
    operationId,
    exclusion: "internal" as const,
    reason: "Compiled recipe storage is internal; people and agents author App Map flows.",
  })),

  mapped("run.list", path("run list")),
  {
    operationId: "run.get",
    exclusion: "internal",
    reason: "Exposed through the read-only `relay run get` resource command.",
  },
  {
    operationId: "run.evidence.get",
    exclusion: "internal",
    reason: "Exposed through the read-only `relay run evidence` resource command.",
  },
  mapped("run.catalog.rebuild", path("run catalog rebuild")),
  mapped("run.retention.apply", path("run retention apply")),
  mapped(
    "run.visual-baseline.update",
    path("run visual-baseline update", ["runId"], { action: "approve-new-baseline" }),
    path(
      "run approve",
      ["runId"],
      { action: "approve-new-baseline" },
      {
        summary: "Approve a run as the visual baseline",
        argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      },
    ),
  ),
  mapped("run.visual.compare", path("run visual compare", ["runId"])),
  mapped("run.visual.review", path("run visual review", ["runId"])),
  mapped("run.visual-policy.get", path("run visual-policy get", ["runId"])),
  mapped("run.visual-policy.update", path("run visual-policy update", ["runId"])),
  mapped(
    "run.pin.update",
    path("run pin update", ["runId"]),
    path("run pin", ["runId"], undefined, {
      summary: "Pin or unpin a run",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [{ name: "pinned", type: "boolean", description: "Defaults to true" }],
    }),
  ),
  mapped("step.run", path("run step", ["serial"])),
  mapped("generation.create", path("generation create")),
  mapped(
    "action.run",
    path("action run", ["actionId", "serial"]),
    path("routine run", ["actionId", "serial"], undefined, {
      summary: "Run a reusable routine on a device",
      argumentHelp: [
        { name: "routineId", type: "string", description: "Reusable action identifier" },
        { name: "serial", type: "string", description: "Connected device serial" },
      ],
      examples: ["relay routine run login emulator-5554"],
    }),
  ),
];

export type CliResourceDescriptor = {
  resourceId: string;
  label: string;
  path: CommandPathDescriptor;
  resourcePath(input: Readonly<Record<string, unknown>>): string;
};

function noResourceInput(input: Readonly<Record<string, unknown>>, path: string): void {
  if (Object.keys(input).length > 0) throw new UsageError(`${path} does not accept --input fields`);
}

function runResource(command: string, suffix: string, summary: string): CliResourceDescriptor {
  return {
    resourceId: command.replace(" ", "."),
    label: summary,
    path: path(command, ["runId"], undefined, {
      summary,
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
    }),
    resourcePath(input) {
      const runId = input.runId;
      if (typeof runId !== "string") throw new UsageError(`${command} requires <runId>`);
      const extra = { ...input };
      delete extra.runId;
      noResourceInput(extra, command);
      return `/runs/${encodeURIComponent(runId)}${suffix}`;
    },
  };
}

export const cliResourceDescriptors: readonly CliResourceDescriptor[] = [
  runResource("run get", "", "Get a persisted run and its evidence"),
  {
    resourceId: "run.evidence",
    label: "Get bounded structured run evidence",
    path: path("run evidence", ["runId"], undefined, {
      summary: "Inspect logs, network, performance, and collector status",
      argumentHelp: [{ name: "runId", type: "string", description: "Persisted run identifier" }],
      inputHelp: [
        { name: "limit", type: "number", description: "Maximum entries per evidence channel" },
        {
          name: "includeBodies",
          type: "boolean",
          description: "Include consented request/response bodies",
        },
      ],
      examples: ["relay run evidence <run-id> --input '{\"limit\":200}'"],
    }),
    resourcePath(input) {
      const runId = input.runId;
      if (typeof runId !== "string" || !runId)
        throw new UsageError("run evidence requires <runId>");
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        if (
          !Number.isInteger(input.limit) ||
          Number(input.limit) < 1 ||
          Number(input.limit) > 2_000
        ) {
          throw new UsageError("run evidence limit must be an integer between 1 and 2000");
        }
        query.set("limit", String(input.limit));
      }
      if (input.includeBodies !== undefined) {
        if (typeof input.includeBodies !== "boolean") {
          throw new UsageError("run evidence includeBodies must be boolean");
        }
        if (input.includeBodies) query.set("includeBodies", "true");
      }
      const unknown = Object.keys(input).filter(
        (key) => !["runId", "limit", "includeBodies"].includes(key),
      );
      if (unknown.length)
        throw new UsageError(`run evidence does not accept: ${unknown.join(", ")}`);
      const suffix = query.size ? `?${query.toString()}` : "";
      return `/runs/${encodeURIComponent(runId)}/evidence${suffix}`;
    },
  },
  runResource("run signals", "/signals", "Get regression signals for a run"),
  runResource("run compare", "/visual-baseline", "Compare a run with its visual baseline"),
  {
    resourceId: "activity.list",
    label: "List durable project activity",
    path: path("activity list", [], undefined, {
      summary: "List durable human, agent, and system activity",
      inputHelp: [
        { name: "limit", type: "number", description: "Positive page size" },
        { name: "cursor", type: "string", description: "Cursor returned by the previous page" },
      ],
      examples: ["relay activity list --input '{\"limit\":50}'"],
    }),
    resourcePath(input) {
      const query = new URLSearchParams();
      if (input.limit !== undefined) {
        if (!Number.isInteger(input.limit) || Number(input.limit) < 1) {
          throw new UsageError("activity list limit must be a positive integer");
        }
        query.set("limit", String(input.limit));
      }
      if (input.cursor !== undefined) {
        if (typeof input.cursor !== "string" || !input.cursor) {
          throw new UsageError("activity list cursor must be a non-empty string");
        }
        query.set("cursor", input.cursor);
      }
      const unknown = Object.keys(input).filter((key) => key !== "limit" && key !== "cursor");
      if (unknown.length)
        throw new UsageError(`activity list does not accept: ${unknown.join(", ")}`);
      const encoded = query.toString();
      return `/activity${encoded ? `?${encoded}` : ""}`;
    },
  },
];

export const mappedCommandDescriptors = cliOperationDescriptors.filter(
  (descriptor): descriptor is MappedOperationDescriptor => "paths" in descriptor,
);

const operationById = new Map(
  operationDefinitions.map((definition) => [definition.id, definition]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecords(
  base: Readonly<Record<string, unknown>>,
  overlay: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeRecords(current, value) : value;
  }
  return result;
}

function setInputPath(input: Record<string, unknown>, keyPath: string, value: string): void {
  const keys = keyPath.split(".");
  let current = input;
  for (const key of keys.slice(0, -1)) {
    const existing = current[key];
    const next = isRecord(existing) ? { ...existing } : {};
    current[key] = next;
    current = next;
  }
  current[keys.at(-1)!] = value;
}

export type ResolvedCommand = {
  operationId: OperationId;
  commandPath: string;
  input: Record<string, unknown>;
  behavior?: CommandBehavior;
};

export type ResolvedResourceCommand = {
  resourceId: string;
  commandPath: string;
  resourcePath: string;
};

export function resolveCommand(
  positionals: readonly string[],
  input: Readonly<Record<string, unknown>> = {},
): ResolvedCommand {
  for (const descriptor of mappedCommandDescriptors) {
    for (const candidate of descriptor.paths) {
      const tokens = candidate.command.split(" ");
      const argumentKeys = candidate.arguments ?? [];
      if (positionals.length !== tokens.length + argumentKeys.length) continue;
      if (!tokens.every((token, index) => positionals[index] === token)) continue;

      let constructed = mergeRecords({}, input);
      if (candidate.fixedInput) constructed = mergeRecords(constructed, candidate.fixedInput);
      argumentKeys.forEach((key, index) => {
        setInputPath(constructed, key, positionals[tokens.length + index]!);
      });
      return {
        operationId: descriptor.operationId,
        commandPath: candidate.command,
        input: constructed,
        ...(candidate.behavior ? { behavior: candidate.behavior } : {}),
      };
    }
  }

  const incomplete = mappedCommandDescriptors
    .flatMap((descriptor) => descriptor.paths)
    .map((candidate) => ({ candidate, tokens: candidate.command.split(" ") }))
    .filter(({ tokens }) => tokens.every((token, index) => positionals[index] === token))
    .sort((left, right) => right.tokens.length - left.tokens.length)[0];
  if (incomplete) {
    const argumentKeys = incomplete.candidate.arguments ?? [];
    const providedArguments = Math.max(0, positionals.length - incomplete.tokens.length);
    const missingArguments = argumentKeys.slice(providedArguments);
    if (missingArguments.length) {
      const required = missingArguments
        .map((key, index) => {
          const help = incomplete.candidate.argumentHelp?.[providedArguments + index];
          return `<${help?.name ?? key.split(".").at(-1)}>`;
        })
        .join(", ");
      throw new UsageError(`${incomplete.candidate.command} requires ${required}`);
    }
    throw new UsageError(`Expected: relay ${formatCommandUsage(incomplete.candidate)}`);
  }

  const family = positionals[0];
  const familyPaths = mappedCommandDescriptors.flatMap((descriptor) =>
    descriptor.paths.filter((candidate) => candidate.command.split(" ")[0] === family),
  );
  if (familyPaths.length) {
    const usages = familyPaths
      .slice(0, 4)
      .map((candidate) => formatCommandUsage(candidate))
      .join(", ");
    throw new UsageError(`Invalid ${family} command. Expected one of: ${usages}`);
  }
  throw new UsageError(`Unknown command: ${positionals.join(" ")}. Run 'relay help'.`);
}

export function resolveResourceCommand(
  positionals: readonly string[],
  input: Readonly<Record<string, unknown>> = {},
): ResolvedResourceCommand | undefined {
  for (const descriptor of cliResourceDescriptors) {
    const candidate = descriptor.path;
    const tokens = candidate.command.split(" ");
    const argumentKeys = candidate.arguments ?? [];
    if (positionals.length !== tokens.length + argumentKeys.length) continue;
    if (!tokens.every((token, index) => positionals[index] === token)) continue;

    const constructed = mergeRecords({}, input);
    argumentKeys.forEach((key, index) => {
      setInputPath(constructed, key, positionals[tokens.length + index]!);
    });
    return {
      resourceId: descriptor.resourceId,
      commandPath: candidate.command,
      resourcePath: descriptor.resourcePath(constructed),
    };
  }

  const incomplete = cliResourceDescriptors
    .map((descriptor) => ({ descriptor, tokens: descriptor.path.command.split(" ") }))
    .filter(({ tokens }) => tokens.every((token, index) => positionals[index] === token))
    .sort((left, right) => right.tokens.length - left.tokens.length)[0];
  if (incomplete) {
    const argumentKeys = incomplete.descriptor.path.arguments ?? [];
    const providedArguments = Math.max(0, positionals.length - incomplete.tokens.length);
    const missingArguments = argumentKeys.slice(providedArguments);
    if (missingArguments.length) {
      const required = missingArguments
        .map((key, index) => {
          const help = incomplete.descriptor.path.argumentHelp?.[providedArguments + index];
          return `<${help?.name ?? key.split(".").at(-1)}>`;
        })
        .join(", ");
      throw new UsageError(`${incomplete.descriptor.path.command} requires ${required}`);
    }
  }
  return undefined;
}

export function formatCommandUsage(descriptor: CommandPathDescriptor): string {
  const arguments_ = (descriptor.arguments ?? [])
    .map((key, index) => `<${descriptor.argumentHelp?.[index]?.name ?? key.split(".").at(-1)}>`)
    .join(" ");
  return `${descriptor.command}${arguments_ ? ` ${arguments_}` : ""}`;
}

export function operationLabel(operationId: OperationId): string {
  return operationById.get(operationId)?.label ?? operationId;
}
