import {
  commandPath as path,
  mappedOperation as mapped,
  type CommandPathDescriptor,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

export const graphTestListPath: CommandPathDescriptor = path("test list", ["appMapId"], undefined, {
  summary: "List reusable tests and their screenshot policies",
  examples: ["relay test list grok-android"],
});

/**
 * Graph-native Test authoring and execution commands. Keep this order aligned
 * with the user workflow: create, edit, propose, inspect, run, then remove.
 */
export const graphTestCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped(
    "app-map.test.save",
    path("test save", ["appMapId", "testId"], undefined, {
      summary: "Save a graph-native scenario Test",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "test",
          type: "object",
          required: true,
          description:
            "Test name and graph steps; kind must be scenario with intentSchemaVersion 1",
        },
        {
          name: "eventId",
          type: "string",
          description: "Stable idempotency key for safe retries",
        },
      ],
      examples: [
        'relay test save checkout smoke --input \'{"expectedRevision":7,"eventId":"create-smoke-v1","test":{"name":"Checkout smoke","kind":"scenario","intentSchemaVersion":1,"steps":[{"id":"submit-order","kind":"instruction","intent":"Submit the reviewed order","binding":{"status":"unresolved","reason":"Choose a mapped checkout connection"}}]}}\'',
      ],
      note: "Use `relay test propose` for reviewable edits to an existing Test. Stable step IDs survive reordering.",
    }),
  ),
  mapped(
    "app-map.test.edit",
    path("test edit", ["appMapId", "testId"], undefined, {
      summary: "Apply atomic stable-ID edits to a graph-native test",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Current App Map revision",
        },
        {
          name: "edits",
          type: "array",
          required: true,
          description:
            "test.patch, step.add, step.patch, step.remove, step.reorder, step.bind, or step.unbind edits",
        },
      ],
      examples: [
        'relay test edit checkout smoke --input \'{"expectedRevision":7,"edits":[{"kind":"step.patch","stepId":"submit-order","patch":{"intent":"Submit the reviewed order"}}]}\'',
      ],
    }),
  ),
  mapped(
    "app-map.test.propose",
    path("test propose", ["appMapId", "testId"], undefined, {
      summary: "Submit stable-ID Test edits for human review",
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "App Map revision the agent reviewed",
        },
        {
          name: "edits",
          type: "array",
          required: true,
          description: "The same semantic edits accepted by test edit",
        },
        { name: "proposalId", type: "string", description: "Optional stable proposal id" },
        { name: "title", type: "string", description: "Optional review title" },
      ],
      examples: [
        'relay test propose checkout smoke --input \'{"expectedRevision":7,"title":"Clarify checkout intent","edits":[{"kind":"step.patch","stepId":"submit-order","patch":{"intent":"Submit the reviewed order"}}]}\'',
      ],
    }),
  ),
  mapped(
    "app-map.test.compile",
    path("test compile", ["appMapId", "testId"], undefined, {
      summary: "Validate and inspect deterministic recipes plus step provenance",
    }),
  ),
  mapped(
    "app-map.test.run",
    path("test run", ["appMapId", "testId"], undefined, {
      summary: "Run one exact saved graph-native Test revision",
      argumentHelp: [
        { name: "appMapId", type: "string", description: "App Map identifier" },
        { name: "testId", type: "string", description: "Graph-native Test identifier" },
      ],
      inputHelp: [
        {
          name: "expectedRevision",
          type: "number",
          required: true,
          description: "Exact saved App Map revision to run",
        },
        {
          name: "target",
          type: "object",
          required: true,
          description: "Explicit device or browser target",
        },
      ],
      examples: [
        'relay test run checkout smoke --input \'{"expectedRevision":7,"target":{"kind":"device","platform":"ios","targetId":"DEVICE"}}\'',
        'relay test run checkout smoke --input \'{"expectedRevision":7,"target":{"kind":"browser","platform":"browser","targetId":"checkout-web"}}\'',
      ],
      note: "The revision and target are mandatory. Device runs require authorized server-managed control; active jobs serialize Target mutations.",
      behavior: "job-start-watch",
    }),
  ),
  mapped("app-map.test.remove", path("test remove", ["appMapId", "testId"])),
];
