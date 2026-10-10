# Relay plugin

Describe what should work, let Relay write and run the Test, and read one
verdict beside your conversation. The installation identity remains
`relay-proof`; its display name is **Relay**.

The `qa` preset (the connector's default profile) gives agents the describe →
run → verdict loop (`relay_create_test`, `relay_run_test`, `relay_get_verdict`,
`relay_inspect_failure`), a quick `relay_check_change` after code changes, and
recording, repeat, inspection, preview and recovery tools. Steps written from words need a model
key; recorded steps and saved replay need none. Gated, human-approved Change
Proof remains a separate explicit `proof` session.

## Connect to your existing Relay service

This package requires Node 24+ and the browser/native prerequisites for your
selected target. It attaches to an existing compatible Relay service. With
the matching local `@relay/runtime` artifact installed alongside the connector,
an explicit `--workspace /absolute/path` can attach or launch the canonical
service. Use `--runtime-port 8788` if the default port belongs to another
workspace. The workspace stores accounts, Tests and evidence outside plugin
caches. Desktop and native helpers require separate qualification.

If you were given matching local artifacts, install both into your chosen
installation directory. This path also works without a contributor checkout:

```bash
npm install --prefix /absolute/installation /absolute/path/relay-mcp-0.1.0.tgz /absolute/path/relay-runtime-0.1.0.tgz
node /absolute/installation/node_modules/@relay/mcp/dist/relay-mcp.js --profile qa --workspace /absolute/path/my-project
```

Use that installed executable and those arguments in your host's supported
MCP configuration. For the source-independent Record → Run → Review demo,
read the installed `@relay/runtime/README.md`. These candidates have not been
published to npm.

Before publication, build the MCP artifact from this repository:

```bash
npm pack --silent ./packages/mcp
npm install --global ./relay-mcp-0.1.0.tgz
```

After a public release exists, use your approved exact `@relay/mcp` version.
Configure the host process environment:

```bash
export RELAY_URL=http://127.0.0.1:8787
export RELAY_ORGANIZATION_ID=local
export RELAY_PROJECT_ID=default
export RELAY_ACTOR_ID=agent:codex
# Set RELAY_AUTH_TOKEN in the host secret environment when the service requires it.
relay-mcp doctor --profile qa
```

The doctor checks reachability, exact scope, actor, required role and the
canonical operations needed by QA. Failed checks include the next setup
step. It makes read-only requests and never prints credentials. A READY
report establishes connection compatibility, not device readiness or a pass.

Load this directory through your host's supported local plugin flow, or copy
its `mcpServers.relay` entry into that host's MCP configuration. Use portable
[plugin.json](./plugin.json) / [mcp.json](./mcp.json) where supported, or the
[Codex compatibility descriptor](./.codex-plugin/plugin.json). Restart/reload
through the host's supported flow after updates; keep mutable Relay state
outside its immutable plugin cache.

For manual setup, invoke `relay-mcp` with `args: ["--profile", "qa"]`, matching
the plugin descriptor. Use that same profile and connection options for doctor.
`qa` is also the executable's default when no profile is given.

## First useful task

1. Call `relay_health`, then `relay_panel` to see existing Apps, Tests and
   recent Runs (text when the host cannot display the panel).
2. Call `relay_create_test` with a sentence and the `url` or `app`. It saves
   the Test and returns the exact `relay_run_test` call.
3. Call `relay_run_test` (add `targetId` from `relay_connect_target` when
   several targets are ready). It waits and returns the verdict: passed or
   failed, with the failing step's expected vs. saw and a screenshot.
4. After a code change, `relay_check_change` reruns the App's relevant Tests.
   Record a Test when a step must be exact or model-free.

For detailed discovery without the panel, read `relay://app-maps`, then
`relay://app-maps/<appMapId>/tests`, then the selected
`relay://app-maps/<appMapId>/tests/<testId>`. Substitute returned IDs. These
resources support pagination; follow the returned next-page URI when needed.
Use `relay-mcp --help` for offline connection options.

The bundled setup, recording and run/review skills load version-matched
`relay://guides` resources. Guides remain available while Relay is offline.
An edited recording needs a successful replay of its exact revision. An
unchanged recording can save when its canonical workflow allows it. A
functional pass and a human screenshot decision remain separate outcomes.

## Host and specialist compatibility

- `relay_panel` presents saved Tests, recent Runs and retained screenshots in
  hosts that negotiate MCP Apps. In other hosts it returns the same read-only
  state in chat. See [panel compatibility and qualification](./hosts/panel.md).
- [Claude Code](./hosts/claude-code/README.md): the same installed command and
  QA configuration; no separate tool schemas.
- [ChatGPT-compatible MCP transports](./hosts/chatgpt/README.md): use local
  stdio only where the host supports it; use the authenticated bridge where
  required. Saving a plugin does not make local tools available on web/mobile.
- Change verification: start a deliberately configured `--profile proof`
  session and use [Relay Proof](./skills/relay-proof/SKILL.md). Human plan
  approval and immutable Proof versions remain canonical service boundaries.

## Validate a copied distribution

```bash
node plugins/relay-proof/scripts/validate-package.mjs
vp run --filter @relay/mcp test:clean-host
```

The first command also works from a copied plugin directory without a checkout
or dependencies. The MCP clean-host test packs and installs the actual
connector in a temporary directory, then checks stdio discovery, offline
guides and read-only calls. These checks do not qualify native hardware or
rendered ChatGPT/Codex panels. The installed artifact test also checks the
negotiated HTML resource and the tools-only fallback.
