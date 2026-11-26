import { createSchemaOperationBuilders } from "../operation/operation-builders.js";
import * as authoringOperations from "./authoring-raw-optimization-operation.js";

const { command, query } = createSchemaOperationBuilders();

export const authoringOperationDefinitions = [
  query("authoring.session.list", "List Authoring Sessions", "/authoring-sessions", {
    category: "authoring",
  }),
  query("authoring.session.get", "Get Authoring Session", "/authoring-sessions/:sessionId", {
    category: "authoring",
  }),
  command("authoring.session.create", "Create Authoring Session", "POST", "/authoring-sessions", {
    category: "authoring",
    targetCapabilities: ["snapshot", "screenshot"],
    lease: "exclusive",
  }),
  command(
    "authoring.session.begin",
    "Create and Start Authoring Take",
    "POST",
    "/authoring-sessions/begin",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.observe",
    "Observe Authoring Target",
    "POST",
    "/authoring-sessions/:sessionId/observe",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.capture",
    "Capture Authoring Screen",
    "POST",
    "/authoring-sessions/:sessionId/capture",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.start",
    "Start Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/start",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.interact",
    "Interact During Authoring",
    "POST",
    "/authoring-sessions/:sessionId/interact",
    {
      category: "authoring",
      targetCapabilities: ["tap", "type", "scroll"],
      lease: "exclusive",
    },
  ),
  command(
    "authoring.session.stop",
    "Stop Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/stop",
    {
      category: "authoring",
      targetCapabilities: ["snapshot", "screenshot"],
      lease: "exclusive",
    },
  ),
  authoringOperations.authoringRawOptimizationOperationDefinition,
  command(
    "authoring.take.trim",
    "Trim Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/trim",
    {
      category: "authoring",
    },
  ),
  command(
    "authoring.take.reorder",
    "Reorder Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/reorder",
    {
      category: "authoring",
    },
  ),
  command(
    "authoring.take.replace",
    "Replace Authoring Action",
    "POST",
    "/authoring-sessions/:sessionId/actions/:actionId",
    {
      category: "authoring",
    },
  ),
  authoringOperations.authoringTakeEditOperationDefinition,
  command(
    "authoring.take.replay",
    "Replay Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/replay",
    {
      category: "authoring",
      targetCapabilities: ["tap", "type", "scroll", "snapshot", "screenshot"],
      lease: "exclusive",
      progress: true,
      cancellable: true,
    },
  ),
  command(
    "authoring.session.commit",
    "Commit Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/commit",
    {
      category: "authoring",
    },
  ),
  command(
    "authoring.session.discard",
    "Discard Authoring Take",
    "POST",
    "/authoring-sessions/:sessionId/discard",
    {
      category: "authoring",
    },
  ),
  command(
    "authoring.session.cancel",
    "Cancel Authoring Session",
    "POST",
    "/authoring-sessions/:sessionId/cancel",
    {
      category: "authoring",
    },
  ),
  command(
    "authoring.session.cleanup",
    "Remove Authoring Session",
    "DELETE",
    "/authoring-sessions/:sessionId",
    {
      category: "authoring",
    },
  ),
] as const;
