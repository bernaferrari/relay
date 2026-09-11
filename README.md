<div align="center">

# Relay

### Record a journey. Run it again. See what changed.

Local-first testing for web, Android, and iOS.
Built for people and coding agents.

[Get started](#get-started) · [How it works](#one-test-many-cases) · [Documentation](#go-deeper)

</div>

![Relay’s App map connecting captured Android screens and their navigation paths.](./docs/images/relay-app-map.png)

<p align="center"><sub>Real screens, reusable Tests, and the evidence to understand every result.</sub></p>

## From “it should work” to seeing it work

Relay brings your app, its user journeys, and their results into one workspace. Explore a browser or device, record a Test, then replay it with the languages and targets you choose. Inspect the screenshots, interface trees, and logs that explain what happened.

Your devices. Your local service. Your saved evidence.

| Explore                                                                                | Test                                                                                  | Understand                                                                        |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Navigate the **App map**, browse captured screens, and inspect the paths between them. | Record a journey once. Run it again, or run it across selected languages and devices. | Open **Results** to inspect captures, steps, failures, and available diagnostics. |

## One Test, many cases

A **Test** is the reusable journey. A **Run** is one execution of it. **Results** is where you review those executions.

For example, checking a pricing page in ten languages can be one Test:

```text
Open the page → Capture Individual → Click Business → Capture Business
```

Choose the language values in **Run across**, run the first case, and review its result before continuing with the remaining cases. Keep the same journey while changing the data.

- **Screenshots and interface trees** give you visual and structural evidence to compare.
- **Steps and logs** help you locate where a journey failed.
- **Saved run context** preserves the Test and target used for that execution.
- **Desktop, CLI, and MCP** share Relay’s workflows and evidence.

Available evidence depends on the target and capture settings. The report makes missing or unavailable evidence visible.

## Get started

Use **Node.js 24+** and **Corepack**. Android targets also need `adb`; physical iOS devices need the Apple developer tooling described in the [device setup guide](https://oss.callstack.com/agent-device/docs/quick-start).

```bash
corepack pnpm install --frozen-lockfile
pnpm doctor
pnpm dev:desktop
```

The desktop app starts the local Relay service for your project.

1. Choose a browser or connected device.
2. Select **Record test** and walk through the journey.
3. Review the recorded actions and save the Test.
4. Run it, then open **Results** to inspect the evidence.
5. Use **Run across** when you are ready to repeat it with more values or targets.

Prefer a browser window? Run `pnpm dev:web` and open the local URL printed in the terminal.

## For coding agents, too

Use Relay from the terminal or connect its [MCP adapter](./packages/mcp/README.md) to your agent. The same saved Tests and evidence are available outside the desktop UI.

```bash
pnpm relay connect
pnpm relay run settings-localization
pnpm relay export-evidence <run-id>
```

The example assumes you already saved a Test named `settings-localization`. See the [CLI and automation guide](./docs/LOCAL_WORKFLOWS.md) for recording, language runs, browser control, service setup, and recovery.

For change verification, Relay also supports revision-bound Proof workflows and GitHub Checks. See [PR proof integration](./docs/PR_PROOF_CI.md) for the current setup and boundaries.

## Local by default

The normal desktop workflow uses a loopback service and stores evidence in your project. You operate the browsers and devices. Remote serving and evidence sharing are explicit, self-managed features.

Relay is pre-release. Browser, Android, and iOS capabilities differ, and real-device setup still matters. See [product flows](./docs/PRODUCT_FLOWS.md) and [readiness](./docs/ENTERPRISE_READINESS.md) for the details.

## Develop

```bash
pnpm dev:web        # React app + local service
pnpm dev:desktop    # Electron app + local service
vp check           # Formatting and lint
pnpm typecheck     # Workspace type checks
pnpm test          # Package and runtime tests
```

Use `pnpm doctor` for setup issues and `pnpm server:doctor` to inspect a running service. The [architecture guide](./ARCHITECTURE.md) explains the package boundaries; the [development guide](./docs/LOCAL_WORKFLOWS.md#develop-and-verify) covers the full verification workflow.

## Go deeper

| Guide                                           | What you’ll find                                   |
| ----------------------------------------------- | -------------------------------------------------- |
| [Product flows](./docs/PRODUCT_FLOWS.md)        | Recording, reviewing, and running Tests            |
| [Browser capture](./docs/BROWSER_CAPTURE.md)    | Browser control, language captures, and comparison |
| [Language runs](./docs/LANGUAGE_SWEEP_LOOP.md)  | Repeatable localization workflows                  |
| [CLI and automation](./docs/LOCAL_WORKFLOWS.md) | Commands, evidence export, and service operation   |
| [MCP adapter](./packages/mcp/README.md)         | Connect an agent to Relay                          |
| [Architecture](./ARCHITECTURE.md)               | How the system fits together                       |
