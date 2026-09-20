/// How a field paste could change the target. `clipboardPaste` uses
/// `replaceEntireField` only.
enum ClipboardPasteReplacement: Equatable {
  case insertAtCaret
  case replaceSelection
  case replaceEntireField
}

enum ClipboardPasteCommandContract {
  static let replacement: ClipboardPasteReplacement = .replaceEntireField
}

/// Whether Paste may still be dispatched after the runner reactivates the
/// product app. The clipboard probe launches AgentDeviceRunner, so the
/// original XCUIElement can go stale or become one of several matches.
enum ClipboardPasteDispatchDecision: Equatable {
  case dispatch
  case refuseAmbiguous
  case refuseMissing
}

/// Exact-field paste verification. Substring `contains` is not a result: a
/// field that already held "hello world" would pass a paste of "hello", and
/// `contains("")` is true for every string.
enum ClipboardPasteFieldMatch: Equatable {
  case committed
  case pending
  case diverged
}

func clipboardPasteDispatchDecision(
  isAmbiguous: Bool,
  found: Bool
) -> ClipboardPasteDispatchDecision {
  if isAmbiguous { return .refuseAmbiguous }
  if !found { return .refuseMissing }
  return .dispatch
}

func clipboardPasteFieldMatch(observed: String, expected: String) -> ClipboardPasteFieldMatch {
  if observed == expected { return .committed }
  if expected.isEmpty { return .diverged }
  // Only a still-growing exact prefix is pending. A field that already held
  // matching text ("hello world" vs paste "hello") has diverged.
  if expected.hasPrefix(observed) { return .pending }
  return .diverged
}

func clipboardPasteFieldMatches(observed: String, expected: String) -> Bool {
  clipboardPasteFieldMatch(observed: observed, expected: expected) == .committed
}
