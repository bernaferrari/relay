# Grok device actions

Android recipes for Grok (Play Store + app login/logout) using the
[agent-device](https://oss.callstack.com/agent-device/docs/quick-start) TypeScript SDK
and the [Vite+](https://viteplus.dev) toolchain.

Requires a global **`vp`** (you already have it). Project pins **`vite-plus`** locally via the catalog — no second global install.

Failures **throw**. Debug with the `agent-device` CLI when something flakes.

## Commands

```bash
vp install                         # deps (pnpm)
vp run dev                         # interactive: device → action
vp exec tsx src/cli.ts logout      # direct action
vp check                           # format + lint + types
vp pack                            # build dist/cli.mjs
```

## Interactive menu

```bash
vp run dev
```

1. Pick connected Android device
2. Pick action
3. Optional confirms for alpha (skip teachx ensure / skip gmail restore)

Works **from any current Play account** — only switches when needed.

## Actions

### Play Store

| Action                   | Behavior                                                                  |
| ------------------------ | ------------------------------------------------------------------------- |
| **update-last-alpha**    | → `teachx.ai` → **Update only** (or already-latest) → restore `gmail.com` |
| **install-last-alpha**   | → teachx → Update **or** first Install → restore gmail                    |
| **reinstall-last-alpha** | → teachx → Uninstall → Install → restore gmail                            |
| **update-last-prod**     | → `PROD_ACCOUNT_MATCH` → Update only                                      |
| **install-last-prod**    | → prod → Uninstall → Install                                              |

### Grok app

| Action                       | Behavior                                                         |
| ---------------------------- | ---------------------------------------------------------------- |
| **login-google / email / x** | Provider button → Enable notifications → **Allow** system dialog |
| **logout**                   | Menu → Settings → Sign out                                       |

```bash
vp exec tsx src/cli.ts update-last-alpha
vp exec tsx src/cli.ts logout
PROD_ACCOUNT_MATCH=gmail.com vp exec tsx src/cli.ts update-last-prod
```

## Env

| Variable              | Default               | Meaning                        |
| --------------------- | --------------------- | ------------------------------ |
| `WORK_ACCOUNT_MATCH`  | `teachx.ai`           | Work / alpha Play account      |
| `HOME_ACCOUNT_MATCH`  | `gmail.com`           | Restore after alpha            |
| `PROD_ACCOUNT_MATCH`  | required for `*-prod` | Prod account match             |
| `AGENT_DEVICE_SERIAL` | set by menu           | Target phone                   |
| `INSTALL_TIMEOUT_MS`  | `300000`              | Wait after update/install      |
| `SKIP_RESTORE_HOME=1` |                       | Skip gmail restore after alpha |

## Layout

```
src/cli.ts          interactive + direct CLI
src/device.ts       agent-device helpers
src/play-store.ts   account ensure / update / install / reinstall
src/grok.ts         login + logout
vite.config.ts      Vite+ pack + check
```
