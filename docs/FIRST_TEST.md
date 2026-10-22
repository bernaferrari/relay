# Your first Relay test

Record one short journey in your own website, run it again, and review what Relay saw.

This is the contributor path from source. Relay's runtime and MCP packages are local release candidates; there is no published npm package or qualified standalone desktop installer to download yet. If you already have the matching tarballs, use the [runtime candidate instructions](../packages/runtime/README.md).

## Start Relay

Install Node.js 24+, pnpm, the Vite+ CLI (`vp`), and Chrome, Chromium, or Edge. Recorded steps need no account, model key, Android tools, or iOS tools.

```bash
git clone https://github.com/bernaferrari/relay.git
cd relay
vp install
pnpm doctor -- --web
pnpm ensure:serve
pnpm dev:web       # or pnpm dev:desktop
```

The doctor reports missing prerequisites. For a custom browser installation, set `RELAY_BROWSER_EXECUTABLE` to its absolute executable path before starting Relay.

## Record one flow

Choose **New test**, pick **Website**, and enter your site's address (`localhost:3000` works). Relay opens a fresh browser. Click through the journey the way you normally would; each action becomes a step. Add a **check** where something must be true and a **screenshot** where you want to look at the screen later. Then choose **Stop and review**, and **Save**.

## Run it again

Open the test and press **Run**. Relay repeats every step in a fresh browser and shows each one with its timing and the screen it reached. When a check fails, it shows what it **expected** and what it **saw**, next to the screenshot.

A passing check is not an appearance approval. Open the run's **Screenshots** to mark each screen **Looks correct** or **Report issue**.

## Repeat it anywhere

```bash
pnpm relay run "Checkout" --device browser
```

The CLI, the app, and MCP agents drive the same saved test, so an agent can rerun it, read the verdict, fix the cause, and run it again.
