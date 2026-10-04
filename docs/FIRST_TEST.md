# Your first Relay test

Run a complete local browser demo: record signing in as Member, open Settings, save a layout check, catch a seeded defect, repair it, and rerun the same Test in a fresh browser.

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

- **Defect Review:** the failed Run, where **Save** overlaps the team seats.
- **Review:** the passing Run after the demo repairs its own website. Open either local read-only gallery directly; no desktop app or web dev server is needed. Links expire after 24 hours and require the Relay service to stay running.
- **Test ID**, separate **Run IDs**, and each Run's measured **Duration**. Both Runs execute the same saved Test.
- **Screenshot:** the exported **Member settings.png** file in `.relay/first-run-demo/<run-id>/`. Its hash is checked against the retained capture before export.
- **Repeat:** the exact command to run the same saved Test again.

Both screenshots show Workspace settings for **Account member**. The first Run's deterministic layout check fails on the overlap. The demo then removes the overlap in its controlled website and replays the unchanged Test; the second check passes. Open both galleries to compare the evidence. No model key is needed.

“Layout check passed” verifies that Save and the team seats do not overlap. Human screenshot review remains pending. To record a decision about the appearance, start `pnpm dev:desktop`, open **Demo · Member layout**, and use Review.

## Repeat the saved Test

Keep the demo terminal open while using its printed Repeat command; that terminal serves the website. Repeat preserves the repaired website and runs the same saved Test, producing a new Run and Review link. Stop the demo with Ctrl+C when finished. Starting `pnpm demo` again reuses the Test and demonstrates the defect and repair again.

To close the website automatically after demonstrating the defect and repair:

```bash
pnpm demo -- --once
```

The retained screenshots and galleries remain available while the Relay service runs. Start the demo again before repeating after `--once` or Ctrl+C. The installed runtime's Repeat command checks that its original demo website is still running and refuses a different website before sending browser input.

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
