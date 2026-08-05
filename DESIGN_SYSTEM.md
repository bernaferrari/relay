# Relay product design system

Relay is a professional testing tool. It should feel calm, direct, and dependable: powerful
underneath, simple on the surface. This document is the product UI contract for what the app
actually uses today—not a migration plan and not a mood board.

## 1. Token reality

Product UI draws from three cooperating layers. All three are legitimate; do not invent a fourth
scale or ban an in-use family.

### Semantic text and status (`@relay/ui` classic tokens)

Used heavily in product TSX via `var(--…)` and Tailwind color utilities mapped from the same names:

- Text: `--text-strong`, `--text-base`, `--text-weak`, `--text-weaker`, `--text-interactive-base`
- Status text/icons: `--text-success-base`, `--text-warning-base`, `--text-critical-base`,
  `--icon-success-base`, `--icon-critical-base`, and peers
- Surfaces / borders still referenced by utilities: `background-*`, `surface-*`, `border-*`,
  `surface-raised-*`, focus rings such as `--border-focus` / `--border-strong-focus`

### V2 semantic surfaces (`--v2-*`)

Shipped from `packages/ui/src/v2/styles`. Product components correctly use these for layered chrome.
This is the current approach—not a temporary alias and not forbidden:

- Backgrounds: `--v2-background-bg-base`, `--v2-background-bg-deep`, `--v2-background-bg-layer-01` …
  `--v2-background-bg-layer-04`, `--v2-background-bg-accent`, inverse/contrast variants
- Borders: `--v2-border-border-muted`, `--v2-border-border-base`, `--v2-border-border-strong`,
  `--v2-border-border-focus`
- Elevation: `--v2-elevation-raised`, `--v2-elevation-floating`, `--v2-elevation-overlay`, button and
  switch elevations
- State: `--v2-state-bg-*`, `--v2-state-fg-*`, `--v2-state-border-*` for success / warning / danger /
  info
- Raw ramps (`--v2-grey-*`, `--v2-blue-*`, alpha scales) stay inside theme files; product TSX should
  prefer the semantic `--v2-background-*` / `--v2-border-*` / `--v2-state-*` names

### App Map shell tokens (`packages/app/src/styles/tokens.css`)

Canvas-only product tokens used by empty states, companions, and map chrome:

- `--map-canvas`, `--map-grid-dot`
- `--map-control-surface`, `--map-divider`
- `--map-elevation-control`, `--map-elevation-panel`
- `--product-accent-soft` (derived from `--v2-background-bg-accent`)
- `--shell-nav-width`

Dark scheme overrides for the map tokens live under `[data-color-scheme="dark"]` in the same file.

### What is banned

`packages/app/scripts/check-ui-boundaries.mjs` only rejects **retired numbered product classes** such
as `relay-text-2`, `relay-text-3`, `relay-panel-2`, `relay-panel-3`, and `relay-data` /
`relay-workflow` leftovers. It does **not** ban `--v2-*`, `--map-*`, or semantic `--text-*` variables.
Do not reintroduce those retired class names.

## 2. Styling ownership

- **`@relay/ui` primitives** own shared controls: `Button`, `Card`, `Icon`, switches, and related
  primitive CSS. Prefer them before hand-rolling an equivalent control.
- **Tailwind utilities in product TSX** own ordinary layout, spacing, typography, borders, colors
  (including `text-[var(--text-strong)]` / `bg-[var(--v2-background-bg-layer-01)]` patterns), hover,
  focus-visible, selected, disabled, and responsive behavior.
- **Authored CSS** stays limited to:
  - global reset, fonts, and theme wiring;
  - Electron drag / no-drag regions;
  - canvas node/edge geometry and transforms;
  - device viewport and media rendering;
  - animation keyframes shared by more than one component;
  - a reusable primitive whose states cannot be expressed clearly at the call site.

Do not add a late override block to repair an earlier rule. Change or remove the owning rule. Do not
migrate working `--v2-*` call sites “back” to an unused vocabulary for purity.

## 3. Compact, consistent rhythm

Use a four-point spacing grid with 2px allowed only for optical alignment.

- Related text: 2–4px
- Label to control: 6–8px
- Items in a list: 4–6px
- Sections inside a panel: 16–20px
- Page hero to primary content: 24px

Default product type (also encoded as `--type-caption` / `--type-body` / `--type-control` /
`--type-title` in app tokens):

- Caption/metadata: 11px, muted, ~1.25 line-height
- Body/control: 13px, 1.4–1.45 line-height
- Panel title: 16–18px
- Page title: 28–32px
- Canvas tool labels often sit at 10.5–12px; keep them tabular where counts matter

Do not repeat the same fact at adjacent hierarchy levels. Metadata is shown only when it helps the
next decision.

## 4. Selection is quiet

Selection uses a filled surface and, when necessary, a subtle border or soft accent wash
(`--product-accent-soft` / interactive text). Do not use decorative left rails, bright outlines, or
multiple simultaneous selection cues. Hover is weaker than selection; focus is visible only for
keyboard navigation (`focus-visible` rings on `--text-interactive-base` or `--border-focus`).

Rows should be full width, truncate long primary text, and keep actions aligned at the trailing
edge. A row click selects or opens. Explicit buttons run, edit, expand, or show a menu. Never assign
different meanings to single-click and double-click.

## 5. Progressive disclosure

Show one primary action per context. Put imports, duplication, destructive actions, technical
details, and advanced configuration in a clearly labelled overflow menu or disclosure.

Prefer user language:

- App Map (canvas), Test or Recipe (executable IR)—not internal schema names in list rows
- Run report, not immutable report
- Target or device, not adapter instance
- Saved with this run, not frozen observability payload

IDs, serials, provider internals, and raw configuration belong in details, not list rows.

## 6. State and status

Status is communicated by a short label plus restrained color. Color is never the only signal.
Unavailable is a compact filled badge. A status label must not look like a button unless it is
interactive.

Disabled controls remain legible and explain the prerequisite through a tooltip or toast when the
user attempts the related action. Recording and running are unavailable without a ready target and
required lease.

Empty, offline, recovered, and control-stolen states keep Device access visible and name the blocker
in plain language.

## 7. Motion

Motion explains continuity: opening menus, collapsing sidebars, moving a planned pointer, and
updating canvas paths. Use transform and opacity, short ease-out transitions
(`--ease-out-strong` / `--ease-hover` where relevant), and honor `prefers-reduced-motion` /
`motion-reduce:` variants. Do not animate decoration for its own sake.

## 8. Accessibility and quality gates

- Keyboard access and visible focus for every interactive control
- Minimum 4.5:1 contrast for body text
- Minimum 40px touch target where touch use is plausible (map chrome often uses `min-h-11`)
- No layout shift when status or metadata changes
- No horizontal scrolling in list rows or the step inspector
- Empty, loading, offline, error, and populated states reviewed at common window sizes

Before merging a UI change, run `vp check` (includes `check:ui` / `check-ui-boundaries.mjs`),
relevant tests, and a browser or desktop visual pass. New component CSS requires a brief
justification in the review description.
