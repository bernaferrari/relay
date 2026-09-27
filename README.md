<div align="center">

<img src="./packages/desktop/resources/relay-icon.png" alt="Relay logo" width="112" height="112" />

# Relay

**Record tests. Replay them. See what happened.**

A local-first testing workspace for web, Android, and iOS.<br />
Use the desktop app, automate from the CLI, or connect a coding agent through MCP.

[Get started](#get-started) · [How it works](#how-it-works) · [For coding agents](#for-coding-agents) · [Documentation](#documentation)

</div>

Relay helps you test real user flows and understand their results. Record actions, add checks, and replay a saved test. Inspect screenshots alongside the steps that produced them, review visual changes, and use logs and network activity to investigate failures.

The **App map** connects captured screens and the paths between them, so you can see what you have explored and turn those paths into reusable tests.

## How it works

1. **Record a test.** Open a website in Relay’s browser or connect a phone or tablet. Perform the actions you want to repeat, then add checks and screenshot checkpoints.
2. **Run it again.** Replay the saved test, group tests into a test plan, or use **Run across** with selected devices and data set values.
3. **Inspect the result.** Open **Runs** to see what happened at each step. Review screenshots against saved references and investigate failures with the available diagnostics.

A **test** describes what should happen. A **run** records what happened on one execution. A **reference** is an approved screenshot used for future comparisons.

Execution and screenshot approval are separate: a passing run can still have screenshots waiting for review. Recording, replay, and human screenshot review do not require model credentials.

| Capability                | What you can do                                                                  |
| ------------------------- | -------------------------------------------------------------------------------- |
| Recording and replay      | Save actions and checks as repeatable tests.                                     |
| Screenshot review         | Compare captures with references and approve intentional changes.                |
| App map                   | Browse known screens and the paths that connect them.                            |
| Test plans and Run across | Run groups of tests or selected combinations of devices and data.                |
| Run evidence              | Inspect captures, steps, logs, network requests, and performance when available. |
| CLI and MCP               | Use the same saved tests and evidence from scripts and coding agents.            |

Relay is pre-release. Browser, Android, and iOS capabilities differ; evidence availability depends on the target and capture settings.

## Get started

Run Relay from this repository with **Node.js 24+**, **pnpm**, and the **Vite+ CLI** (`vp`). Use the pnpm version declared in `package.json`.

```bash
git clone https://github.com/bernaferrari/relay.git
cd relay
vp install
pnpm doctor --json
pnpm dev:desktop
```

The desktop launcher starts the local Relay service. The doctor checks your workspace and reports optional browser, Android, and iOS setup separately. Android requires `adb`; physical iOS devices require additional Apple tooling.

In the app:

1. Open **Tests → New Test** and enter a website, or choose a connected device.
2. Record your actions and add the checks or screenshots you want to keep.
3. Stop recording, review the steps, and save the test.
4. Run the test. Open it from **Runs** to inspect its steps and captures.
5. Choose **Review screenshots** when captures need approval.

To use Relay in a browser instead, run `pnpm dev:web` and open the URL printed in the terminal.

## For coding agents

Relay’s [MCP adapter](./packages/mcp/README.md) and CLI expose the same workflows as the desktop app. An agent can run a saved test and inspect its evidence without driving Relay’s interface.

```bash
pnpm relay connect
pnpm relay run settings-localization
pnpm relay export-evidence <run-id>
```

This example assumes a saved test named `settings-localization`.

### Optional AI exploration

Give Relay a browser URL and a bounded goal to investigate before creating a test. This opt-in workflow requires `OPENROUTER_API_KEY` for model-driven exploration.

```bash
pnpm ensure:serve
pnpm relay goal run \
  --url http://localhost:3000 \
  --goal "Try to submit checkout with an empty cart; verify that no order is created" \
  --confirm
```

Inspect the findings and evidence, reproduce a completed path, then explicitly promote it into a test for review:

```bash
pnpm relay goal inspect <session-id>
pnpm relay goal reproduce <session-id> --confirm
pnpm relay goal promote <session-id> --confirm --title "Empty cart regression"
```

Exploration does not approve its own findings.

## Local by default

The normal desktop workflow runs a loopback service and stores evidence in your project. You control the browsers and devices. Remote serving and evidence sharing are explicit, self-managed features. Optional AI exploration sends observations to the configured model provider.

## Develop

```bash
pnpm dev:desktop    # Electron app + local service
pnpm dev:web        # React app + local service
vp check           # Formatting and lint
pnpm typecheck     # Workspace type checks
pnpm test          # Package and runtime tests
pnpm check:docs    # Documentation links and commands
```

Use `pnpm doctor` for setup issues and `pnpm server:doctor` to inspect a running service.

## Documentation

Longer guides and plans stay in the local checkout and are not part of this repository. The [MCP adapter](./packages/mcp/README.md) explains how to connect a coding agent.

## License

Relay is released under the [MIT license](./LICENSE).
