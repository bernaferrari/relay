import type { AppMapOperationMap } from "./app-map-operation-map.js";
import {
  createAppMapOperationParsers,
  type AppMapParserDependencies,
} from "./app-map-operation-parsers.js";
import { createOperationBuilders } from "./operation-builders.js";
import type { OperationDefinition, OperationRecord, RuntimeParser } from "./operation-contract.js";

type AppMapOperationId = keyof AppMapOperationMap;

export function createAppMapOperationDefinitions(
  defaultParser: RuntimeParser<OperationRecord>,
  parserDependencies: AppMapParserDependencies,
): readonly OperationDefinition<AppMapOperationId>[] {
  const { command, query } = createOperationBuilders<AppMapOperationId>(defaultParser);
  const { emptyInputParser, okParser } = parserDependencies;
  const {
    appMapCommitParser,
    appMapCombinePreflightInputParser,
    appMapCombinePreflightOutputParser,
    appMapConnectionCreateParser,
    appMapConnectionRunOutputParser,
    appMapConnectionRunParser,
    appMapCreateParser,
    appMapDuplicateParser,
    appMapExportParser,
    appMapFlowRunOutputParser,
    appMapFlowRunParser,
    appMapFlowSaveParser,
    appMapImportOutputParser,
    appMapImportParser,
    appMapListOutputParser,
    appMapMutationParser,
    appMapOutputParser,
    appMapRefParser,
    appMapRoutineSaveParser,
    appMapScreenAddParser,
    appMapScreenCaptureOutputParser,
    appMapScreenCaptureParser,
    appMapScrollSurfaceCaptureOutputParser,
    appMapScrollSurfaceCaptureParser,
    appMapTeachOutputParser,
    appMapTeachParser,
    appMapTestCompileInputParser,
    appMapTestCompileOutputParser,
    appMapTestEditInputParser,
    appMapTestProposeInputParser,
    appMapTestProposeOutputParser,
    appMapTestRunInputParser,
    appMapTestRunOutputParser,
    observationProposalInputParser,
    observationProposalOutputParser,
  } = createAppMapOperationParsers(parserDependencies);

  return [
    query("app-map.list", "List App Maps", "/app-maps", {
      category: "authoring",
      input: emptyInputParser,
      output: appMapListOutputParser,
    }),
    query("app-map.get", "Get App Map", "/app-maps/:appMapId", {
      category: "authoring",
      input: appMapRefParser,
      output: appMapOutputParser,
    }),
    command("app-map.remove", "Remove App Map", "POST", "/app-maps/:appMapId/remove", {
      category: "authoring",
      confirmation: "confirm",
      input: appMapRefParser,
      output: okParser,
    }),
    command("app-map.create", "Create App Map", "POST", "/app-maps", {
      category: "authoring",
      input: appMapCreateParser,
      output: appMapOutputParser,
    }),
    command(
      "app-map.duplicate",
      "Duplicate App Map",
      "POST",
      "/app-maps/:sourceAppMapId/duplicate",
      {
        category: "authoring",
        input: appMapDuplicateParser,
        output: appMapOutputParser,
      },
    ),
    query("app-map.export", "Export App Map YAML", "/app-maps/:appMapId/export", {
      category: "authoring",
      input: appMapRefParser,
      output: appMapExportParser,
    }),
    command("app-map.import", "Import App Map YAML", "POST", "/app-maps/import", {
      category: "authoring",
      input: appMapImportParser,
      output: appMapImportOutputParser,
    }),
    command("app-map.update", "Update App Map", "PUT", "/app-maps/:appMapId", {
      category: "authoring",
      input: appMapMutationParser<"app-map.update">("App Map update", "patch"),
      output: appMapOutputParser,
    }),
    command("app-map.commit", "Commit App Map changes", "POST", "/app-maps/:appMapId/commit", {
      category: "authoring",
      input: appMapCommitParser,
      output: appMapOutputParser,
    }),
    command("app-map.screen.add", "Add App Map screen", "POST", "/app-maps/:appMapId/screens", {
      category: "authoring",
      input: appMapScreenAddParser,
      output: appMapOutputParser,
    }),
    command(
      "app-map.screen.capture",
      "Capture current target as an App Map screen",
      "POST",
      "/app-maps/:appMapId/screens/capture",
      {
        category: "authoring",
        targetCapabilities: ["snapshot", "screenshot"],
        lease: "exclusive",
        input: appMapScreenCaptureParser,
        output: appMapScreenCaptureOutputParser,
      },
    ),
    command(
      "app-map.scroll-surface.capture",
      "Capture and attach a durable scrollable logical screen",
      "POST",
      "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/capture",
      {
        category: "authoring",
        targetCapabilities: ["scroll", "snapshot", "screenshot"],
        lease: "exclusive",
        input: appMapScrollSurfaceCaptureParser,
        output: appMapScrollSurfaceCaptureOutputParser,
      },
    ),
    command(
      "app-map.teach",
      "Tap a control, capture the destination, and connect it on the App Map",
      "POST",
      "/app-maps/:appMapId/teach",
      {
        category: "authoring",
        targetCapabilities: ["snapshot", "screenshot", "tap"],
        lease: "exclusive",
        input: appMapTeachParser,
        output: appMapTeachOutputParser,
      },
    ),
    command(
      "app-map.screen.update",
      "Update App Map screen",
      "PUT",
      "/app-maps/:appMapId/screens/:screenId",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.screen.update">("screen update", "input", [
          "screenId",
        ]),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.screen.remove",
      "Remove App Map screen",
      "POST",
      "/app-maps/:appMapId/screens/:screenId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.screen.remove">("screen removal", undefined, [
          "screenId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.connection.create",
      "Create App Map connection",
      "POST",
      "/app-maps/:appMapId/connections",
      {
        category: "authoring",
        input: appMapConnectionCreateParser,
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.connection.update",
      "Update App Map connection",
      "PUT",
      "/app-maps/:appMapId/connections/:connectionId",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.connection.update">("connection update", "patch", [
          "connectionId",
        ]),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.connection.remove",
      "Remove App Map connection",
      "POST",
      "/app-maps/:appMapId/connections/:connectionId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.connection.remove">("connection removal", undefined, [
          "connectionId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.group.save",
      "Save App Map Group",
      "PUT",
      "/app-maps/:appMapId/groups/:groupId",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.group.save">("Group save", "group", ["groupId"]),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.group.remove",
      "Remove App Map Group",
      "POST",
      "/app-maps/:appMapId/groups/:groupId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.group.remove">("Group removal", undefined, [
          "groupId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command("app-map.flow.save", "Save App Map Flow", "PUT", "/app-maps/:appMapId/flows/:flowId", {
      category: "authoring",
      input: appMapFlowSaveParser,
      output: appMapOutputParser,
    }),
    command(
      "app-map.flow.run",
      "Run App Map flow",
      "POST",
      "/app-maps/:appMapId/flows/:flowId/run",
      {
        category: "execution",
        input: appMapFlowRunParser,
        output: appMapFlowRunOutputParser,
        targetCapabilities: ["tap", "type", "scroll", "screenshot"],
        lease: "exclusive",
        progress: true,
        cancellable: true,
      },
    ),
    command(
      "app-map.connection.run",
      "Replay App Map connection",
      "POST",
      "/app-maps/:appMapId/connections/:connectionId/run",
      {
        category: "execution",
        input: appMapConnectionRunParser,
        output: appMapConnectionRunOutputParser,
        targetCapabilities: ["tap", "type", "scroll", "screenshot"],
        lease: "exclusive",
        progress: true,
        cancellable: true,
      },
    ),
    command(
      "app-map.flow.remove",
      "Remove App Map Flow",
      "POST",
      "/app-maps/:appMapId/flows/:flowId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.flow.remove">("Flow removal", undefined, ["flowId"]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.case-stack.save",
      "Save App Map case stack",
      "PUT",
      "/app-maps/:appMapId/case-stacks/:caseStackId",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.case-stack.save">("Case stack save", "caseStack", [
          "caseStackId",
        ]),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.case-stack.attach",
      "Apply an App Map case stack to a connection",
      "POST",
      "/app-maps/:appMapId/connections/:connectionId/case-stack",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.case-stack.attach">(
          "Case stack attachment",
          undefined,
          ["connectionId", "caseStackId"],
        ),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.case-stack.remove",
      "Remove App Map case stack",
      "POST",
      "/app-maps/:appMapId/case-stacks/:caseStackId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.case-stack.remove">("Case stack removal", undefined, [
          "caseStackId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.variable.save",
      "Save an App Map variable",
      "PUT",
      "/app-maps/:appMapId/variables/:variableId",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.variable.save">("Variable save", "variable", [
          "variableId",
        ]),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.variable.remove",
      "Remove an App Map variable",
      "POST",
      "/app-maps/:appMapId/variables/:variableId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.variable.remove">("Variable removal", undefined, [
          "variableId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.test.save",
      "Save a graph-native, path, or tour map test",
      "PUT",
      "/app-maps/:appMapId/tests/:testId",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.test.save">("Test save", "test", ["testId"]),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.test.remove",
      "Remove a map test",
      "POST",
      "/app-maps/:appMapId/tests/:testId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.test.remove">("Test removal", undefined, ["testId"]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.test.edit",
      "Apply stable-ID edits to a graph-native map test",
      "POST",
      "/app-maps/:appMapId/tests/:testId/edit",
      {
        category: "authoring",
        input: appMapTestEditInputParser,
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.test.propose",
      "Propose stable-ID edits to a graph-native map test",
      "POST",
      "/app-maps/:appMapId/tests/:testId/proposals",
      {
        category: "authoring",
        input: appMapTestProposeInputParser,
        output: appMapTestProposeOutputParser,
      },
    ),
    query(
      "app-map.test.compile",
      "Compile and validate a graph-native map test",
      "/app-maps/:appMapId/tests/:testId/compile",
      {
        category: "authoring",
        input: appMapTestCompileInputParser,
        output: appMapTestCompileOutputParser,
      },
    ),
    command(
      "app-map.test.run",
      "Compile and run one exact graph-native map test revision",
      "POST",
      "/app-maps/:appMapId/tests/:testId/run",
      {
        category: "execution",
        input: appMapTestRunInputParser,
        output: appMapTestRunOutputParser,
        targetCapabilities: ["tap", "type", "scroll", "screenshot"],
        lease: "exclusive",
        progress: true,
        cancellable: true,
      },
    ),
    command(
      "app-map.combine.preflight",
      "Preview a run matrix without starting it",
      "POST",
      "/app-maps/:appMapId/combines/:combineId/preflight",
      {
        category: "authoring",
        input: appMapCombinePreflightInputParser,
        output: appMapCombinePreflightOutputParser,
      },
    ),
    command(
      "app-map.combine.save",
      "Save a run matrix (state sets × tests)",
      "PUT",
      "/app-maps/:appMapId/combines/:combineId",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.combine.save">("Run matrix save", "combine", [
          "combineId",
        ]),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.combine.remove",
      "Remove a run matrix",
      "POST",
      "/app-maps/:appMapId/combines/:combineId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.combine.remove">("Run matrix removal", undefined, [
          "combineId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.routine.save",
      "Save App Map Routine",
      "PUT",
      "/app-maps/:appMapId/routines/:routineId",
      {
        category: "authoring",
        input: appMapRoutineSaveParser,
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.routine.remove",
      "Remove App Map Routine",
      "POST",
      "/app-maps/:appMapId/routines/:routineId/remove",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.routine.remove">("Routine removal", undefined, [
          "routineId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.proposal.submit",
      "Submit App Map proposal",
      "POST",
      "/app-maps/:appMapId/proposals",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.proposal.submit">("proposal submission", "proposal"),
        output: appMapOutputParser,
      },
    ),
    command(
      "app-map.observations.propose",
      "Propose observed App Map path",
      "POST",
      "/app-maps/:appMapId/observation-proposals",
      {
        category: "authoring",
        input: observationProposalInputParser,
        output: observationProposalOutputParser,
      },
    ),
    command(
      "app-map.proposal.approve",
      "Approve App Map proposal",
      "POST",
      "/app-maps/:appMapId/proposals/:proposalId/approve",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.proposal.approve">("proposal approval", undefined, [
          "proposalId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
    command(
      "app-map.proposal.reject",
      "Reject App Map proposal",
      "POST",
      "/app-maps/:appMapId/proposals/:proposalId/reject",
      {
        category: "authoring",
        input: appMapMutationParser<"app-map.proposal.reject">("proposal rejection", undefined, [
          "proposalId",
        ]),
        output: appMapOutputParser,
        confirmation: "confirm",
      },
    ),
  ];
}
