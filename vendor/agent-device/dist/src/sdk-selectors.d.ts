import { A as Rect, C as Platform, P as SnapshotNode, R as SnapshotState, T as PublicPlatform, h as ResponseCost } from "./sdk-contracts.js";
//#region packages/contracts/src/click-button.d.ts
declare const CLICK_BUTTONS: readonly ['primary', 'secondary', 'middle'];
type ClickButton = (typeof CLICK_BUTTONS)[number];
//#endregion
//#region packages/contracts/src/fill-evidence.d.ts
/**
 * The evidence a `fill` carries when it changed a field but could not confirm the text it sent.
 * Both the fill response and `Interactor.fill`'s return need these shapes, so they sit below both
 * of those modules rather than in either. This is the cross-language shape, not Android's probing:
 * `packages/platform-android/src/fill-verification.ts` builds Android's copy of it.
 */
/** The field a fill aimed at, as the platform that performed it names it. */
type FillVerificationTarget = {
  resourceId: string | null;
  className: string | null;
  packageName: string | null;
  rect: Rect;
};
/**
 * Target-bound evidence that a fill moved a field's content from `before` to `after` without raw
 * equality with `requested` being reachable, because app-owned formatting prevents it. Bound to the
 * {@link FillVerificationTarget} it was collected against so another field, or the same field after
 * it re-laid out, cannot borrow this evidence.
 */
type FillUnconfirmedVerification = {
  verification: 'unconfirmed';
  requested: string;
  before: string | null;
  after: string | null;
  target: FillVerificationTarget;
};
//#endregion
//#region packages/contracts/src/interaction.d.ts
/** The decisive criterion separating a resolveSelectorChain winner from its strongest runner-up (ADR 0012). */
type DisambiguationTiebreak = 'visible' | 'deepest' | 'smallest-area' | 'structural-equivalence';
/**
 * A disambiguation winner or losing alternative. `diagnosticRef` is an opaque,
 * non-`@` token — never a snapshot ref, never issued via `refsGeneration`,
 * never pinnable or usable as an `@ref` target. Strings are UTF-8 truncated
 * to 256 bytes.
 */
type ResolutionDiagnosticEntry = {
  diagnosticRef: string;
  role?: string;
  label?: string;
};
/**
 * ADR 0012 decision 2: pre-action disclosure of how the acting path resolved
 * its target, including each endpoint of a target-authored drag. Never ref-issuing.
 * `direct-ios`/`not-observed` = the XCTest fast path has no daemon tree to
 * report from; `ref`/`label-fallback` = a stale `@ref` recovered via
 * first-match label lookup, never exact ref provenance; `alternatives` holds
 * at most 5 losing candidates, winner excluded.
 */
type ResolutionDisclosure = {
  source: 'runtime';
  phase: 'pre-action';
  kind: 'unique';
} | {
  source: 'runtime';
  phase: 'pre-action';
  kind: 'disambiguated';
  matchCount: number;
  winnerDiagnostic: ResolutionDiagnosticEntry;
  tiebreak: DisambiguationTiebreak;
  alternatives: ResolutionDiagnosticEntry[];
} | {
  source: 'ref';
  phase: 'pre-action';
  kind: 'exact';
} | {
  source: 'ref';
  phase: 'pre-action';
  kind: 'label-fallback';
} | {
  source: 'direct-ios';
  kind: 'not-observed';
};
/**
 * A post-action capture that describes a DIFFERENT surface than the pre-action baseline (#2438): an
 * in-place iOS system surface (a web sign-in or Apple Pay sheet, hosted out of the app's process)
 * was presented over the app, or left it. `from`/`to` name the two surfaces — a host bundle id, or
 * `APP_SURFACE` (`@agent-device/contracts/ios-system-surface`) for ordinary app content.
 *
 * Its presence IS the refusal of a same-surface claim: the two captures are not one presentation,
 * so `--verify` reports `changedFromBefore` from this transition instead of from a digest
 * comparison across it, and `--settle` attaches no settled diff (and therefore no refs) across it.
 */
type PostActionSurfaceChange = {
  from: string;
  to: string;
  /** The one agent-facing sentence for this transition (`@agent-device/contracts/ios-system-surface`). */
  disclosure: string;
};
/**
 * Opt-in (`--verify`) cheap post-condition evidence for mutating interaction
 * commands (#1047). `digest`/`nodeCount`/`interactiveNodeCount` describe a single
 * interactive-only capture taken right after the action; `changedFromBefore`
 * compares that digest against the pre-action capture the resolution path already
 * held, so no extra device round trip is spent beyond the one verify capture.
 * `changedFromBefore: false` is evidence, not failure — the command still
 * succeeded.
 *
 * When `surfaceChange` is present the two captures describe different surfaces, so the digest
 * comparison is not made at all: `changedFromBefore` then reports that transition, which replaced
 * the whole observed surface.
 */
type InteractionEvidence = {
  foregroundApp?: string;
  nodeCount: number;
  interactiveNodeCount: number;
  digest: string;
  changedFromBefore: boolean;
  surfaceChange?: PostActionSurfaceChange;
};
type SettleDiffLine = {
  kind: 'added' | 'removed';
  text: string;
  /**
   * Plain ref body (`e12`) for ADDED lines: minted from the settled tree that
   * became the stored session snapshot, so it is immediately actionable and
   * lets the MCP layer pin it at `refsGeneration`. Removed lines never carry
   * one — their refs name nodes of the replaced tree.
   */
  ref?: string;
};
/**
 * One still-present, actionable element on the settled tree, surfaced by the
 * unchanged-interactive tail (see `SettleObservation.tail`).
 */
type SettleTailEntry = {
  ref: string;
  role: string;
  label?: string;
};
type SettleObservation = {
  settled: boolean;
  waitedMs: number;
  captures: number;
  quietMs: number;
  timeoutMs: number;
  /**
   * The session's snapshot generation after the settled tree became the stored
   * snapshot (#1076 versioned refs). Attached by the daemon response layer
   * when `diff` is present: added lines carry refs minted from that tree, so
   * the response is ref-issuing — the MCP layer merges per-ref pins from it
   * exactly like snapshot/find responses.
   */
  refsGeneration?: number;
  /**
   * Digest response view only: capped added-line refs preserved without the
   * verbose diff line text, so MCP can still pin refs when `diff.lines` is
   * intentionally omitted.
   */
  refs?: Array<{
    ref: string;
  }>;
  /**
   * Present when the settled capture describes a different surface than the pre-action baseline
   * (#2438). The settled tree then replaced the whole surface rather than changing within one, so
   * `diff` is omitted: its lines (and their refs) would present a surface replacement as an
   * in-surface change. `hint` says what to do instead.
   */
  surfaceChange?: PostActionSurfaceChange;
  /**
   * Present only for `settled: true` observations that stored the settled tree, and never across a
   * `surfaceChange` — a diff describes change WITHIN one surface.
   */
  diff?: {
    summary: {
      additions: number;
      removals: number;
      unchanged: number;
    };
    lines: SettleDiffLine[];
    /** Present (true) when lines were capped to the response bound. */
    truncated?: boolean;
  };
  /**
   * Unchanged interactive refs tail: benchmarks (July 2026) showed 27% of
   * `--settle` actions were followed by a fallback `snapshot -i` because a
   * change-only diff omits refs for elements that did not change — after a
   * modal dismiss the diff shows only removals, and the next button to press
   * (already on screen, untouched) is absent from the response. `tail` lists
   * the settled tree's remaining uncovered interactive elements (excluding
   * structural application/window chrome and the keyboard window's chrome)
   * so the response stays actionable without that extra round trip. Attached
   * ONLY when `diff` carries zero added-line refs naming a NEW target (the
   * modal-dismiss/toast-only/fill signature) — a diff whose added refs hand
   * the next target already pays its way, so the tail would be pure byte
   * cost. Keyboard-chrome refs and self-echo refs (added lines whose node
   * contains the action point: the acted-on element re-describing itself,
   * e.g. a filled field re-labeled with its new value) do not count as new
   * targets. Refs already present on `diff`'s added lines are excluded.
   * Capped; `tailTruncated` marks when candidates exceeded the cap.
   */
  tail?: SettleTailEntry[];
  tailTruncated?: true;
  hint?: string;
};
/**
 * Public daemon response data shared by press/click/fill/longpress.
 * `buildInteractionResponseData` emits this shape (ADR 0011 Layer 2):
 * `targetKind` discriminates the resolved target, identity fields are FLAT
 * (`ref`, `selector`, `x`, `y`), and per-command extras ride alongside.
 */
type TouchResponseDataBase = {
  message?: string;
  warning?: string;
  x?: number;
  y?: number;
  referenceWidth?: number;
  referenceHeight?: number;
  evidence?: InteractionEvidence;
  settle?: SettleObservation;
  resolution?: ResolutionDisclosure;
  cost?: ResponseCost;
  /** Direct iOS Maestro coordinate-fallback signals. */
  maestroNonHittableCoordinateFallbackAllowed?: boolean;
  maestroNonHittableCoordinateFallbackUsed?: boolean;
  maestroFallbackReason?: 'non-hittable-coordinate';
};
type TouchResponsePoint = TouchResponseDataBase & {
  targetKind: 'point';
  x: number;
  y: number;
};
type TouchResponseRef = TouchResponseDataBase & {
  targetKind: 'ref';
  ref: string;
  refLabel?: string;
  selectorChain?: string[];
  targetHittable?: boolean;
  hint?: string;
};
type TouchResponseSelector = TouchResponseDataBase & {
  targetKind: 'selector';
  selector: string;
  selectorChain?: string[];
  refLabel?: string;
  targetHittable?: boolean;
  hint?: string;
};
type TouchPressExtras = {
  button?: ClickButton;
  count?: number;
  intervalMs?: number;
  holdMs?: number;
  jitterPx?: number;
  doubleTap?: boolean;
};
type PressCommandResponseData = (TouchResponsePoint & TouchPressExtras) | (TouchResponseRef & TouchPressExtras) | (TouchResponseSelector & TouchPressExtras);
type ClickCommandResponseData = PressCommandResponseData;
type TouchFillExtras = {
  text: string;
  delayMs?: number;
} & ({
  verification?: never;
  requested?: never;
  before?: never;
  after?: never;
  target?: never;
} | FillUnconfirmedVerification);
type FillCommandResponseData = (TouchResponsePoint & TouchFillExtras) | (TouchResponseRef & TouchFillExtras) | (TouchResponseSelector & TouchFillExtras);
type TouchLongPressExtras = {
  durationMs?: number;
  gesture: 'longpress';
};
type LongPressCommandResponseData = (TouchResponsePoint & TouchLongPressExtras) | (TouchResponseRef & TouchLongPressExtras) | (TouchResponseSelector & TouchLongPressExtras);
type TouchHoverExtras = {
  gesture: 'hover';
};
type HoverCommandResponseData = (TouchResponsePoint & TouchHoverExtras) | (TouchResponseRef & TouchHoverExtras) | (TouchResponseSelector & TouchHoverExtras);
/**
 * Daemon response data for the `find` command. Read-only actions (`exists`,
 * `wait`, `get_text`, `get_attrs`) may issue a pinnable ref with
 * `refsGeneration`; mutating actions (`click`, `fill`, `focus`, `type`) carry
 * `ref` as diagnostic pre-action identity and intentionally omit `refsGeneration`
 * (ADR 0014). The shape is intentionally a flat, optional-field record because
 * the action positional changes which fields are present.
 */
type FindCommandResponseData = {
  ref?: string;
  refsGeneration?: number;
  found?: true;
  waitedMs?: number;
  text?: string;
  node?: SnapshotNode;
  /** Every match of the read-only `list` action (#1625), each ref pinnable at `refsGeneration`. */
  matches?: Array<{
    ref: string;
    node: SnapshotNode;
  }>;
  locator?: string;
  query?: string;
  x?: number;
  y?: number;
  message?: string;
  settle?: SettleObservation;
  cost?: ResponseCost;
};
//#endregion
//#region packages/selectors/src/internal/parse.d.ts
type SelectorKey = 'id' | 'role' | 'text' | 'label' | 'value' | 'appname' | 'windowtitle' | 'visible' | 'hidden' | 'editable' | 'selected' | 'focused' | 'enabled' | 'hittable';
type SelectorTerm = {
  key: SelectorKey;
  value: string | boolean;
};
type Selector = {
  raw: string;
  terms: SelectorTerm[];
};
type SelectorChain = {
  raw: string;
  selectors: Selector[];
};
declare function parseSelectorChain(expression: string): SelectorChain;
declare function tryParseSelectorChain(expression: string): SelectorChain | null;
declare function isSelectorToken(token: string): boolean;
//#endregion
//#region packages/selectors/src/internal/public-resolution-types.d.ts
/** One per-alternative diagnostic returned by selector resolution. */
type SelectorDiagnostics = {
  selector: string;
  matches: number;
};
/**
 * The disclosure for an ambiguous selector that was resolved by the heuristic;
 * present only when the heuristic picked among N>1 matches (ADR 0012).
 */
type SelectorDisambiguationDisclosure = {
  matchCount: number;
  tiebreak: DisambiguationTiebreak;
  /** Every losing matched node, document order, uncapped (response layer caps). */
  alternatives: SnapshotNode[];
};
/**
 * The options every selector lookup takes. Stated once here rather than inline
 * per function so a façade wrapper and the parser-side function it forwards to
 * cannot drift apart.
 */
type SelectorMatchOptions = {
  platform: Platform | PublicPlatform;
  requireRect?: boolean;
};
/** {@link SelectorMatchOptions} plus the uniqueness policy resolution adds. */
type SelectorResolutionOptions = SelectorMatchOptions & {
  requireUnique?: boolean;
  disambiguateAmbiguous?: boolean;
};
//#endregion
//#region packages/selectors/src/internal/resolve.d.ts
/**
 * The parser-side twin of the façade's `SelectorResolution`: identical except
 * that the winning alternative is the `Selector` node itself, which the façade
 * flattens to its `raw` text before any consumer sees it. Only the fields that
 * differ are restated; everything else is shared with
 * `public-resolution-types.ts`.
 */
type AstSelectorResolution = {
  node: SnapshotNode;
  selector: Selector;
  selectorIndex: number;
  matches: number;
  diagnostics: SelectorDiagnostics[];
  disambiguation?: SelectorDisambiguationDisclosure;
};
declare function resolveSelectorChain(nodes: SnapshotState['nodes'], chain: SelectorChain, options: SelectorResolutionOptions): AstSelectorResolution | null;
/**
 * A first-match lookup used by existence checks. No façade twin: the root
 * façade resolves through the policy interface only, so this shape reaches
 * consumers via the published `./ast` surface alone (#1630).
 */
type AstSelectorChainMatch = {
  selectorIndex: number;
  selector: Selector;
  matches: number;
  diagnostics: SelectorDiagnostics[];
};
declare function findSelectorChainMatch(nodes: SnapshotState['nodes'], chain: SelectorChain, options: SelectorMatchOptions): AstSelectorChainMatch | null;
//#endregion
//#region packages/selectors/src/internal/node.d.ts
declare function isNodeVisible(node: SnapshotNode): boolean;
declare function isNodeEditable(node: SnapshotNode, platform: Platform | PublicPlatform): boolean;
//#endregion
//#region packages/selectors/src/ast.d.ts
/**
 * The published signature takes a parsed chain or the raw text it came from;
 * the engine only ever needs the text. Kept here rather than widening
 * `internal/resolve.ts` back to a union, so the compatibility obligation sits
 * at the boundary that owes it.
 */
declare function formatSelectorFailure(chain: SelectorChain | string, diagnostics: SelectorDiagnostics[], options: {
  unique?: boolean;
}): string;
//#endregion
export { SettleObservation as _, resolveSelectorChain as a, isSelectorToken as c, ClickCommandResponseData as d, FillCommandResponseData as f, PressCommandResponseData as g, LongPressCommandResponseData as h, findSelectorChainMatch as i, parseSelectorChain as l, HoverCommandResponseData as m, isNodeEditable as n, SelectorDiagnostics as o, FindCommandResponseData as p, isNodeVisible as r, SelectorChain as s, formatSelectorFailure as t, tryParseSelectorChain as u, ClickButton as v };