import { McpServer, type GetPromptResult } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { relayMcpResourceUris } from "./resources.js";
import type { OperationId } from "@relay/protocol";
import type { RelayMcpToolDescriptor } from "./tools.js";

export const relayMcpPromptNames = {
  verifyChange: "relay_prove_this_change",
} as const;

export type RelayMcpPromptDescriptor = {
  readonly name: (typeof relayMcpPromptNames)[keyof typeof relayMcpPromptNames];
  readonly title: string;
  readonly description: string;
  readonly requiredOperationIds: readonly OperationId[];
};

export const relayMcpPrompts = [
  {
    name: relayMcpPromptNames.verifyChange,
    title: "Prove this change",
    description:
      "Prove one code change on real devices: pick the affected flows, run one approved server-owned Proof, inspect its durable report, and return a structured verdict.",
    requiredOperationIds: [
      "proof.prepare",
      "proof.start",
      "proof.list",
      "proof.inspect",
      "proof.plan.approve",
      "proof.run",
      "proof.continue",
      "proof.cancel",
      "proof.publication.retry",
      "proof.rerun-affected",
      "workspace.change.inspect",
      "target.devices.list",
      "target.screenshot.capture",
      "lease.list",
      "app-map.get",
      "app-map.diff.impact",
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

function registerVerifyChangePrompt(server: McpServer, scope: RelayPromptScope): void {
  const descriptor = relayMcpPrompts[0];
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
          `1. Establish impact. Call relay_workspace_change_inspect first. The active Relay workspace is authoritative; restored tabs, browser history, and manually supplied Git/SHA text never choose the change. ${
            changedFiles
              ? `Use the provided changed-file list only as an explicit comparison (${changedFiles.split("\n").filter(Boolean).length} files).`
              : "Use its server-owned changed-file list; do not infer a base or head from UI history."
          } Then call the relay_app_map_diff_impact tool with ${
            appMapId ?? "{appMapId}"
          } and the authoritative changedFiles to get affected Test ids. Never guess flows that neither Relay nor the workspace change names.`,
          `2. Read ${relayMcpResourceUris.appMaps}${appMapId ? "" : " to find candidate maps"} and relay://app-maps/${appMapId ?? "{appMapId}"}/tests. Select the smallest set of saved graph Tests whose steps traverse the impacted screens and connections. Prefer existing Tests; propose new authoring only if nothing covers the change, and stop for approval before creating anything.`,
          "",
          "Create and approve the Proof (with the appropriate human decision):",
          `3. Assemble one exact Verification Plan from the changed source, matching builds, affected Test journeys, target cases, evidence policy, coverage gaps, and residual risk. ${
            commitSha
              ? `Bind it to sourceRevision {vcs: "git", sha: "${commitSha}"}.`
              : 'When verifying committed work, bind it to the authoritative sourceRevision {vcs: "git", sha} rather than a manually supplied SHA.'
          } Start it with relay_proof_start, then retain its proof id and version. Use relay_proof_list to find existing project Proofs before starting a duplicate.`,
          "4. Inspect the server-owned record with relay_proof_inspect before every decision. A human reviewer must approve the frozen plan with relay_proof_plan_approve and confirm: true; agents must not approve their own plan. Use relay_proof_continue with the exact version for a bounded plan revision, review request, or return to planning.",
          "",
          "Run (only after the Proof is approved):",
          "5. Call relay_proof_run exactly once for this approved Proof with { proofId, expectedVersion, wait: true }. The server-owned coordinator runs the frozen Verification Cells, owns Target leases and dispatch, persists progress across client disconnects, and returns one bounded execution summary. Do not orchestrate individual Test executions or poll provider state from the client; do not widen to unrelated Tests to look thorough.",
          "6. Immediately call relay_proof_inspect for the same proofId and treat its durable proof and execution summary as authoritative. Inspect the final proof state, execution status, cursor, Run IDs, next action, and any terminal uncertainty; never infer success from a transport response or a queued status.",
          "7. If a human explicitly requests recovery/import of already persisted legacy Runs, use relay_proof_continue with the exact version and action record-runs, supplying only verified durable runIds. This is not normal execution: do not use it to launch Tests, substitute client verdicts, or bypass the server-owned coordinator.",
          "",
          "Proof and verdict:",
          `8. For every terminal Run ID, read relay://runs/{runId}, relay_run_evidence_get, and relay_run_story_get. Read relay://runs/{runId}/repair-proposals on failure instead of re-deriving screen mismatches by hand.`,
          "9. On failure, call relay_run_repair_list and relay_run_repair_propose for the failed check, then return a precise failure digest to the coding agent: failed authored step, expected versus observed destination, repair proposals with confidence, immutable evidence counts, and the exact rerun command. Never weaken a check to make it pass.",
          "10. Return a structured verdict: verdict passed | product-failure | harness-failure | uncertain, per-run outcomes with run IDs and share links created through relay_run_share_create for reviewers, affected Tests executed, evidence references, and remaining uncertainty.",
          "11. After a code fix, call relay_proof_rerun_affected with the prior Proof's exact version and the affected change/plan scope to create a replacement Proof. Rerun only the affected flows after a fix — never the whole suite unless asked. Use relay_proof_continue for a bounded plan correction and relay_proof_cancel with confirm: true only when explicitly asked to stop.",
          "12. If relay_proof_inspect reports an exhausted merge-check publication, retain its exact publication id and immutable Proof version, then call relay_proof_publication_retry once with confirm: true. This is a bounded recovery: inspect before retrying, make at most this one additional delivery attempt, inspect again, and stop on any new exhaustion or conflict. Report whether Relay reconciled an existing provider receipt or accepted the one additional attempt; never create a replacement check identity.",
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
  if (relayMcpPromptsForTools(tools).length > 0) registerVerifyChangePrompt(server, scope);
}
