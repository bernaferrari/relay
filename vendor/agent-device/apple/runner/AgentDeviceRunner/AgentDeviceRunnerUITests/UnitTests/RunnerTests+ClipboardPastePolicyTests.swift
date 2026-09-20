import XCTest

extension RunnerTests {
#if AGENT_DEVICE_RUNNER_UNIT_TESTS
  func testClipboardPasteReplacesTheEntireFieldNotASubstring() {
    XCTAssertEqual(ClipboardPasteCommandContract.replacement, .replaceEntireField)
    XCTAssertNotEqual(ClipboardPasteCommandContract.replacement, .insertAtCaret)
    XCTAssertNotEqual(ClipboardPasteCommandContract.replacement, .replaceSelection)
    XCTAssertTrue(clipboardPasteFieldMatches(observed: "café 日本語", expected: "café 日本語"))
    XCTAssertTrue(clipboardPasteFieldMatches(observed: "line1\nline2", expected: "line1\nline2"))
    // Pre-existing text that merely contains the payload is not a successful replace.
    XCTAssertFalse(clipboardPasteFieldMatches(observed: "hello world", expected: "hello"))
    XCTAssertEqual(
      clipboardPasteFieldMatch(observed: "hello world", expected: "hello"),
      .diverged
    )
  }

  func testEmptyClipboardPasteRequiresAnEmptyField() {
    XCTAssertTrue(clipboardPasteFieldMatches(observed: "", expected: ""))
    // `String.contains("")` is true for every value; that must not count as pasted.
    XCTAssertFalse(clipboardPasteFieldMatches(observed: "still here", expected: ""))
    XCTAssertEqual(
      clipboardPasteFieldMatch(observed: "still here", expected: ""),
      .diverged
    )
  }

  func testClipboardPasteWaitsOnAGrowingPrefixThenStopsOnDivergence() {
    XCTAssertEqual(
      clipboardPasteFieldMatch(observed: "caf", expected: "café 日本語"),
      .pending
    )
    XCTAssertEqual(
      clipboardPasteFieldMatch(observed: "café 日本語 extra", expected: "café 日本語"),
      .diverged
    )
    XCTAssertEqual(
      clipboardPasteFieldMatch(observed: "other", expected: "café 日本語"),
      .diverged
    )
  }

  func testClipboardPasteDoesNotDispatchWhenReactivationMakesTheTargetAmbiguous() {
    XCTAssertEqual(
      clipboardPasteDispatchDecision(isAmbiguous: true, found: true),
      .refuseAmbiguous
    )
    XCTAssertEqual(
      clipboardPasteDispatchDecision(isAmbiguous: false, found: false),
      .refuseMissing
    )
    XCTAssertEqual(
      clipboardPasteDispatchDecision(isAmbiguous: false, found: true),
      .dispatch
    )
  }
#endif
}
