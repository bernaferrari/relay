# Relay product design system

Relay is a professional testing tool. It should feel calm, direct, and dependable: powerful
underneath, simple on the surface. This document is the product UI contract for what the app
actually uses today—not a migration plan and not a mood board.

## 1. Token reality

The React Product V2 UI uses **one** vocabulary from the semantic tokens in
`@relay/ui-react` globals and the React primitives in `@relay/ui-react`, plus a handful of
map-only layout tokens. Do not invent a second family and do not use `--v2-*` in product TSX or CSS.

### Semantic tokens

Via `var(--…)` or the matching Tailwind utilities (`text-text-strong`, `bg-background-base`,
`border-border-weak-base`):

- Text: `--text-strong`, `--text-base`, `--text-weak`, `--text-weaker`, `--text-interactive-base`
- Status: `--text-success-base`, `--text-warning-base`, `--text-critical-base`, `--icon-*-base`
- Surfaces: `--background-base`, `--background-weak` / `--background-deep` (page), `--surface-base`,
  `--surface-base-hover`, `--surface-raised-*`
- Borders / focus: `--border-weak-base`, `--border-base`, `--border-strong-base`, `--border-focus`
- Accent wash: `--product-accent-soft` (tint of `--text-interactive-base`)
- Elevation: `--shadow-md`, `--shadow-lg`, plus map elevations below

### App Map surface

Product V2's map components use the same semantic surface,
border, text, and focus tokens as the rest of the product. It must not introduce a second map-token
family; geometry and canvas layout belong in the components as Tailwind utilities and computed SVG attributes.

### What is banned

Product components own their Tailwind styling. Do not mention `--v2-*` ramps.

## 2. Styling ownership

- **`@relay/ui-react` primitives** own shared React controls: `Button`, `Card`, `IconButton`, fields,
  disclosures, and their Tailwind styles. Prefer them before hand-rolling an equivalent control.
- **`@relay/ui-react` globals** supply the shared semantic token and theme CSS.
- **Tailwind utilities in product TSX** own ordinary layout, spacing, typography, borders, colors
  (including `text-[var(--text-strong)]` / `bg-[var(--surface-base)]` patterns), hover,
  focus-visible, selected, disabled, and responsive behavior.
- **Only `globals.css` may contain authored CSS.** Keep it for global resets, fonts, semantic
  tokens, theme wiring, and shared animation keyframes. Page and component styles belong in
  Tailwind classes, including responsive, interaction, media, and Electron drag states.
- Runtime canvas coordinates and measured dimensions may use computed SVG attributes or inline
  values; static presentation remains in Tailwind.

Do not move page selectors into `globals.css` or add override blocks. Update the owning component.
The architecture check rejects other authored stylesheet filenames.

## 3. Compact, consistent rhythm

Use a four-point spacing grid with 2px allowed only for optical alignment.

- Related text: 2–4px
- Label to control: 6–8px
- Items in a list: 4–6px
- Sections inside a panel: 16–20px
- Page hero to primary content: 24px

Default product type (Tailwind `text-micro` / `text-caption` / `text-body` / `text-title` /
`text-display`, also aliased as `--type-*`):

- Micro / canvas chrome: 10px (`text-micro`)
- Caption/metadata: 11px, muted, ~1.25 line-height (`text-caption`)
- Body/control: 13px, 1.4–1.45 line-height (`text-body`)
- Panel title: 16px (`text-title`)
- Page title: 28px (`text-display`)

Do not use arbitrary `text-[Npx]` or `rounded-[Npx]`. Map radii to `rounded-sm` through
`rounded-3xl`. Keep `text-[var(--…)]` when you need a semantic color.

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

- [PRODUCT_V2.md](./PRODUCT_V2.md) owns the public model: **App**, **Test**, **Run**, **Change**, **Device**, and **Session**. Live is the navigation home for Sessions.
- **Checkpoint**, **Report**, **Proof**, **Recording**, **Data set**, and **Map** support those objects. Proof is a verified result, not an object people create or operate.
- **Run Across** applies a Test across Data set values and Devices. Variable, Combine, Cell, Lens, App Map, digest, and binding are engine terms shown only in Advanced or Audit surfaces.
- Path or Run describes execution. A Suite groups Tests; recipe is an engine term.
- Run report, not immutable report
- Device, not target or adapter instance, unless an Audit surface names the underlying target
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
