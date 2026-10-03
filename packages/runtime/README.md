# Relay runtime candidate

This package contains the existing canonical Relay HTTP service, bundled from
the same server, core, protocol and workflow sources. It adds local startup
and a no-model demo; it does not introduce another executor or evidence store.

## Install a built candidate

Node.js 24+ and an installed Chrome or Chromium browser are prerequisites.
The package is a local release candidate; it has not been published to npm.

```bash
npm install /absolute/path/relay-runtime-0.1.0.tgz
npx --no-install relay-runtime start --workspace /absolute/path/my-project
npx --no-install relay-runtime demo --workspace /absolute/path/my-project
```

Startup attaches to a compatible owner for that exact workspace or launches
the canonical service. It never kills a listener or replaces a live state
owner. Unknown listeners, foreign ownership and incompatible versions fail
with a specific recovery message. Mutable Tests, browser profiles, accounts,
activity and evidence live in the chosen workspace, outside the package and
plugin caches. The same state directory lease protects concurrent launches.

The demo records signing in as Member and opening Settings, saves a reusable
Test, runs it in a fresh browser, exports a hash-verified screenshot, and
leaves human screenshot review pending. Its fixture stays available until
Ctrl+C. Add `--once` for one run and fixture shutdown. The canonical service
remains available for the next task.

The printed Review URL is a local, expiring canonical HTML evidence gallery.
It works without the contributor web dev server and remains read-only. The
printed Repeat command uses the installed runtime, preserving the same Test.

## Start through the installed MCP connector

Install the matching local `@relay/mcp` and runtime tarballs together in the
same installation directory. Configure the host's installed MCP executable:

```bash
node /absolute/installation/node_modules/@relay/mcp/dist/relay-mcp.js \
  --profile qa --workspace /absolute/path/my-project --runtime-port 8788
```

`RELAY_WORKSPACE_ROOT` and `RELAY_RUNTIME_PORT` are equivalent environment
settings. Startup preserves the configured actor and credential source;
workspace startup uses `local/default` scope. Configure an explicit `--server`
or `RELAY_URL` for another authorized service. Offline guides and read-only
doctor still work without the optional runtime package.

For static-token authentication, the configured `RELAY_ACTOR_ID` must match
the service's `RELAY_AUTH_SUBJECT`, as required by the canonical authorization
boundary. Startup preserves these explicit identities; the demo uses that
same actor when configured.

Qualification is bounded: authenticated startup and panel state are tested;
browser demo recording, repeat runs and the local evidence gallery are tested
on trusted loopback without static-token authentication. The canonical service
restricts workspace asset operations to its trusted local host. An authenticated
demo fails with an actionable message and preserves saved data; it does not
retry input or change that boundary.

The exported `@relay/runtime/startup` helper accepts an absolute
`workspaceRoot`, optional `stateDirectory`, `port`, and `token`, and returns
the compatible service URL, PID, scope paths and `started`/`attached`
disposition. It defaults SDK daemon state to the workspace's
`.relay/agent-device`, keeping another workspace's native daemon untouched.
An explicitly configured `AGENT_DEVICE_STATE_DIR` is preserved.

Browser installation acceptance runs against a temporary installed tarball
without repository source paths. Native helpers and physical device support
require separate platform qualification; this artifact does not establish it.

## Build and verify from the contributor checkout

```bash
node packages/runtime/scripts/build.mjs
node packages/runtime/scripts/test-installed.mjs
```
