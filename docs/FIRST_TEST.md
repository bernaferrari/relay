# Your first Relay test

Run a complete local browser demo: record signing in as Member, open Settings, save a reusable Test, replay it in a fresh browser, and inspect the retained screenshot.

This is the contributor path from source. Relay's runtime and MCP packages are local release candidates; there is no published npm package or qualified standalone desktop installer to download yet. If you already have the matching tarballs, use the [runtime candidate instructions](../packages/runtime/README.md).

## Run the demo

Install Node.js 24+, pnpm, the Vite+ CLI (`vp`), and Chrome, Chromium, or Edge. The demo uses a controlled local website and needs no account, model key, Android tools, or iOS tools.

For a new checkout:

```bash
git clone https://github.com/bernaferrari/relay.git
cd relay
vp install
pnpm doctor -- --web
pnpm ensure:serve
pnpm demo
```

The doctor reports missing prerequisites. For a custom browser installation, set `RELAY_BROWSER_EXECUTABLE` to its absolute executable path before starting Relay. Let any existing Relay recording or run finish before starting the demo.

## Open the result

The output prints:

- **Test ID** and **Run ID** for the saved Test and completed replay.
- **Review:** a local read-only gallery with the retained run evidence. Open this link directly; no desktop app or web dev server is needed. It expires after 24 hours and requires the Relay service to stay running.
- **Screenshot:** the exported **Member settings.png** file in `.relay/first-run-demo/<run-id>/`. Its hash is checked against the retained capture before export.
- **Repeat:** the exact command to run the same saved Test again.

The screenshot should show Workspace settings for **Account member**. The fixture deliberately places **Save** over the team-seat text. Inspect that overlap: it demonstrates why completing the steps and reviewing the screenshot are separate outcomes.

“Collection passed” means the replay completed and retained its screenshot. Human screenshot review remains pending. The gallery displays evidence; it does not approve the app's appearance. To record a decision, start `pnpm dev:desktop`, open **Demo · Member settings**, and use Review.

## Repeat the saved Test

Keep the demo terminal open while using its printed Repeat command; that terminal serves the fixture website. Stop it with Ctrl+C when finished. Running `pnpm demo` again reuses the saved Test and produces a new Run and Review link.

For one run that closes the fixture automatically:

```bash
pnpm demo -- --once
```

The retained screenshot and gallery remain available while the Relay service runs. Start `pnpm demo` again before repeating after `--once` or Ctrl+C.

## Test your own app next

Start `pnpm dev:desktop`, choose **New Test**, enter your website address, and choose **Start recording**. Record a short flow, capture a screen, stop, and save the Test. Run it again, then review its screenshots.

With the [Relay plugin](../plugins/relay-proof/README.md) connected, give your coding agent this task:

```text
Read Relay's recording and run/review guides. Record a short flow on my
website, save it as a reusable Test, run it again, and inspect its retained
screenshots. Return the App, Test and Run IDs, the execution result, and
the evidence links. Keep human screenshot review pending.
```

Choose the intended website or device and account before allowing the agent to act. Website recording, replay and screenshot review work without a model key; optional AI exploration uses a configured provider. Use a trusted local Relay service without static-token authentication for this demo. Authenticated startup and physical devices have separate qualification, as described in the [runtime README](../packages/runtime/README.md).
