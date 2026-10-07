import XCTest

#if AGENT_DEVICE_RUNNER_UNIT_TESTS
  final class RunnerSelectorCandidateReceiptTests: XCTestCase {
    private let frame = CGRect(x: 80, y: 160, width: 200, height: 50)
    private let window = CGRect(x: 0, y: 0, width: 1112, height: 834)

    private func match(
      _ facts: [SelectorCandidateFacts], allowFallback: Bool = true,
      filtersByExpectedPoint: Bool = false
    ) -> SelectorCandidateMatchObservation {
      let decision = classifyDirectSelectorCandidates(
        facts,
        allowNonHittableFallback: allowFallback, filtersByExpectedPoint: filtersByExpectedPoint)
      switch decision {
      case .noMatch:
        return SelectorCandidateMatchObservation(
          candidateCount: facts.count, ambiguous: false,
          usedNonHittableFallback: false, selectedFrame: nil)
      case .ambiguous:
        return SelectorCandidateMatchObservation(
          candidateCount: facts.count, ambiguous: true,
          usedNonHittableFallback: false, selectedFrame: nil)
      case .selected(_, let fallback):
        return SelectorCandidateMatchObservation(
          candidateCount: facts.count, ambiguous: false,
          usedNonHittableFallback: fallback, selectedFrame: frame)
      }
    }

    private func observe(
      _ facts: [SelectorCandidateFacts],
      bundle: String = "com.example.app",
      states: [String] = ["runningForeground", "runningForeground"],
      surfaces: [Bool] = [false, false], selectedFrames: [CGRect]? = nil,
      windows: [CGRect?]? = nil, selectedExists: Bool = true, selectedHittable: Bool = true,
      census: (() -> Void)? = nil
    ) -> SelectorCandidateReceipt? {
      var stateIndex = 0
      var surfaceIndex = 0
      var selectedIndex = 0
      var windowIndex = 0
      let selectedFrames = selectedFrames ?? [frame, frame]
      let windows = windows ?? [window, window]
      return RunnerSelectorCandidateReceipt.observe(
        bundleId: bundle, excludedBundleIds: ["com.example.runner"], selectorKey: "label",
        selectorValue: "Fast", allowNonHittableFallback: true, expectedPoint: nil,
        readState: {
          defer { stateIndex += 1 }
          return states[min(stateIndex, states.count - 1)]
        },
        hasSystemSurface: {
          defer { surfaceIndex += 1 }
          return surfaces[min(surfaceIndex, surfaces.count - 1)]
        },
        readMatch: {
          census?()
          return self.match(facts)
        },
        readSelected: {
          defer { selectedIndex += 1 }
          return (
            selectedExists, selectedHittable,
            selectedFrames[min(selectedIndex, selectedFrames.count - 1)]
          )
        },
        readWindow: {
          defer { windowIndex += 1 }
          return windows[min(windowIndex, windows.count - 1)]
        }
      )
    }

    func testUniqueActualTapCandidateReturnsGeometryWithOneCensus() throws {
      var count = 0
      let receipt = try XCTUnwrap(
        observe(
          [.init(isHittable: true, hasTappableFrame: true)],
          census: { count += 1 }))
      XCTAssertEqual(count, 1)
      XCTAssertEqual(receipt.status, .resolved)
      XCTAssertEqual(receipt.candidateCount, 1)
      XCTAssertEqual(receipt.candidateBounds, SelectorCandidateBounds(frame))
      XCTAssertEqual(receipt.windowBounds, ApplicationWindowBounds(window))
      XCTAssertEqual(receipt.appBundleId, "com.example.app")
      XCTAssertEqual(receipt.appStateBefore, "runningForeground")
      XCTAssertEqual(receipt.appStateAfter, "runningForeground")
      XCTAssertFalse(receipt.filtersByExpectedPoint)
    }

    func testActualFastDuplicateAndDuplicateBeyondRetainedCapAreAmbiguous() throws {
      let hit = SelectorCandidateFacts(isHittable: true, hasTappableFrame: true)
      for facts in [[hit, hit], Array(repeating: hit, count: 257)] {
        let receipt = try XCTUnwrap(observe(facts))
        XCTAssertEqual(receipt.status, .ambiguous)
        XCTAssertEqual(receipt.candidateCount, facts.count)
        XCTAssertNil(receipt.candidateBounds)
        XCTAssertNil(receipt.windowBounds)
      }
    }

    func testActualFallbackOptionsPermitHittableAlongsideDecorativeMatch() throws {
      let facts = [
        SelectorCandidateFacts(isHittable: true, hasTappableFrame: true),
        SelectorCandidateFacts(isHittable: false, hasTappableFrame: true),
      ]
      XCTAssertEqual(try XCTUnwrap(observe(facts)).status, .resolved)
      XCTAssertTrue(match(facts, allowFallback: false).ambiguous)
      XCTAssertEqual(
        classifyDirectSelectorCandidates(
          facts, allowNonHittableFallback: false,
          rawMatchPolicy: .preferHittableMatch), .selected(index: 0, usedNonHittableFallback: false)
      )
    }

    func testMissAndNonhittableCoordinateFallbackStayUnmarked() throws {
      for facts in [[], [SelectorCandidateFacts(isHittable: false, hasTappableFrame: true)]] {
        let receipt = try XCTUnwrap(observe(facts))
        XCTAssertEqual(receipt.status, .unresolved)
        XCTAssertNil(receipt.candidateBounds)
      }
    }

    func testWrongOwnerOrForegroundNeverQueries() {
      let facts = [SelectorCandidateFacts(isHittable: true, hasTappableFrame: true)]
      var count = 0
      for bundle in ["Grok", "com.example.runner"] {
        XCTAssertNil(observe(facts, bundle: bundle, census: { count += 1 }))
      }
      XCTAssertNil(observe(facts, states: ["runningBackground"], census: { count += 1 }))
      XCTAssertNil(observe(facts, surfaces: [true], census: { count += 1 }))
      XCTAssertEqual(count, 0)
    }

    func testForegroundOrSystemSurfaceChangeInvalidatesCurrentReceipt() {
      let facts = [SelectorCandidateFacts(isHittable: true, hasTappableFrame: true)]
      XCTAssertNil(observe(facts, states: ["runningForeground", "runningBackground"]))
      XCTAssertNil(observe(facts, surfaces: [false, true]))
    }

    func testVanishedMovingOrNonhittableCandidateCannotMark() {
      let facts = [SelectorCandidateFacts(isHittable: true, hasTappableFrame: true)]
      XCTAssertNil(observe(facts, selectedExists: false))
      XCTAssertNil(observe(facts, selectedHittable: false))
      XCTAssertNil(observe(facts, selectedFrames: [frame, frame.offsetBy(dx: 10, dy: 0)]))
    }

    func testMissingChangedOrOffscreenWindowCannotBorrowAppFrame() {
      let facts = [SelectorCandidateFacts(isHittable: true, hasTappableFrame: true)]
      XCTAssertNil(observe(facts, windows: [nil]))
      XCTAssertNil(observe(facts, windows: [window, window.offsetBy(dx: 1, dy: 0)]))
      XCTAssertNil(observe(facts, windows: [.zero]))
      XCTAssertNil(observe(facts, windows: [CGRect(x: 500, y: 500, width: 100, height: 100)]))
    }

    func testCandidateGeometryRejectsNonfiniteAndEmptyFrames() {
      XCTAssertNil(SelectorCandidateBounds(.zero))
      XCTAssertNil(SelectorCandidateBounds(CGRect(x: Double.infinity, y: 0, width: 20, height: 20)))
      XCTAssertNil(SelectorCandidateBounds(CGRect(x: 0, y: 0, width: Double.nan, height: 20)))
    }
  }
#endif
