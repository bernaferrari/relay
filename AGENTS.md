<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Relay monorepo

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [README.md](./README.md).

## Packages

| Package            | Path                 | Notes                            |
| ------------------ | -------------------- | -------------------------------- |
| `@relay/protocol`  | `packages/protocol`  | Canonical operation contracts    |
| `@relay/core`      | `packages/core`      | Domain recipes — no UI           |
| `@relay/server`    | `packages/server`    | HTTP API over core               |
| `@relay/client`    | `packages/client`    | Validated operation transport    |
| `@relay/workflows` | `packages/workflows` | Outcome-oriented workflow façade |
| `@relay/cli`       | `packages/cli`       | Primary host                     |
| `@relay/tui`       | `packages/tui`       | ANSI terminal UI                 |
| `@relay/ui`        | `packages/ui`        | Solid design system + themes     |
| `@relay/app`       | `packages/app`       | Solid product UI (host-agnostic) |
| `@relay/desktop`   | `packages/desktop`   | Electron shell                   |

## Rules

1. Domain logic stays in `core`. UIs call `runAction` or HTTP `/actions/:id/run`.
2. Renderer never imports `electron` — only `window.api`.
3. `ui` has zero host knowledge.
4. `vendor/opencode` is reference-only (gitignored); do not vendor its agent runtime.

## Commands

```bash
vp install
pnpm dev            # interactive CLI
pnpm ensure:serve     # kill :8787, start a fresh detached watched server
pnpm dev:serve        # foreground watch, logs in this terminal
pnpm dev:tui
pnpm dev:app
pnpm dev:desktop
pnpm typecheck
```

## Agent dogfood (iPad / App Map)

Leave this standing so agents do not rediscover it after compaction.

**Runtime**

```bash
export RELAY_URL=http://127.0.0.1:8787
export RELAY_ACTOR_ID=agent:grok-ios-mapper
```

- One server on `:8787`. Do **not** wrap `tsx src/index.ts` in a long-lived agent bash task. Run `pnpm ensure:serve` or `node scripts/ensure-server.mjs` — it kills the port listener **and stray `tsx watch --port 8787` processes**. Use `--reuse` only when you explicitly want the current process. Detached + `tsx watch` so core/server edits reload it. Logs: `.relay/server.log`. `GET /health` includes `pid` and `startedAt`.
- Exclusive lease owner must match `--actor`. Default CLI actor `human:local-cli` will 403 on a mapper lease. Local trusted server **mints** a 2-hour lease on first control if nobody else holds the device, and **renews** it while you work. Still set `RELAY_ACTOR_ID` so you do not fight yourself.
- Drive the CLI with **direct** `node node_modules/tsx/dist/cli.mjs packages/cli/src/index.ts` and `--json`. Avoid `pnpm exec tsx` — `@yume-chan/fetch-scrcpy-server` postinstall can restart the watched server mid-job. Never `pnpm --filter … exec` (failure footer on stdout). **Parse the first JSON object on stdout**. **Read stderr** for waits (`Waiting on iOS accessibility tree…`, last job log). Do not merge stderr into the JSON parser. Default HTTP timeout is 180s; pass `--timeout 240000` if a cold iOS snapshot still dies. `relay test run` infers iOS vs Android from the serial — do not omit `serial`.

**Where am I**

- XCTest is **optional**. Pixels + point is a complete control path. Snapshot summary includes `app`, `header`, ranked `controls` (tabs first), `fingerprint` (16 chars), `nodeCount`, `inspectable`, `inspectionState`. If `inspectable` is false, screenshot + tap `{kind:"point",x,y}` still works (`proposedRows` are label-side tap points). Do not retry snapshot in a loop. Do not fail a tour only because the tree is missing.
- **Android has one UiAutomation slot.** The bundled helper APK (`packages/core/android-helpers/`, `com.callstack.agentdevice.snapshothelper`) owns it. Never run `uiautomator dump` while the helper is alive — dump dies with exit 137 / `UiAutomationService already registered`. Stock dump also returns `null root` when Niagara is bound; the helper uses `getWindows()` instead. Do **not** turn off Niagara. `--mark x,y` is screenshot pixels, same as `adb input tap`. If `nodeCount` is still 0 after recover, use pixels.
- Live “Here” on the map is fingerprint/alias (tree first, visual hash second). Nav title is not identity — Grok child sheets keep header “Settings”. Unchanged identity after hamburger is a toggle, not a new screen.
- Preview any selection (tree or point) before tapping: `relay device interact <serial> --preview --file preview.png --input '{"kind":"label","label":"Back"}'`. Same command without `--preview` commits. Point-only shortcut: `device screenshot --mark 78,88 --file preview.png`.
- If the screenshot is not that app/header, it is a **handoff** (Grok → iOS Settings is the usual case). XCTest stays on Grok. Do not keep tapping the Grok tree. `relay device launch <serial> com.apple.Preferences` (or `ai.x.GrokApp`), then snapshot again.
- Launch does **not** wait on XCTest. Relay tries 10s `devicectl process launch`, then go-ios, then **primes** the XCTest session (5s, non-blocking). Screenshot and live MJPEG use go-ios Instruments. Taps (point, identifier, label, swipe) use **one** agent-device XCTest session. Do not treat “No active session” as “launch failed” — Reconnect prepares the runner.
- Build the safe pixel-only iOS live producer once with `pnpm ios-preview:build` (Go 1.26+). It writes one bounded stdout stream to Relay and is the only permitted live-preview producer; never use `ios screenshot --stream`, DeviceKit, WDA, or preview as a control path. If the producer is absent, preserve the actionable unavailable diagnostic rather than falling back.
- go-ios is for **pixels + launch + recover** (`vendor/go-ios/bin/ios`). Do not use DeviceKit or `ios ax`. `ios lang` is **device** locale, not Grok’s in-app list.
- If the runner is down, **do not reboot the iPad**. Press **Reconnect** (`relay device recover`): kill zombie AgentDeviceRunner/testmanagerd, remount DDI only if prepare fails, start the XCTest runner again. Do **not** restart CoreDevice for a probe timeout.
- Android **Reconnect** / `relay device recover <serial>` wakes the screen and retries labels. It does **not** disable accessibility services. Unlock still needs a person.
- A stage point tap that does not change pixels **fails** — tap the label, not a dead cell. Unique identifiers (hamburger/gear) tap the control center via that same XCTest session.

**Authoring**

- App Map is truth. No second recipe library. No product `--v2-*` tokens.
- Fail closed: do not invent Grok Settings nav unless `preset:"grok"` / `profileId:"grok-ios"` or a **saved** In path.
- Unedited live recording that landed on the expected screen can commit without a second pass. Edits still need replay.
- A tap that does not change AX fingerprint cannot become a new screen. If pixels changed, treat as handoff.
- Prefer identifier → label → text → point. Huge SwiftUI cells are often `hittable:false`; tap the **label**, not the cell center. Ignore 20px status-bar app names.

**Data sets and Run Across**

Product V2 uses public job language while the CLI keeps the stable engine commands:

- **Data set** = values applied while running a Test. The CLI stores these through `relay variable save`; Variable is an advanced implementation term.
- **Test** = go here, click there, finish. `relay test run grok-android-manual-v2 supergrok-locale-tour`
- **Run Across** = run selected Tests with selected Data set values and Devices. The CLI continues to use `relay test run ... --in ...` and `relay combine run ...`; Combine, Cell, and Lens stay in Advanced/Audit UI. Default is one case. `--all` is explicit. Do **not** fire all cases unless asked. Capture remains an engine lens (`visual` / `smoke`). After a batch, `relay combine export <batch-id>` writes per-value screenshots + accessibility trees (and `full.png` when the destination was surveyed).
- Do **not** write a per-screen `.mjs` capture script. The YAML Test + language Variable is the recipe. `device survey --dir --no-restore` is the full-surface verb when you are already on the screen.

Tour seek reaches the origin screen (fingerprint, then mapped row overlap, then Back/Settings/prelude) before walking rows. Tour back is label-overlap, not nav title — Grok child sheets often keep header “Settings”.

**Grok iOS map (default:grok-ios)**

- Physical iPad Pro serial `db0c9b7c3aeb83dc2259d08e3b521a30f621d3f5`.
- Language list is iOS Settings → Grok → Preferred Language, not only the in-app sheet.
- In-app “App Language” label opens system Settings; cell-center tap often no-ops.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->

## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds

<!-- END BEADS INTEGRATION -->
