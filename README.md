<div align="center">

<img src="./packages/desktop/resources/relay-icon.png" alt="Relay logo" width="112" height="112" />

# Relay

**Record a user flow. Replay it with your coding agent. Review the screenshots.**

</div>

Relay records reusable tests for websites, Android apps, and iOS apps, then keeps each run's screenshots and results together. Use the desktop app to record your actions, or ask your coding agent to run saved tests and inspect the same evidence.

**[Run your first test and open its screenshots](./docs/FIRST_TEST.md)** — a complete local browser demo with a saved test, a fresh replay, and a layout defect to review. It needs no account or model key.

A test can be as simple as opening a menu or as involved as going through checkout. Along the way, you can check that something appears, wait for a response, or capture a screenshot. When you run the test again, Relay shows the result of each step. You can compare screenshots with earlier versions and decide whether a change looks right.

1. **Record:** choose a website or device, then use your app normally.
2. **Run:** save the test and repeat its steps on the selected app and account.
3. **Review:** open the result, inspect the screenshots, and report what looks wrong.

Relay includes a [plugin with an agent skill](./plugins/relay-proof/README.md), an [MCP server](./packages/mcp/README.md), and a CLI for coding agents and scripts. Agents can interact with your app, run saved tests, and inspect the same screenshots and results you see in the desktop app. Optional AI exploration lets you describe something to investigate, review the findings, and save a useful path as a test.

Your tests and results are stored locally in your project. Recording, replay, and screenshot review work without a model key; AI exploration uses a configured model provider. Relay is still in active development, and browser and device support varies by platform.

## Getting started

To run Relay from source, install **Node.js 24+**, **pnpm**, and the **Vite+ CLI** (`vp`), then:

```bash
git clone https://github.com/bernaferrari/relay.git
cd relay
vp install
pnpm dev:desktop
```

In the app, choose **New Test**, enter a website address, and choose **Start recording**. Your clicks and typing become test steps. Capture a screen you want to check, stop recording, and save the test. Run it again and open its screenshots. For a connected phone or tablet, choose the device option during setup.

Choose **Save test** to keep the recording. After changing steps, Relay checks them on the recorded target before saving; a failed or interrupted check keeps the review open. To keep unfinished work without executing it, choose **Save draft and close** from **More**. To run separately, choose **Run without saving**.

Run `pnpm doctor -- --web` to check website prerequisites. Relay uses an installed Chrome, Chromium, or Edge executable. For a custom installation, set `RELAY_BROWSER_EXECUTABLE` to its absolute path before starting Relay. Android requires `adb`, and physical iOS devices require Apple developer tooling; missing mobile tools do not block website testing. To use Relay in a browser, run `pnpm dev:web` instead.

### Try a complete test without an account or model key

From the installed source checkout:

```bash
pnpm ensure:serve
pnpm demo
```

The demo opens a controlled local website, records signing in as Member and opening Settings, captures **Member settings**, saves a reusable Test, and runs it again in a fresh browser. It prints the Test and Run IDs, a **Review** link, screenshot path, and exact repeat command. Open the Review link immediately: it serves a local read-only evidence gallery without the desktop app or a web dev server. The link expires after 24 hours and needs the Relay service to stay running. The [first-test guide](./docs/FIRST_TEST.md) explains prerequisites, the expected result, and repeating the test.

The demo deliberately includes a layout defect: **Save** overlaps the team seats. Open the retained screenshot to inspect it. Collection passing means the steps finished; human screenshot review remains pending. To record your decision, open **Demo · Member settings** in the desktop app's Review flow.

The demo website stays available for repeat runs until you press Ctrl+C. Starting `pnpm demo` again reuses the saved Test and runs it again. `pnpm demo -- --once` completes one run and closes the demo website.

This is the contributor workflow. The [packaged runtime candidate](./packages/runtime/README.md)
also runs this browser demo from a local tarball without repository sources:

```bash
npm install /absolute/path/relay-runtime-0.1.0.tgz
npx --no-install relay-runtime demo --workspace /absolute/path/my-project
```

It prints a local read-only evidence gallery and an installed repeat command.
Installing the matching MCP candidate alongside it lets the agent connector
attach or launch the canonical service for an explicitly chosen workspace.
The browser flow and authenticated startup/panel have separate qualification;
physical devices and a standalone desktop installer still need qualification.
These are local release artifacts, not published npm packages.

### Explore your app as tests grow

The App Map brings captured screens into one view, connected by the actions between them. Use it to inspect navigation or maintain shared screen identities after recording your first tests. You can also organize tests into plans and repeat them with different languages, data, or devices.

![Relay’s App Map showing captured screens and the paths between them.](./docs/images/relay-app-map.png)

## Agents and development

The plugin bundles MCP configuration and skills for setup, recording, run review, and code verification. Setup instructions cover Codex, Claude Code, and compatible MCP hosts. You can also use the CLI to run a saved test:

```bash
./bin/relay device list --json
./bin/relay run <test-id> --map <app-id> --device <serial> --json
./bin/relay export <run-id> --out ./review --json
```

Use the saved Test and App IDs, a serial from the device list, and the Run ID
returned by the run command. For a saved browser/account configuration, replace
`--device <serial>` with `--lane <lane-id>`. `./bin/relay --help` lists the available
commands. Optional AI exploration requires a configured model provider.

Task guidance is bundled with the code, so an agent can use it before connecting:

```bash
./bin/relay guide
./bin/relay guide record
./bin/relay guide waits
```

Installed MCP users can run `relay-mcp guide` or read `relay://guides` in any
profile. The guides cover setup, recording, running, targets, waits, debugging,
review, maps, and agent use. Reading them needs no server, model, or credentials.

### Keeping screen identity consistent

Keyboard and input focus states belong to the same logical screen. Capture automatically reuses a screen when current semantic evidence matches one saved app structure uniquely; it retains the new identity alias and capture. A shared title or sparse tree is insufficient to merge screens.

For existing duplicates, compare their captures in the App Map and use **Merge with another screen**. Agents can use `relay screen consolidate <appMapId> <targetScreenId>` with `mode:"same-screen"`, `sourceScreenIds`, the current `expectedRevision`, and `dryRun:true` in `--input`. Inspect the preview before applying without dry run. The merge retains evidence and executable actions, rewires saved Tests, and keeps input states selectable as captures. Replay an affected Test after merging.

The map places saved Test origins first and groups parallel paths into one wire. Click a grouped wire and use **Choose path** to inspect its individual actions. Return paths stay beside their screen until inspected so they do not obscure forward navigation.

If you’re making changes to Relay, use `vp check` for formatting and lint, `pnpm typecheck` for type checks, and `pnpm test` to run the tests.
`pnpm test:coverage` writes package LCOV reports; CI requires at least 70% line coverage across changed source in packages with a coverage script. The `ui-react` package contains shared UI components without a separate unit suite; product visual and accessibility checks cover its rendered use in the app.
The [product contract](./PRODUCT_CONTRACT.md) defines the public routes, vocabulary, and interaction rules checked in CI.
