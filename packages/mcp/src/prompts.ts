import { McpServer, type GetPromptResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { relayMcpResourceUris } from "./resources.js";
import type { OperationId } from "@relay/protocol";
import type { RelayMcpToolDescriptor } from "./tools.js";

export const relayMcpPromptNames = {
  mapAppSafely: "relay_map_this_app_safely",
  repairFailedConnection: "relay_repair_this_failed_connection",
  reviewTake: "relay_review_this_take",
  planCombine: "relay_plan_this_combine",
  authorGraphTest: "relay_author_this_graph_test",
  verifyChange: "relay_verify_this_change",
} as const;

export type RelayMcpPromptDescriptor = {
  readonly name: (typeof relayMcpPromptNames)[keyof typeof relayMcpPromptNames];
  readonly title: string;
  readonly description: string;
  readonly requiredOperationIds: readonly OperationId[];
};

export const relayMcpPrompts = [
  {
    name: relayMcpPromptNames.mapAppSafely,
    title: "Map this app safely",
    description: "Observe a Target and extend one App Map without exceeding explicit permission.",
    requiredOperationIds: [
      "target.snapshot.capture",
      "target.screenshot.capture",
      "lease.list",
      "lease.create",
      "discovery.create",
      "discovery.start",
      "app-map.observations.propose",
    ],
  },
  {
    name: relayMcpPromptNames.repairFailedConnection,
    title: "Repair this failed connection",
    description: "Diagnose, replay, and repair one identified App Map connection.",
    requiredOperationIds: [
      "target.screenshot.capture",
      "lease.list",
      "lease.create",
      "authoring.session.interact",
      "authoring.take.trim",
      "authoring.take.reorder",
      "authoring.take.replace",
      "authoring.take.replay",
      "authoring.session.commit",
    ],
  },
  {
    name: relayMcpPromptNames.reviewTake,
    title: "Review this Take",
    description: "Inspect and refine one recorded Take before deciding whether to commit it.",
    requiredOperationIds: [
      "target.screenshot.capture",
      "lease.list",
      "lease.create",
      "authoring.take.trim",
      "authoring.take.reorder",
      "authoring.take.replace",
      "authoring.take.replay",
      "authoring.session.commit",
      "authoring.session.discard",
    ],
  },
  {
    name: relayMcpPromptNames.planCombine,
    title: "Plan this Combine",
    description: "Turn a testing goal into one reviewable Variable × Test plan, then run it.",
    requiredOperationIds: [
      "target.screenshot.capture",
      "app-map.test.run",
      "app-map.combine.save",
      "app-map.combine.preflight",
      "lease.list",
      "lease.create",
      "job.combine.start",
      "job.combine.campaign.get",
      "job.combine.campaign.resume",
      "job.combine.campaign.cancel",
      "job.list",
      "job.get",
      "job.retry",
      "job.combine.export",
    ],
  },
  {
    name: relayMcpPromptNames.authorGraphTest,
    title: "Author this graph Test",
    description:
      "Create or refine one graph-native Test, validate its compiled plan, run it once, and inspect evidence.",
    requiredOperationIds: [
      "target.devices.list",
      "target.screenshot.capture",
      "lease.list",
      "lease.create",
      "app-map.get",
      "app-map.test.save",
      "app-map.test.propose",
      "app-map.test.compile",
      "app-map.test.run",
      "job.get",
      "job.cancel",
      "run.get",
      "run.evidence.get",
    ],
  },
  {
    name: relayMcpPromptNames.verifyChange,
    title: "Verify this change",
    description:
      "Prove one code change on real devices: pick the affected flows, run them, read the proof report, and return a structured verdict.",
    requiredOperationIds: [
      "target.devices.list",
      "target.screenshot.capture",
      "lease.list",
      "app-map.get",
      "app-map.diff.impact",
      "app-map.test.run",
      "job.get",
      "run.get",
      "run.evidence.get",
      "run.story.get",
      "run.repair.list",
      "run.repair.propose",
      "run.share.create",
    ],
  },
] as const satisfies readonly RelayMcpPromptDescriptor[];

export function relayMcpPromptsForTools(
  tools: readonly Pick<RelayMcpToolDescriptor, "operationId">[],
): readonly RelayMcpPromptDescriptor[] {
  const available = new Set<OperationId>(tools.map(({ operationId }) => operationId));
  return relayMcpPrompts.filter(({ requiredOperationIds }) =>
    requiredOperationIds.every((operationId) => available.has(operationId)),
  );
}

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
          "3. Describe the current unique screen, known outgoing connections, uncertainty, and a smallest-next-step exploration plan. Do not claim a screen or connection exists until Relay evidence supports it. Author only screens, connections, Variables (lists like language), graph-native scenario Tests, and Combines (Variable × Test). Map flows are navigation evidence, never Tests or Test-conversion inputs. Do not invent a second recipe library.",
          "",
          "Bounded exploration and proposal:",
          `4. The user delegates at most ${actionBudget ?? 20} reversible Target interactions for this exploration. Check relay_lease_list and acquire only the required Target lease with relay_lease_create if needed. Do not take over or release another actor's lease.`,
          "5. Create a Discovery session for this Target and App Map, then start the server-owned explore job with relay_discovery_start. Do not hand-build a crawl loop. Poll relay_discovery_get until the job completes or you are asked to stop.",
          "6. Each distinct screen change becomes one pending proposal. Re-read the App Map revision, then stop. Do not approve proposals, merge screen identities, or mark verification complete. A reviewer Keeps or Skips each edge.",
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

function registerMatrixPrompt(server: McpServer, scope: RelayPromptScope): void {
  const descriptor = relayMcpPrompts[3];
  server.registerPrompt(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      argsSchema: z
        .object({
          projectId: projectSchema(scope.projectId),
          targetId: relayIdentifier.describe("Explicit Target ID used for preflight and execution"),
          appMapId: relayIdentifier.describe("Explicit App Map containing Variables and Tests"),
          goal: z.string().min(3).max(500).describe("Plain-language coverage goal"),
        })
        .strict(),
    },
    ({ projectId, targetId, appMapId, goal }) =>
      prompt(
        [
          `Plan a Combine for “${goal}” in App Map ${appMapId}, project ${projectId}, using Target ${targetId}.`,
          "",
          sharedSafety(projectId),
          "",
          "Observation and plan (no mutation):",
          `1. Read ${relayMcpResourceUris.project}, relay://app-maps/${appMapId}, ${relayMcpResourceUris.targets}, and relay://targets/${targetId}/observation. Verify all identities match this request. Capture a native image/png with relay_target_screenshot_capture only if current Target state is needed.`,
          "2. Reuse App Map Variables and graph-native scenario Tests as the work performed once. Explain the exact formula, selected values, coverage strategy, checks, screenshots, estimated duration, and any missing reviewed entry/exit actions. Connections and Flows are navigation evidence, never alternate Test formats. Never create a second recipe library.",
          "3. Prefer cartesian coverage for every combination, zip only for intentionally paired rows, and pairwise only when the full product is too large. Evidence policy is per test: every screen, final screen, failures only, or none.",
          "   For long localized lists, preserve semantic row/connection bindings and complete recorded row order. Relay seeks live localized rows through overlapping viewports; never encode translated labels or fixed scroll distances as new tests.",
          "   Use full-surface capture only for stable product-owned pages whose below-fold content matters; preserve the source viewports and trees. Treat App Language destinations that open OS Settings as reversible handoffs: verify the expected package, capture once, and return instead of traversing the system list.",
          "4. If the required Variable or Test is absent, propose the smallest authoring work first. Otherwise propose one saved Combine ID and ask for explicit user confirmation before saving or running it.",
          "",
          "Save, preflight, and run (only after explicit confirmation):",
          "5. Re-read the App Map revision. Prefer relay_app_map_test_run with in (Variable id → value ids) and lens (visual or smoke). That upserts the Combine, fills default Target bindings, and starts one cell unless executionMode is all. Equivalent CLI: relay test run <appMapId> <testId> --in language=ja,pt --lens visual. Never invent a Variable for screenshots — capture is a lens, not a dimension.",
          "6. A saved grid uses relay_job_combine_start (CLI: relay combine run <appMapId> <combineId> --cell ja). Default is one cell / pilot. --all or executionMode all is explicit. A default Target fills missing cell bindings; per-cell cellRuntimeProfiles remain overrides for two devices or two profiles.",
          "7. Call relay_app_map_combine_preflight when reviewing a large grid. Stop on real blockers: missing Variable, empty selection, a Variable that cannot apply, compile failure, device not ready, or missing lease. Do not fail only because every cell was not ticked by hand.",
          "8. A single Test with no Variables still uses relay_app_map_test_run without in. Export the portable screenshot report with relay_job_combine_export only for an existing completed batch. Report the batch ID and exported artifact, never arbitrary filesystem contents.",
        ].join("\n"),
        descriptor.description,
      ),
  );
}

function registerGraphTestPrompt(server: McpServer, scope: RelayPromptScope): void {
  const descriptor = relayMcpPrompts[4];
  server.registerPrompt(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      argsSchema: z
        .object({
          projectId: projectSchema(scope.projectId),
          targetId: relayIdentifier.describe("Explicit Target ID used only for the approved run"),
          appMapId: relayIdentifier.describe("Explicit App Map containing the Test"),
          testId: relayIdentifier.describe("Stable Test identifier to create or refine"),
          goal: z.string().min(3).max(500).describe("Plain-language behavior to verify"),
        })
        .strict(),
    },
    ({ projectId, targetId, appMapId, testId, goal }) =>
      prompt(
        [
          `Author graph Test ${testId} for “${goal}” in App Map ${appMapId}, project ${projectId}, using Target ${targetId} only for an approved run.`,
          "",
          sharedSafety(projectId),
          "",
          "Read and design (no mutation):",
          `1. Read relay://app-maps/${appMapId}/tests. If it contains ${testId}, read relay://app-maps/${appMapId}/tests/${testId}; if that detail is truncated, read relay://app-maps/${appMapId}/tests/${testId}/outline and continue with /outline/1, /outline/2, or /outline/3 only while remainingStepCount is positive. Verify the App Map, Test, stable step IDs, and revision match this request.`,
          "2. Express the goal with the smallest clear graph using instruction, validation, extraction, manual, module, decision, loop, or script steps. Prefer mapped connections, screens, and routines over scripts. Keep unresolved bindings explicit; never invent an entity ID.",
          "   For target repair, prefer identifier, then label/text, then coordinates. When a pixel offset is intentional but the control can move, use point.relativeTo with a stable element identifier and 0..1 xRatio/yRatio; use a viewport-pinned point only when no stable element exists. Never use a translated label as a Variable anchor.",
          "3. Present the proposed Test tree, evidence policy, unresolved bindings, and semantic edits. Ask for confirmation before creating or proposing changes.",
          "",
          "Create or propose (only after explicit confirmation):",
          "4. Re-read the Test resource immediately before mutation. If the Test does not exist, create it once with relay_app_map_test_save and a stable eventId. If it exists, use relay_app_map_test_propose with stable-ID edits and the exact revision; do not replace the whole Test or approve your own proposal.",
          "5. Compile with relay_app_map_test_compile. Report compiler errors against the authored step ID and stop if any binding is unresolved. Check that compiler provenance covers every executable Test step.",
          "",
          "Run and evidence (only after separate run confirmation):",
          "6. Re-read the App Map revision, verify the explicit Target is connected, then inspect or acquire only its lease. Start exactly this Test with relay_app_map_test_run using appMapId, testId, expectedRevision, and target {kind, platform, targetId}. To run it in other worlds, pass in and lens — never invent a Variable for screenshots.",
          "7. Follow the returned job ID with relay_job_get. Cancel only when asked or when the user-defined stopping condition is met. Do not infer success from transport success.",
          "8. Read relay_run_get and relay_run_evidence_get with the terminal job ID. Report outcome, failed authored step/provenance, immutable evidence counts, and remaining uncertainty separately.",
          "9. If the run fails, repair the source Test through another reviewed stable-ID proposal or repair its mapped Connection, compile again, and rerun only after confirmation. Never edit immutable run evidence or silently weaken the check.",
        ].join("\n"),
        descriptor.description,
      ),
  );
}

function registerVerifyChangePrompt(server: McpServer, scope: RelayPromptScope): void {
  const descriptor = relayMcpPrompts[5];
  server.registerPrompt(
    descriptor.name,
    {
      title: descriptor.title,
      description: descriptor.description,
      argsSchema: z
        .object({
          projectId: projectSchema(scope.projectId),
          commitSha: z
            .string()
            .regex(/^[0-9a-f]{7,40}$/)
            .optional()
            .describe("Commit under verification; omit when verifying uncommitted work"),
          changedFiles: z
            .string()
            .max(8000)
            .optional()
            .describe(
              "Changed file paths, one per line; provide when no impact query is available",
            ),
          appMapId: relayIdentifier.optional().describe("Restrict verification to one App Map"),
        })
        .strict(),
    },
    ({ projectId, commitSha, changedFiles, appMapId }) =>
      prompt(
        [
          `Prove the current change for project ${projectId}${
            appMapId ? `, restricted to App Map ${appMapId}` : ""
          }${commitSha ? ` at commit ${commitSha}` : ""}.`,
          "",
          sharedSafety(projectId),
          "",
          "Scope (no mutation):",
          `1. Establish impact. Derive the changed file paths ${
            changedFiles
              ? `from the provided list (${changedFiles.split("\n").filter(Boolean).length} files)`
              : "from your VCS context (for example git diff --name-only against the base branch)"
          }, then call the relay_app_map_diff_impact tool with ${
            appMapId ?? "{appMapId}"
          } and changedFiles to get the affected Test ids. Never guess flows that neither the tool nor the changed files name.`,
          `2. Read ${relayMcpResourceUris.appMaps}${appMapId ? "" : " to find candidate maps"} and relay://app-maps/${appMapId ?? "{appMapId}"}/tests. Select the smallest set of saved graph Tests whose steps traverse the impacted screens and connections. Prefer existing Tests; propose new authoring only if nothing covers the change, and stop for approval before creating anything.`,
          "",
          "Run (only after explicit confirmation):",
          `3. Verify or acquire only the required Target lease without displacing another actor. Run each selected Test once with relay_app_map_test_run using expectedRevision and an explicit target${
            commitSha
              ? `, and bind the proof to this change by passing sourceRevision {vcs: "git", sha: "${commitSha}"}`
              : ' (pass sourceRevision {vcs: "git", sha} when verifying committed work so proofs attach to the commit)'
          }. Do not widen to unrelated Tests to look thorough.`,
          "4. Follow each returned job ID with relay_job_get. Do not infer success from transport success.",
          "",
          "Proof and verdict:",
          `5. For every terminal run, read relay://runs/{runId}, relay_run_evidence_get, and relay_run_story_get. Read relay://runs/{runId}/repair-proposals on failure instead of re-deriving screen mismatches by hand.`,
          "6. On failure, call relay_run_repair_list and relay_run_repair_propose for the failed check, then return a precise failure digest to the coding agent: failed authored step, expected versus observed destination, repair proposals with confidence, immutable evidence counts, and the exact rerun command. Never weaken a check to make it pass.",
          "7. Return a structured verdict: verdict passed | product-failure | harness-failure | uncertain, per-run outcomes with run IDs and share links created through relay_run_share_create for reviewers, affected Tests executed, evidence references, and remaining uncertainty. Rerun only the affected flows after a fix — never the whole suite unless asked.",
        ].join("\n"),
        descriptor.description,
      ),
  );
}

export function registerRelayPrompts(
  server: McpServer,
  scope: RelayPromptScope,
  tools: readonly RelayMcpToolDescriptor[],
): void {
  const available = new Set(relayMcpPromptsForTools(tools).map(({ name }) => name));
  if (available.has(relayMcpPromptNames.mapAppSafely)) registerMapPrompt(server, scope);
  if (available.has(relayMcpPromptNames.repairFailedConnection))
    registerRepairPrompt(server, scope);
  if (available.has(relayMcpPromptNames.reviewTake)) registerReviewPrompt(server, scope);
  if (available.has(relayMcpPromptNames.planCombine)) registerMatrixPrompt(server, scope);
  if (available.has(relayMcpPromptNames.authorGraphTest)) registerGraphTestPrompt(server, scope);
  if (available.has(relayMcpPromptNames.verifyChange)) registerVerifyChangePrompt(server, scope);
}
