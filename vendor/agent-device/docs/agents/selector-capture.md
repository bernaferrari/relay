# Selector Capture Reliability

Read this before changing selector capture, polling, snapshot caching, or interaction fast paths.
These are cross-route behavior requirements; their rationale and owning decisions live in ADRs
0002, 0004, 0005, 0011, 0014, and 0015.

- Relay named iOS previews use the no-activation `querySelectorTapCandidate` census
  from ADR 0011. A bounded chrome match or ordinary query read cannot prove a preview
  location; a preview receipt is observation-time evidence, never future tap permission.
- Relay catalog observations use `querySelectorCatalog`: one OR candidate enumeration, cached native
  attributes and actual XCTest hittability, and the read selector policy independently per query.
  Its named foreground-app receipt covers only the requested predicates; it cannot establish a
  complete response tree or authorize input. Unsupported runners require rebuild and recovery.
  Empty or unsupported selectors retain `querySelector`'s successful miss semantics; Relay sends
  only nonempty `id` and `label` selectors. Candidate frames use the same logical `XCUIElement.frame`
  as single reads, because isolated snapshot frames lack full-tree orientation ancestry.
- Direct iOS selectors are a narrow fast path for simple one-term selectors and are disabled while
  post-gesture stabilization is pending. A structured selector miss may return to snapshot
  resolution; ambiguity and other runner failures remain failures.
- Regular selector reads are capture-backed. `@ref` resolves against its authorized ref frame,
  while `get`, `is`, `find`, and `wait` selectors capture through the backend. Polling bypasses the
  snapshot cache, as do active freshness recovery and stabilization. The cache serves a stored tree
  only while it is the newest observation: a side-effect seam or a native read such as `wait
  text`'s owner text reading retires it.
- Sparse capture verdicts are observable failures and never replace the session snapshot. Only a
  user-facing snapshot may publish a fallback screenshot; internal polling must not create one
  artifact per attempt.
- Apple accessibility failures are not proof of an empty UI. Recovery plans may serve regular
  snapshots, while raw and strict paths preserve the failure. Fatal runner evidence invalidates the
  cached target.
- A recorded XCTest failure after a tap is an ambiguous outcome. Only a usable same-presentation
  capture with a changed accessibility digest may corroborate success; missing, sparse, mismatched,
  or unchanged evidence remains failure.
- Android helper reuse is not snapshot-result caching. Freshness is short-lived, action-triggered,
  and learned only from route-safe complete observations.
- Post-gesture stabilization runs first and Android freshness recovery composes afterward when
  required. Gesture-like mutations mark stabilization and disable direct iOS selector shortcuts
  while it is pending.
- Session snapshot writes go through the shared snapshot mutation boundary. Sparse observations and
  empty ref-scoped projections do not overwrite stored evidence.
- Maestro matching remains snapshot- and policy-owned. Coordinate dispatch uses fresh geometry; an
  exact same-generation iOS target may use atomic selector activation, and a structured live miss
  returns to fresh Maestro resolution. Never add fuzzy matching, synthetic geometry, hierarchy
  heuristics, or error-message classification that changes authored selector meaning.

When changing one of these rules, update the relevant ADR, guarantee-matrix cell, contract scenario,
and TypeScript/Swift parity table rather than describing a new exception here.
