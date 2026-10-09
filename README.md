<div align="center">

<img src="./packages/desktop/resources/relay-icon.png" alt="Relay logo" width="112" height="112" />

# Relay

**Say what should work. Relay tests it on your website, Android, or iOS app.**

</div>

Write a test the way you would explain it to a colleague:

> Creating an API key shows it in the list

Relay turns that into short steps and runs them in a real browser or on a real device:

```text
Action   Open the API keys page
Action   Create a new API key
Check    The new key is listed
```

Each run ends with a clear answer. When a check fails, Relay says what it expected and what it
saw, with the screenshot:

```text
✗ The new key is listed
  Expected  The new key is listed
  Saw       The list is empty and an error says "Permission denied"
```

Every run also teaches Relay your app. The **Map** fills in with the screens runs reach and how
they connect, and shows which screens pass, which fail, and which no test has reached yet. You
never have to draw it or approve it.

Relay runs locally: your tests, runs, and screenshots stay in your project. Coding agents can do
everything you can, over MCP or the CLI.

## Get started

Install **Node.js 24+**, **pnpm**, and the **Vite+ CLI** (`vp`), then:

```bash
git clone https://github.com/bernaferrari/relay.git
cd relay
vp install
pnpm dev:desktop
```

1. Choose **New test**, describe what should work, and enter your website address.
2. Relay writes the steps. Edit any of them, then run the test.
3. Open the run to see the result for each step.

Plain-English steps use a model. Paste an [OpenRouter](https://openrouter.ai) key in
**Settings → Advanced**, or set `OPENROUTER_API_KEY`. The key stays on your computer.

Prefer to show instead of tell? Leave the description empty and choose **Start recording**: your
clicks and typing become steps. Recorded steps replay exactly, without a model.

To test a phone or tablet, choose **Phone or tablet** in New test. Android needs `adb`; iOS
devices need Xcode. Run `pnpm doctor` to check what is missing. To use Relay in a browser
instead of the desktop app, run `pnpm dev:web`.

### Try it without an account or key

```bash
pnpm ensure:serve
pnpm demo
```

The demo opens a small local website with a layout bug, runs a saved test that catches it,
fixes the site, and runs the same test again. See the [first-test guide](./docs/FIRST_TEST.md).

## For coding agents

Relay includes a [plugin with agent skills](./plugins/relay-proof/README.md), an
[MCP server](./packages/mcp/README.md), and a CLI. An agent can describe a test, run it, read
the result, and look at the Map, the same way you do in the app.

```bash
./bin/relay device list --json
./bin/relay run <test-id> --map <app-id> --device <serial> --json
./bin/relay export <run-id> --out ./review --json
./bin/relay guide
```

Guides are bundled with the code (`./bin/relay guide`, `relay-mcp guide`, or `relay://guides`)
and need no server, model, or credentials.

## Going further

- [The Map](./docs/MAP.md): how runs grow it, and how to fix a screen it got wrong.
- [Plans and Data sets](./docs/PLANS.md): run tests together, repeated with different inputs,
  languages, or devices.
- [Packaged runtime](./packages/runtime/README.md): run Relay from a local tarball without the
  repository sources.

## Working on Relay

Use `vp check` for formatting and lint, `pnpm typecheck` for type checks, and `pnpm test` for the
tests. `pnpm test:coverage` writes LCOV reports; CI requires at least 70% line coverage on changed
source. The [product contract](./PRODUCT_CONTRACT.md) defines the public routes, vocabulary, and
interaction rules checked in CI.

Relay is in active development, and device support varies by platform.
