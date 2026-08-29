# Relay

Relay describes reusable product intent separately from the concrete device or browser evidence that implements it.

## Language

**App Map**:
The reviewed graph of product states, navigation edges, reusable Routines, Tests, and evidence for one application.
_Avoid_: Recipe library, screen dump

**Logical product state**:
A stable product state shared across platform-specific screens and visual variants.
_Avoid_: Screen title, view controller, page name

**Semantic action intent**:
A stable business action implemented by one or more reviewed platform-specific connections.
_Avoid_: Tap, selector, coordinate

**Surface**:
The frozen target environment used to select a Test implementation, including platform, viewport class, browser engine, and required capabilities.
_Avoid_: Device name, target label

**Route variant**:
One reviewed set of concrete bindings that implements the stable steps of a Test on a matching Surface.
_Avoid_: Alternate Test, fallback route

**Binding**:
A reviewed association between stable intent and its concrete App Map entity or Test-step implementation.
_Avoid_: Guess, inferred match

**Test family**:
One friendly business story plus its reviewed Route variants; unrelated existing Tests are never joined into a family by heuristic.
_Avoid_: Test suite, copied Tests

**Checkpoint**:
A logical product state whose arrival or content is explicitly proved during a Test.
_Avoid_: Screenshot, pause
