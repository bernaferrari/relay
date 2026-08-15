import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";
import { graphTestListPath } from "./test-commands.js";

/** App Map metadata, screens, connections, flows, and reusable graph assets. */
export const appMapAuthoringCommandDescriptors: readonly MappedOperationDescriptor[] = [
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
    path("state-set list", ["appMapId"], undefined, {
      summary: "List every saved modifier and its available values",
      examples: ["relay state-set list grok-android"],
    }),
    path("variable list", ["appMapId"]),
    graphTestListPath,
    path("run-matrix list", ["appMapId"], undefined, {
      summary: "List saved modifier × test plans",
      examples: ["relay run-matrix list grok-android"],
    }),
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
  mapped(
    "app-map.scroll-surface.capture",
    path("screen capture-scroll", ["appMapId", "screenId", "variantId"], undefined, {
      summary: "Capture one durable, decomposable full scrollable screen",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "screenId", type: "string", description: "Selected logical screen" },
        { name: "variantId", type: "string", description: "Target/locale-specific variant" },
      ],
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
          description: "Android or iOS device matching the selected variant",
        },
        {
          name: "leaseId",
          type: "string",
          required: true,
          description: "Exclusive control lease",
        },
        {
          name: "maxScrolls",
          type: "integer (1-6)",
          description: "Maximum downward scrolls; defaults to 4",
        },
      ],
      examples: [
        'relay screen capture-scroll grok settings settings-ja --input \'{"expectedRevision":12,"target":{"kind":"device","platform":"ios","targetId":"<serial>"},"leaseId":"<lease>","maxScrolls":6}\'',
      ],
      note: "Explicitly opts this stable product-owned variant into full-surface coverage. Dynamic, private, imported, feed, and history content should remain viewport-only. Raw PNG/tree pairs are canonical; the composite, merged tree, and manifest are derived without storing base64 in the App Map.",
    }),
  ),
  mapped(
    "app-map.teach",
    path("map teach", ["appMapId"], undefined, {
      summary: "Perform one tap or swipe, capture the destination, and connect it",
      argumentHelp: [{ name: "appMapId", type: "string", description: "App Map identifier" }],
      inputHelp: [
        {
          name: "target",
          type: "object",
          required: true,
          description: "Device or browser target",
        },
        {
          name: "leaseId",
          type: "string",
          required: true,
          description: "Exclusive control lease",
        },
        {
          name: "fromScreenId",
          type: "string",
          description: "Source screen when teaching a destination",
        },
        { name: "title", type: "string", description: "Destination screen title" },
        {
          name: "handoff",
          type: "{expectedApp,returnAction}",
          description:
            "Explicitly allow a semantic tap to enter another app and declare back or relaunch-source recovery.",
        },
        {
          name: "interaction",
          type: "object",
          description:
            "point, label, or identifier tap; or swipe {from,to,durationMs}. Omit to capture the current screen only.",
        },
        {
          name: "expectedRevision",
          type: "number",
          description: "Optional. Stale revisions retry against the latest map.",
        },
      ],
      examples: [
        'relay map teach settings --input \'{"target":{"kind":"device","platform":"android","targetId":"<serial>"},"leaseId":"<lease>","fromScreenId":"settings","title":"Connections","interaction":{"kind":"point","x":540,"y":1275}}\'',
        'relay map teach settings --input \'{"target":{"kind":"device","platform":"android","targetId":"<serial>"},"leaseId":"<lease>","fromScreenId":"settings-top","title":"Settings · Middle","label":"Scroll settings","interaction":{"kind":"swipe","from":{"x":540,"y":1720},"to":{"x":540,"y":620},"durationMs":280}}\'',
        'relay map teach settings --input \'{"target":{"kind":"device","platform":"android","targetId":"<serial>"},"leaseId":"<lease>","fromScreenId":"widget","title":"Add to home screen","interaction":{"kind":"label","label":"Add widget"},"handoff":{"expectedApp":"bitpit.launcher","returnAction":"back"}}\'',
      ],
      note: "One gesture: tap or swipe → capture destination → connect. Cross-app surfaces require an exact, reversible handoff declaration.",
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
];

/** Reusable routines and reviewable App Map proposals. */
export const appMapRoutineCommandDescriptors: readonly MappedOperationDescriptor[] = [
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
];
