# Relay support for upstream e2e

Opt-in, pinned integration for `e2e@0.20.0`. Relay's existing visual/YAML execution remains available. This package runs the real upstream program; it never translates TypeScript into Relay instructions.

## Add a reporter to a trusted project

Build this workspace package (`pnpm --filter @relay/e2e build`) and make it available to the project alongside `e2e@0.20.0`:

```ts
import { relayReporter } from "@relay/e2e";

export default {
  // Keep the project's original targets, engines, fixtures, models and settings.
  ...existingConfig,
  reporters: [
    ...(existingConfig.reporters ?? ["list"]),
    relayReporter({ directory: "/absolute/path/to/relay-evidence", requireHumanReview: true }),
  ],
};
```

The reporter has no constructor filesystem effects. Workers can safely instantiate it while loading configuration. Live events enter a bounded local queue; duplicate sequence deliveries are ignored. `event-stream.json` records dropped events and write failures, while the final report reconciles results, attempts and steps. No network uploads happen in `onEvent`.

Each durable run directory contains the untouched `report.json`, a separate `receipt.json`, `events.jsonl`, and content-addressed artifact copies. Result, target, agent, repeat, attempt, step, configuration and runner identities remain in the upstream document. Serial-group and carried artifacts are retained with their own attribution. Source trace-page paths are retained as provenance; trace pages are not yet independently copied.

Import is idempotent for an identical report. A different report under the same upstream run identity is rejected. Local paths and symlink destinations must stay inside the declared artifacts directory. Hash/size mismatches, missing files, external URLs and incomplete redaction remain explicit unavailable evidence. The prototype does not bypass upstream secret/screenshot policy or download remote evidence.

## Open a project in Relay

Build this package, start Relay, and choose **Tests → Open project**. The project must install e2e 0.20.0 with its configured web engine. Explicitly trust its executable configuration before collection. Relay generates a temporary reporter wrapper without rewriting Test source or config. Results use the existing Run gallery, review decisions, and exports. The original upstream report is included in the evidence export.

A `relay.evidence.json` file can declare `obligations`, `requiredArtifactKinds`, and `maxArtifactBytes`. The project workflow always requires human review. Required capture declarations are frozen per execution. Optional diagnostics do not block screenshot-only acceptance. Retry evidence import uses retained reports and artifacts only; it never reruns application actions. `import-progress.json` permits recovery after an interrupted artifact copy, and `import-spec.json` preserves report and policy identity.

See the [UI and CLI walkthrough](../../packages/site/content/docs/agents/e2e.mdx) for the complete project path. The package remains private; no public install or mobile compatibility is implied.

## Run through Relay's process adapter

```ts
import { runE2EProject } from "@relay/e2e";

await runE2EProject({
  projectRoot: "/absolute/path/to/trusted-project",
  trust: "trusted-project",
  args: ["--config", "e2e.config.ts"],
  signal,
});
```

This launches the project's installed, pinned upstream CLI with argument arrays, without a shell. The config must include the reporter to import live events and evidence. Cancellation forwards SIGINT to upstream; e2e owns scheduling, retries, cleanup and its final verdict.

Tests, configuration, engines and reporters are executable code. The caller must obtain project trust **before** invoking this function. A child process is not a security sandbox. Do not run unfamiliar repositories just because a folder was opened.

## Separate verdicts

An e2e failure, blocked result or interrupted execution stays exactly that in `report.json`. `receipt.upstream` records its verdict and exit code. Relay's separate evidence gate can be `blocked`, `execution-not-passed`, `pending-review`, or `evidence-ready`; none of these rewrites upstream status or means organizational release acceptance.

An optional `obligations` list declares expected screenshot checkpoints by test ID, target ID and exact upstream `app.screenshot` label, with optional agent/repeat disambiguation. Use a one-based `occurrence` when labels repeat. Overlapping declarations are rejected as ambiguous. Import requirements are immutable for an execution; changed requirements require a new execution or explicit import revision. Only the final ordinary-test attempt satisfies a checkpoint. Ambiguous variants and serial-group coverage are not guessed. Without a declaration, there is no invented planned denominator. The standalone receipt keeps human review pending. The server project workflow projects captures into Relay’s existing Run history and human-review queue; imported captures do not automatically become approved references.

## Qualification

```sh
pnpm --filter @relay/e2e exec e2e-web install chromium
pnpm --filter @relay/e2e test
E2E_TELEMETRY_DISABLED=1 pnpm --filter @relay/e2e test:upstream
```

The second command uses the published upstream web engine and an owned local HTTP fixture. It runs the same test source directly and with the reporter, compares fixture/hook/conditional/data-variant/assertion/retry semantics, checks screenshot-only evidence, and compares direct/reporter-backed interrupted runs. Proof is written to `.relay/e2e-conformance/proof.json`. No model or physical device is required.

## Scope and next stage

The source-checkout web pilot now provides Tests → Open project, explicit trust, upstream discovery, original source viewing, run/cancel, separate import progress, retained Run history, human screenshot review, and evidence export. CLI and MCP full-profile operations use the same contract. Project execution rejects mobile engines until device ownership is qualified. Mobile engines, serial screenshot obligations, authentication fixtures, visual code generation, public distribution and organizational acceptance still need qualification.

The product choice should be **Relay** or **e2e**, with one authoritative source per Test. Keep native visual/YAML documents authoritative for Relay-managed Tests and `.e2e.ts` authoritative for code-managed Tests. Never silently flatten branches or overwrite edited code. Additional harnesses can be added after a real integration proves their semantics.

Upstream owns test programs, hooks, fixtures, assertions, attempts, retries and scheduling. Relay owns its imported evidence and human QA workflow. A Relay device engine is a later opt-in implementation, not a prerequisite for existing e2e users.

Consolidation follows proof: freeze/delete native execution machinery only for paths migrated with equivalent conformance. Manual device control, recording, account ownership and evidence/review policy remain Relay responsibilities. Do not retain two competing schedulers or retry loops on an e2e-backed run.
