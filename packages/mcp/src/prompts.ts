import { McpServer, type GetPromptResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { relayMcpResourceUris } from "./resources.js";

export const relayMcpPromptNames = {
  mapAppSafely: "relay_map_this_app_safely",
  repairFailedConnection: "relay_repair_this_failed_connection",
  reviewTake: "relay_review_this_take",
} as const;

export const relayMcpPrompts = [
  {
    name: relayMcpPromptNames.mapAppSafely,
    title: "Map this app safely",
    description: "Observe a Target and extend one App Map without exceeding explicit permission.",
  },
  {
    name: relayMcpPromptNames.repairFailedConnection,
    title: "Repair this failed connection",
    description: "Diagnose, replay, and repair one identified App Map connection.",
  },
  {
    name: relayMcpPromptNames.reviewTake,
    title: "Review this Take",
    description: "Inspect and refine one recorded Take before deciding whether to commit it.",
  },
] as const;

type RelayPromptScope = {
  projectId: string;
};

const relayIdentifier = z
  .string()
  .min(1)
  .max(96)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "must be a Relay identifier");

function projectSchema(projectId: string) {
  return z.literal(projectId).describe("Explicit Relay project ID configured for this MCP server");
}

function prompt(text: string, description: string): GetPromptResult {
  return {
    description,
    messages: [{ role: "user", content: { type: "text", text } }],
  };
}

function sharedSafety(projectId: string): string {
  return [
    "Safety contract:",
    `- Work only in project ${projectId}. Do not substitute another project, organization, Target, App Map, session, connection, or Take.`,
    "- Observation does not authorize mutation. Finish the observation phase and report the proposed changes before using any tool whose readOnlyHint is false.",
    "- The current request may delegate a bounded sequence of reversible Target interactions and proposal edits; stay inside its named Target, App Map, and action budget without interrupting after every step.",
    "- Obtain explicit user confirmation before any destructive, trust-changing, or confirmation-protected operation. When a Relay tool schema requires confirmation, pass the literal confirm: true only after that confirmation; never infer or manufacture consent.",
    "- Never escalate permissions, acquire broader credentials, change organization/project scope, bypass a lease, or continue after an authorization failure.",
    "- Never read arbitrary filesystem paths or ask another tool to do so. Use only scoped relay:// resources and Relay tools; screenshots come from relay_target_screenshot_capture as native image/png MCP content.",
    "- Preserve server-provided actor identity. Use the active Target lease where required, expected revisions for writes, and stable idempotency keys where the operation accepts them. On a lease or revision conflict, stop, refresh authoritative state, and ask before retrying.",
  ].join("\n");
}

function registerMapPrompt(server: McpServer, scope: RelayPromptScope): void {
  const descriptor = relayMcpPrompts[0];
  server.registerPrompt(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      argsSchema: z
        .object({
          projectId: projectSchema(scope.projectId),
          targetId: relayIdentifier.describe(
            "Explicit Target ID to observe and, if approved, control",
          ),
          appMapId: relayIdentifier.describe("Explicit App Map ID that will receive observations"),
          actionBudget: z.coerce
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .describe("Maximum Target interactions for this bounded exploration; defaults to 20"),
        })
        .strict(),
    },
    ({ projectId, targetId, appMapId, actionBudget }) =>
      prompt(
        [
          `Map the app safely for project ${projectId}, Target ${targetId}, and App Map ${appMapId}.`,
          "",
          sharedSafety(projectId),
          "",
          "Observation phase (no mutation):",
          `1. Read ${relayMcpResourceUris.project}, ${relayMcpResourceUris.targets}, relay://app-maps/${appMapId}, and relay://targets/${targetId}/observation. Verify every returned identifier matches this request.`,
          `2. Use relay_target_screenshot_capture with the explicit Target identity to receive the current screen as native image/png. Use relay_target_snapshot_capture only for bounded structure supplied by Relay.`,
          "3. Describe the current unique screen, known outgoing connections, uncertainty, and a smallest-next-step exploration plan. Do not claim a screen or connection exists until Relay evidence supports it. Author only screens, connections, variables (lists like language), tests (a path or tour), and Combine (variable × test). Do not invent a second recipe library.",
          "",
          "Bounded exploration and proposal:",
          `4. The user delegates at most ${actionBudget ?? 20} reversible Target interactions for this exploration. Check relay_lease_list and acquire only the required Target lease with relay_lease_create if needed. Do not take over or release another actor's lease.`,
          "5. Use a server-owned Authoring Session for controlled interactions and Takes. Re-observe and capture a PNG after each interaction; deduplicate screens by authoritative identity/evidence rather than visual guesswork. Stop when the budget is exhausted, the requested area is mapped, or uncertainty makes another action unsafe.",
          "6. Re-read the App Map revision, then submit discovered screens and connections as a reviewable proposal. Do not directly approve the proposal, promote baselines, merge screen identities, or mark verification complete. Stop on conflict instead of overwriting concurrent work.",
          "7. Summarize observed evidence separately from proposed changes, including IDs, action-budget usage, revision outcomes, and unexplored branches.",
        ].join("\n"),
        descriptor.description,
      ),
  );
}

function registerRepairPrompt(server: McpServer, scope: RelayPromptScope): void {
  const descriptor = relayMcpPrompts[1];
  server.registerPrompt(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      argsSchema: z
        .object({
          projectId: projectSchema(scope.projectId),
          targetId: relayIdentifier.describe("Explicit Target ID used to reproduce the failure"),
          appMapId: relayIdentifier.describe("Explicit App Map containing the connection"),
          sessionId: relayIdentifier.describe("Explicit server-owned Authoring Session ID"),
          connectionId: relayIdentifier.describe("Explicit failed connection ID"),
        })
        .strict(),
    },
    ({ projectId, targetId, appMapId, sessionId, connectionId }) =>
      prompt(
        [
          `Repair connection ${connectionId} in App Map ${appMapId}, project ${projectId}, using Target ${targetId} and Authoring Session ${sessionId}.`,
          "",
          sharedSafety(projectId),
          "",
          "Observation and diagnosis (no mutation):",
          `1. Read relay://app-maps/${appMapId}, relay://authoring-sessions/${sessionId}, and relay://targets/${targetId}/observation. Verify that the session, Target, App Map, and connection belong together; stop on any mismatch.`,
          "2. Inspect the session's current Take/revision and server-owned evidence. Capture a fresh native PNG with relay_target_screenshot_capture only if current Target state is needed.",
          "3. Explain the observed failure, the expected destination, and the smallest proposed repair. Separate evidence from inference and ask for confirmation before changing the Target, Take, connection, or App Map.",
          "",
          "Repair and proof (only after explicit confirmation):",
          "4. Verify or acquire the required lease without displacing another actor. Re-read the Authoring Session and App Map revisions immediately before writes.",
          "5. Use only the identified session's relay_authoring_session_interact, relay_authoring_take_trim, relay_authoring_take_reorder, or relay_authoring_take_replace tools needed for the approved repair. Never mutate another connection as a shortcut.",
          "6. Use relay_authoring_take_replay to prove the repaired transition. If replay is not flawless, report the failure and iterate only with renewed approval; do not commit speculatively.",
          "7. Commit with relay_authoring_session_commit only after approval, preserving lease ID, expected revisions, and idempotency semantics. Destructive discard/cancel/cleanup requires separate explicit confirmation and confirm: true when required.",
          "8. Report the final connection, session/Take revision, replay evidence, and App Map revision, or the exact conflict that prevented repair.",
        ].join("\n"),
        descriptor.description,
      ),
  );
}

function registerReviewPrompt(server: McpServer, scope: RelayPromptScope): void {
  const descriptor = relayMcpPrompts[2];
  server.registerPrompt(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      argsSchema: z
        .object({
          projectId: projectSchema(scope.projectId),
          targetId: relayIdentifier.describe("Explicit Target ID associated with this Take"),
          appMapId: relayIdentifier.describe("Explicit App Map this Take may update"),
          sessionId: relayIdentifier.describe("Explicit server-owned Authoring Session ID"),
          takeId: relayIdentifier.describe("Explicit Take ID to inspect and refine"),
        })
        .strict(),
    },
    ({ projectId, targetId, appMapId, sessionId, takeId }) =>
      prompt(
        [
          `Review Take ${takeId} in Authoring Session ${sessionId} for App Map ${appMapId}, Target ${targetId}, project ${projectId}.`,
          "",
          sharedSafety(projectId),
          "",
          "Observation and review (no mutation):",
          `1. Read relay://authoring-sessions/${sessionId}, relay://app-maps/${appMapId}, and relay://targets/${targetId}/observation. Verify the returned session has exactly Take ${takeId} and the requested Target/App Map; stop on mismatch.`,
          "2. Review the current Take revision, ordered actions, before/after observations, timing, destination, replay result, and bounded server-owned evidence. Use relay_target_screenshot_capture only when a fresh native PNG is needed to understand current Target state.",
          "3. Present a concise keep/trim/reorder/replace proposal. Treat trimming actions or video, replaying, committing, discarding, cancelling, and Target interaction as mutations that require explicit confirmation.",
          "",
          "Refinement and decision (only after explicit confirmation):",
          "4. Re-read the session and verify the lease and current Take revision before each change. Apply only approved edits through relay_authoring_take_trim, relay_authoring_take_reorder, or relay_authoring_take_replace; do not edit evidence files directly.",
          "5. Replay with relay_authoring_take_replay. Compare the result with the requested destination and report any instability. A successful replay is evidence, not automatic permission to commit.",
          "6. Ask separately whether to commit, keep reviewing, or discard. Use relay_authoring_session_commit only with expected App Map revisions and idempotency semantics; destructive discard/cancel/cleanup requires explicit confirmation and confirm: true when required.",
          "7. Report the final Take revision, replay outcome, chosen decision, resulting App Map revision if committed, and any unresolved uncertainty.",
        ].join("\n"),
        descriptor.description,
      ),
  );
}

export function registerRelayPrompts(server: McpServer, scope: RelayPromptScope): void {
  registerMapPrompt(server, scope);
  registerRepairPrompt(server, scope);
  registerReviewPrompt(server, scope);
}
