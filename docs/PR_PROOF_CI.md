# PR proof in CI

This workflow runs your app's ready Tests on a self-hosted runner with an attached device,
simulator, or browser, and fails the build when a Test fails. One command does it:

```bash
relay ci <app> --output result.json --junit junit.xml
```

It runs every ready Test of the app one after another (or only `--test "<name>"`, repeatable),
waits for each, prints one table, and writes:

- `result.json`: `{ totals, verdicts, skipped }`; each verdict has `status`, `summary`, `reason`,
  `runId`, and every step's `expected`, `saw`, and `screenshot`;
- `junit.xml`: one test case per Test for CI dashboards.

Tests that are not ready yet (drafts, steps still to record) are listed as skipped and do not fail
the build. `--device ios|android|browser|<name>` picks the device; a `relay.json` with
`{"app": "...", "device": "..."}` in the repository sets defaults. Paths are relative to the
directory you run `relay` from. The canonical single-Test command is
`relay run "<test>" --app <app> [--device <device>] [--out <dir>]`; it uses the same exit codes.

| Code | Meaning                                                                                                              |
| ---- | -------------------------------------------------------------------------------------------------------------------- |
| `0`  | every Test passed                                                                                                    |
| `1`  | at least one Test failed: the product did not do what the Test expects                                               |
| `3`  | nothing failed, but something could not run (device, sign-in, harness, no ready Test, or the server was unreachable) |
| `7`  | cancelled                                                                                                            |

`2` is a usage error and `11` means a named App, Test, or device does not exist; `relay --help`
lists the rest.

## Workflow

```yaml
name: pr-proof
on:
  pull_request:

jobs:
  proof:
    # Must be self-hosted: the runner needs an attached device or a local
    # simulator/emulator/browser that Relay controls.
    runs-on: [self-hosted, macos]
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install workspace (includes the relay CLI)
        run: corepack pnpm install --frozen-lockfile

      - name: Start headless Relay service
        run: corepack pnpm ensure:serve

      - name: Run the app's Tests
        run: ./bin/relay ci <app> --output result.json --junit junit.xml

      - name: Publish the results
        if: always()
        uses: actions/upload-artifact@v4
        with:
          name: relay-results
          path: |
            result.json
            junit.xml
```

To bind a single run to the code under test for a proof report, run the advanced form and read
the run id from the result envelope (`result`, not `data`):

```bash
relay test run <app-id> <test-id> --target current --revision current \
  --commit "$GITHUB_SHA" --json --wait > run-result.json
RUN_ID=$(node -e 'const r=require("./run-result.json");const d=r.result??{};console.log(d.job?.runId??d.runId??"")')
relay report emit --run "$RUN_ID" --format github-check
```

`relay report emit` exits 0 pass, 9 fail, 8 unproven (Relay could not execute).

## Notes

- Everyday commands start or reuse the local Relay server on the default address; with
  `--server`/`RELAY_URL` the server is yours to start. `pnpm ensure:serve` starts it explicitly
  (`scripts/ensure-server.mjs`). Give each concurrent worker its own `RELAY_STATE_DIR`.
- Device input uses exclusive server-owned control; a second actor fails closed with exit `6`
  rather than displacing whoever holds control.
- `report emit` reads persisted runs from local disk and does not require a running
  Relay process, so it works even after the service stops.
- The workflow above can write the report itself, or a long-running Relay server can publish Proof
  lifecycle Checks directly when
  `RELAY_GITHUB_REPOSITORY` and `RELAY_GITHUB_TOKEN` are both configured.
- Remote mobile artifacts must use HTTPS, resolve only to public addresses, and keep redirects on
  their registered origin. A reviewed private registry can be named explicitly with a
  comma-separated `RELAY_REMOTE_BUILD_ALLOWED_HOSTS`; do not use that escape hatch for arbitrary
  user-supplied hosts.

## GitHub pull-request intake boundary

Configure GitHub to send pull-request webhooks to `POST /webhooks/github`, then set all five
variables on the Relay server:

- `RELAY_GITHUB_WEBHOOK_SECRET` — the GitHub webhook secret;
- `RELAY_GITHUB_REPOSITORY` — exact `owner/repository`;
- `RELAY_GITHUB_TOKEN` — token used to re-read the pull request and publish Checks;
- `RELAY_GITHUB_ORGANIZATION_ID` and `RELAY_GITHUB_PROJECT_ID` — the exact Relay store scope.

If the webhook secret is absent, the route is not enabled. If it is present, missing or malformed
companion configuration fails server startup. The boundary accepts only `pull_request` `opened`,
`synchronize`, and `closed` deliveries. It:

1. preserves the raw request bytes and verifies `X-Hub-Signature-256` with its configured webhook
   secret before parsing;
2. binds each `X-GitHub-Delivery` id to the canonical payload digest in the existing transactional
   ControlStore, so replay identity survives restart;
3. calls `verifyGitHubPullRequest` with a GitHub token, then requires the signed payload repository,
   pull-request number, state, and head SHA to match the GitHub API response;
4. prepares the local Proof and requires its repository, pull request, and tested SHA to match that
   independently verified response before creating, cancelling, or superseding anything;
5. uses the existing Proof create/advance/cancel/supersede lifecycle and publication outbox for
   queued, in-progress, and terminal publication.

Delivery-id reuse with a different canonical payload, an outdated payload head, and a locally
checked-out head that differs from GitHub all fail closed. A repeated identical delivery is inert.

Each Proof version freezes its provider payload in the durable outbox. Creation and plan-ready
states publish `queued`; pilot and run states publish `in_progress`; terminal decisions publish
`completed` with a conclusion. Progress never carries a conclusion. Receipts preserve one GitHub
check-run identity only when provider, repository, head SHA, and Proof external id all match, so a
restart updates the acknowledged Check in place without allowing mutable process configuration to
rewrite its head or output. Cancellation and supersession complete as `action_required`; only the
exact durable `proved` decision can complete as `success`.

The retained automated suite covers signed intake, payload/API/local-head drift, delivery replay,
outbox restart recovery, exact receipt reconciliation, and queued-to-terminal Check updates. A live
GitHub provider exercise and visible green CI on the integrated head remain external acceptance;
local tests do not claim either result.
