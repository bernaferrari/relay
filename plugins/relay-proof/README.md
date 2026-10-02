# Relay plugin

Observe an app, record a reusable Test, run it again, and inspect retained
evidence beside your conversation. The installation identity remains
`relay-proof`; its display name is **Relay**.

The default `qa` preset selects existing recording, run, repeat, inspection,
preview and recovery tools. It uses Relay's canonical service, workflows,
leases and evidence. Recording and saved Test replay need no model. Change
Proof remains a separate explicit `proof` session.

## Connect to your existing Relay service

This package is a connector. It requires Node 24+, an existing compatible
Relay service, and the browser/native prerequisites for your selected target.
It does not install Relay desktop, start a service, or provide a custom host
panel. Runtime packaging and rendered host integration remain future work.

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

## First useful task

1. Ask Relay to connect and show the app's current screen.
2. Record a short journey with a named checkpoint.
3. Review and save it, then run the saved Test once.
4. Return its App/Test/Run IDs, result and retained evidence.

The bundled setup, recording and run/review skills load version-matched
`relay://guides` resources. Guides remain available while Relay is offline.
An edited recording needs a successful replay of its exact revision. An
unchanged recording can save when its canonical workflow allows it. A
functional pass and a human screenshot decision remain separate outcomes.

## Host and specialist compatibility

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
rendered ChatGPT/Codex panels.
