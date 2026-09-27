<div align="center">

<img src="./packages/desktop/resources/relay-icon.png" alt="Relay logo" width="112" height="112" />

# Relay

**Record tests. Replay them. See what happened.**

Test your website or mobile app, and see every step along the way.

</div>

![Relay’s App map showing captured screens and the paths between them.](./docs/images/relay-app-map.png)

## Turn a walkthrough into a test

Open your website or connect your phone, then use your app as you normally would. Sign in, change a setting, send a message. Relay records the steps so you can repeat them whenever your app changes.

Add a check for something that should happen, or capture a screen you want to look at later. Save the test and run it again without doing the same work by hand.

## See what happened

When something goes wrong, open the result and follow the steps. See the screens Relay captured, find where the flow stopped, and inspect the details when you need them.

Review screenshots side by side with the ones you previously approved. Decide whether a change is expected or needs attention. You stay in control of what looks correct.

## Find your way around your app

The App map puts your screens and the connections between them in one place. Follow a path, inspect a screen, and see which parts of your app your tests cover.

It gives you a visual way to explore the product you’re testing, beyond a list of test names.

## Repeat the work that matters

Check your important flows together before a release. Try the same test in another language, with different data, or on another device. Keep the steps you already recorded and choose what changes between runs.

Relay works with websites, Android, and iOS. Support varies by platform, and Relay is still in active development.

## Work with your coding agent

Your agent can use Relay to run tests and inspect what happened while you review the results in the desktop app. You share the same tests, screenshots, and history.

You can also give Relay a goal to explore, such as checking whether an empty cart can reach checkout. Review what it finds and turn a useful path into a repeatable test. AI exploration is optional; recording, replay, and screenshot review work without an AI subscription or model key.

## Keep your work local

Relay runs on your computer and saves test results in your project. Connect your own browsers and devices, and choose what to share. Optional AI exploration uses a model provider to interpret observations from the app you’re testing.

## Try Relay

You’ll need **Node.js 24+**, **pnpm**, and the **Vite+ CLI** (`vp`).

```bash
git clone https://github.com/bernaferrari/relay.git
cd relay
vp install
pnpm dev:desktop
```

Choose **New Test**, open your website or select a device, and start recording. If you need help with setup, run `pnpm doctor` to see what’s missing. Android needs `adb`; physical iOS devices need Apple developer tooling.

<details>
<summary>For developers and coding agents</summary>

Use the [MCP adapter](./packages/mcp/README.md) to connect your coding agent. The CLI can run a test you have already saved:

```bash
pnpm relay connect
pnpm relay run settings-localization
pnpm relay export-evidence <run-id>
```

Replace `settings-localization` with your saved test’s name. Run `pnpm relay --help` to see the available commands. AI exploration requires `OPENROUTER_API_KEY`.

To work on Relay itself:

```bash
pnpm dev:web        # Open the app in a browser
vp check           # Check formatting and lint
pnpm typecheck     # Check types
pnpm test          # Run tests
```

</details>
