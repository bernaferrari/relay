import type { AppMapOperationMap } from "./app-map-operation-map.js";
import { createSchemaOperationBuilders } from "../operation/operation-builders.js";

const { command, query } = createSchemaOperationBuilders<keyof AppMapOperationMap>();

export const appMapOperationDefinitions = [
  query("app-map.list", "List App Maps", "/app-maps", {
    category: "authoring",
  }),
  query("app-map.get", "Get App Map", "/app-maps/:appMapId", {
    category: "authoring",
  }),
  query(
    "app-map.observed",
    "What recent runs saw on this App Map, including new screens",
    "/app-maps/:appMapId/observed",
    {
      category: "authoring",
    },
  ),
  command("app-map.remove", "Remove App Map", "POST", "/app-maps/:appMapId/remove", {
    category: "authoring",
    confirmation: "confirm",
  }),
  command("app-map.create", "Create App Map", "POST", "/app-maps", {
    category: "authoring",
  }),
  command("app-map.duplicate", "Duplicate App Map", "POST", "/app-maps/:sourceAppMapId/duplicate", {
    category: "authoring",
  }),
  query("app-map.export", "Export App Map YAML", "/app-maps/:appMapId/export", {
    category: "authoring",
  }),
  command("app-map.import", "Import App Map YAML", "POST", "/app-maps/import", {
    category: "authoring",
  }),
  command("app-map.update", "Update App Map", "PUT", "/app-maps/:appMapId", {
    category: "authoring",
  }),
  command("app-map.commit", "Commit App Map changes", "POST", "/app-maps/:appMapId/commit", {
    category: "authoring",
  }),
  command("app-map.screen.add", "Add App Map screen", "POST", "/app-maps/:appMapId/screens", {
    category: "authoring",
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
    },
  ),
  command(
    "app-map.screen.refresh.prepare",
    "Preview a mapped screen refresh",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/refresh/prepare",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "app-map.screen.refresh.apply",
    "Apply a prepared mapped screen refresh",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/refresh/apply",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.screen.alias-observe",
    "Approve the current target screen as an alias of a mapped screen",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/alias-observe",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
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
    },
  ),
  command(
    "app-map.scroll-surface.regenerate",
    "Regenerate one logical scroll surface from its raw evidence",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/regenerate",
    {
      category: "authoring",
    },
  ),
  query(
    "app-map.scroll-surface.origin.inspect",
    "Inspect reviewed scroll-surface origin lineage",
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/origin",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.scroll-surface.origin.review",
    "Review and activate a scroll-surface origin",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/origin/review",
    {
      category: "authoring",
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.scroll-surface.origin.revoke",
    "Revoke a reviewed scroll-surface origin",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/variants/:variantId/scroll-surfaces/:captureId/origin/:projectionId/revoke",
    {
      category: "authoring",
      confirmation: "confirm",
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
    },
  ),
  command(
    "app-map.screen.update",
    "Update App Map screen",
    "PUT",
    "/app-maps/:appMapId/screens/:screenId",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.screen.remove",
    "Remove App Map screen",
    "POST",
    "/app-maps/:appMapId/screens/:screenId/remove",
    {
      category: "authoring",
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.screen.consolidate",
    "Merge duplicate captures with mode same-screen, preserving actions and accepted identity aliases; default mode consolidates scroll viewports. Use dryRun to review rewiring first.",
    "POST",
    "/app-maps/:appMapId/screens/:targetScreenId/consolidate",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.connection.create",
    "Create App Map connection",
    "POST",
    "/app-maps/:appMapId/connections",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.connection.update",
    "Update App Map connection",
    "PUT",
    "/app-maps/:appMapId/connections/:connectionId",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.connection.remove",
    "Remove App Map connection",
    "POST",
    "/app-maps/:appMapId/connections/:connectionId/remove",
    {
      category: "authoring",
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
    },
  ),
  command(
    "app-map.group.remove",
    "Remove App Map Group",
    "POST",
    "/app-maps/:appMapId/groups/:groupId/remove",
    {
      category: "authoring",
      confirmation: "confirm",
    },
  ),
  command("app-map.flow.save", "Save App Map Flow", "PUT", "/app-maps/:appMapId/flows/:flowId", {
    category: "authoring",
  }),
  command("app-map.flow.run", "Run App Map flow", "POST", "/app-maps/:appMapId/flows/:flowId/run", {
    category: "execution",
    targetCapabilities: ["tap", "type", "scroll", "screenshot"],
    lease: "exclusive",
    progress: true,
    cancellable: true,
  }),
  command(
    "app-map.connection.run",
    "Replay App Map connection",
    "POST",
    "/app-maps/:appMapId/connections/:connectionId/run",
    {
      category: "execution",
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
    },
  ),
  command(
    "app-map.case-stack.attach",
    "Apply an App Map case stack to a connection",
    "POST",
    "/app-maps/:appMapId/connections/:connectionId/case-stack",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.case-stack.remove",
    "Remove App Map case stack",
    "POST",
    "/app-maps/:appMapId/case-stacks/:caseStackId/remove",
    {
      category: "authoring",
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
    },
  ),
  command(
    "app-map.variable.infer",
    "Infer a reviewable Variable from taught rows on the current target",
    "POST",
    "/app-maps/:appMapId/variables/:variableId/infer",
    {
      category: "authoring",
      targetCapabilities: ["snapshot"],
      lease: "exclusive",
    },
  ),
  command(
    "app-map.variable.remove",
    "Remove an App Map variable",
    "POST",
    "/app-maps/:appMapId/variables/:variableId/remove",
    {
      category: "authoring",
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
    },
  ),
  command(
    "app-map.test.remove",
    "Remove a map test",
    "POST",
    "/app-maps/:appMapId/tests/:testId/remove",
    {
      category: "authoring",
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
    },
  ),
  command(
    "app-map.test.undo",
    "Undo the latest durable Test edit",
    "POST",
    "/app-maps/:appMapId/tests/:testId/undo",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.test.redo",
    "Redo the next durable Test edit",
    "POST",
    "/app-maps/:appMapId/tests/:testId/redo",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.test.propose",
    "Propose stable-ID edits to a graph-native map test",
    "POST",
    "/app-maps/:appMapId/tests/:testId/proposals",
    {
      category: "authoring",
    },
  ),
  query(
    "app-map.test.compile",
    "Compile and validate a graph-native map test",
    "/app-maps/:appMapId/tests/:testId/compile",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.test.from-intent",
    "Compile English onto ready App Map edges",
    "POST",
    "/app-maps/:appMapId/tests/from-intent",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.test.draft",
    "Draft plain-English Action and Check steps from what should work",
    "POST",
    "/app-maps/:appMapId/tests/draft",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.test.run",
    "Compile and run one exact graph-native map test revision",
    "POST",
    "/app-maps/:appMapId/tests/:testId/run",
    {
      category: "execution",
      targetCapabilities: ["tap", "type", "scroll", "screenshot"],
      lease: "exclusive",
      progress: true,
      cancellable: true,
    },
  ),
  command(
    "app-map.combine.preflight",
    "Preview a Combine without starting it",
    "POST",
    "/app-maps/:appMapId/combines/:combineId/preflight",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.combine.save",
    "Save a Combine (Variables × Tests)",
    "PUT",
    "/app-maps/:appMapId/combines/:combineId",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.combine.remove",
    "Remove a Combine",
    "POST",
    "/app-maps/:appMapId/combines/:combineId/remove",
    {
      category: "authoring",
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
    },
  ),
  command(
    "app-map.routine.remove",
    "Remove App Map Routine",
    "POST",
    "/app-maps/:appMapId/routines/:routineId/remove",
    {
      category: "authoring",
      confirmation: "confirm",
    },
  ),
  query(
    "app-map.routine.impact",
    "Preview App Map routine impact",
    "/app-maps/:appMapId/routines/:routineId/impact",
    {
      category: "authoring",
    },
  ),
  query(
    "app-map.diff.impact",
    "Compute diff-to-flows impact for changed files",
    "/app-maps/:appMapId/diff-impact",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.proposal.submit",
    "Submit App Map proposal",
    "POST",
    "/app-maps/:appMapId/proposals",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.observations.propose",
    "Propose observed App Map path",
    "POST",
    "/app-maps/:appMapId/observation-proposals",
    {
      category: "authoring",
    },
  ),
  command(
    "app-map.proposal.approve",
    "Approve App Map proposal",
    "POST",
    "/app-maps/:appMapId/proposals/:proposalId/approve",
    {
      category: "authoring",
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
      confirmation: "confirm",
    },
  ),
  command(
    "app-map.proposal.revert",
    "Revert an approved repair proposal",
    "POST",
    "/app-maps/:appMapId/proposals/:proposalId/revert",
    {
      category: "authoring",
      confirmation: "confirm",
    },
  ),
] as const;
