---
name: relay-proof
description: Prove an AI-authored change with Relay before merge. Use the server-owned active workspace, affected journey selection, exact builds and targets, deterministic evidence, and bounded repair reruns.
---

# Relay Proof

Relay answers whether a specific code change has earned permission to merge.
Keep this workflow change-first and evidence-first.

## Start from the active workspace

Call `relay_workspace_change_inspect` before impact analysis. Treat its
server-owned repository, branch, base, head, summary, changed files, and local
edit status as authoritative. Restored tabs, browser history, a previously
open Proof, or manually supplied repository/SHA text never determine the
current change. If local edits are not represented by the frozen head, stop
and report the block. Ask for a base only when Relay reports a real ambiguity.

## Prove the change

1. Inspect the workspace and the relevant App Map/Test resources.
2. Call `relay_app_map_diff_impact` with Relay's changed files; explain each
   selected journey and every coverage gap.
3. Assemble one exact Verification Plan with source revision, build digests,
   target cases, evidence policy, budgets, and residual risk.
4. Start one Proof with `relay_proof_start`, then inspect it before decisions.
5. Ask a human to approve the frozen plan. Agents must never self-approve;
   `relay_proof_plan_approve` is confirmation-protected.
6. After human approval, call `relay_proof_run` exactly once with the Proof id,
   exact version, and `wait: true`. The server-owned coordinator runs the
   frozen Verification Cells, persists progress, and returns a durable
   execution summary; do not orchestrate per-Test jobs or poll provider jobs.
7. Call `relay_proof_inspect` for the same Proof and inspect its durable proof,
   execution summary, Run IDs, evidence, and uncertainty. Return the
   deterministic Proof decision, first causal failure, evidence references,
   gaps, and residual risk.

If explicitly recovering or importing already persisted legacy Runs, use the
exact Proof version with `record-runs` through `relay_proof_continue`. This is a
recovery path only and does not replace the normal server-owned execution.

## Repair safely

Give the coding agent a bounded repair packet: failed journey and step,
target, expected versus observed, screenshot/semantic evidence, relevant logs,
and one exact rerun command. Never edit immutable evidence or weaken a check.
After a fix, use `relay_proof_rerun_affected` to create a replacement Proof;
preserve the old Proof and rerun only affected cases under the new head/build.

## Safety invariants

- Use one configured Relay project and preserve server-provided actor identity.
- Treat leases, expected revisions, idempotency keys, and Proof versions as
  mandatory concurrency boundaries.
- Never infer a result from an HTTP 2xx, a queued job, a screenshot alone, or
  a tab restored from an earlier session.
- Keep tokens and credentials in environment variables only.
- `needs-review`, `insufficient-evidence`, and `outcome-unknown` stay visible;
  do not convert uncertainty into green.
