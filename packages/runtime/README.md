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

The demo records signing in as Member, opening Settings, and checking that
Save does not overlap the team seats. It saves the Test, proves the seeded
overlap fails, repairs its own controlled website, and runs the unchanged
Test again. Both Runs retain hash-verified screenshots, durations, and local
gallery links. Human screenshot review stays pending. The website stays
available until Ctrl+C. Add `--once` to finish after the defect and repair
demonstration and close the website. The canonical service remains available.

The printed Review URL is a local, expiring canonical HTML evidence gallery.
It works without the contributor web dev server and remains read-only. The
printed Repeat command uses `relay-runtime repeat`, preserving the same Test
and the live website's repaired state. Leave the first demo terminal open;
copy Repeat into a second terminal. Repeat exits after the new Run and never
starts or closes a fixture. If the original website has stopped or its port
belongs to a different website, it refuses before sending browser input.
Start `relay-runtime demo` again to repeat the defect-and-repair demonstration.

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
without repository source paths, including Repeat while the default demo
remains open, repair preservation, and refusal after shutdown or replacement.
This is an isolated installation on the current Mac, not a fresh operating
system or a published install.

Browser installation and startup do not download the Android scrcpy server.
Before trying Android live preview, prepare that optional asset from your
installation directory:

```bash
cd /absolute/installation
npm exec -- fetch-scrcpy-server 2.5
```

Restart Relay after preparation. An unprepared Android live-preview request
returns setup guidance before opening ADB. Native helpers and physical device
support require separate platform qualification; browser acceptance does not
establish it.

## Build and verify from the contributor checkout

```bash
node packages/runtime/scripts/build.mjs
node packages/runtime/scripts/test-installed.mjs
```
