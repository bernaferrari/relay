<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Grok Device monorepo

See [ARCHITECTURE.md](./ARCHITECTURE.md) and [README.md](./README.md).

## Packages

| Package                | Path               | Notes                            |
| ---------------------- | ------------------ | -------------------------------- |
| `@grok-device/core`    | `packages/core`    | Domain recipes — no UI           |
| `@grok-device/server`  | `packages/server`  | HTTP API over core               |
| `@grok-device/cli`     | `packages/cli`     | Primary host                     |
| `@grok-device/tui`     | `packages/tui`     | ANSI terminal UI                 |
| `@grok-device/ui`      | `packages/ui`      | Solid design system + themes     |
| `@grok-device/app`     | `packages/app`     | Solid product UI (host-agnostic) |
| `@grok-device/desktop` | `packages/desktop` | Electron shell                   |

## Rules

1. Domain logic stays in `core`. UIs call `runAction` or HTTP `/actions/:id/run`.
2. Renderer never imports `electron` — only `window.api`.
3. `ui` has zero host knowledge.
4. `vendor/opencode` is reference-only (gitignored); do not vendor its agent runtime.

## Commands

```bash
vp install
pnpm dev            # interactive CLI
pnpm dev:serve      # HTTP :8787
pnpm dev:tui
pnpm dev:app
pnpm dev:desktop
pnpm typecheck
```
