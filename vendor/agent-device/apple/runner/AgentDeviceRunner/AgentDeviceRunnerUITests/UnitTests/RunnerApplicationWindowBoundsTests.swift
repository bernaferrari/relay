import XCTest

#if AGENT_DEVICE_RUNNER_UNIT_TESTS
  final class RunnerApplicationWindowBoundsTests: XCTestCase {
    private let bundleId = "ai.x.GrokApp"
    private let frame = CGRect(x: 0, y: 0, width: 1112, height: 834)

    func testReadsOneCurrentWindowTwiceBetweenForegroundChecks() throws {
      var reads: [String] = []
      let result = RunnerApplicationWindowBounds.observe(
        bundleId: bundleId,
        readState: {
          reads.append("state")
          return "runningForeground"
        },
        readWindowGeometry: {
          reads.append("window")
          return .success(self.geometry(self.frame))
        }
      )
      let observed = try result.get()
      XCTAssertEqual(reads, ["state", "window", "window", "state"])
      XCTAssertEqual(observed.appBundleId, bundleId)
      XCTAssertEqual(observed.appStateBefore, "runningForeground")
      XCTAssertEqual(observed.appStateAfter, "runningForeground")
      XCTAssertEqual(observed.bounds, ApplicationWindowBounds(frame))
      XCTAssertEqual(observed.bounds.width, 1112)
      XCTAssertEqual(observed.bounds.height, 834)
    }

    func testMissingBundleDisplayNamesAndRunnerHostsReadNothing() {
      for bundle in ["", "Grok", " ai.x.GrokApp", "ai..GrokApp", "com.example.runner"] {
        var reads = 0
        let result = RunnerApplicationWindowBounds.observe(
          bundleId: bundle,
          excludedBundleIds: ["com.example.runner"],
          readState: {
            reads += 1
            return "runningForeground"
          },
          readWindowGeometry: {
            reads += 1
            return .success(self.geometry(self.frame))
          }
        )
        XCTAssertEqual(
          failure(result), bundle == "com.example.runner" ? .runnerHost : .invalidBundle)
        XCTAssertEqual(reads, 0)
      }
    }

    func testNonForegroundAppNeverQueriesWindows() {
      for state in ["unknown", "notRunning", "runningBackground", "runningBackgroundSuspended"] {
        let result = RunnerApplicationWindowBounds.observe(
          bundleId: bundleId,
          readState: { state },
          readWindowGeometry: {
            XCTFail("background apps own no admitted viewport")
            return .success(self.geometry(self.frame))
          }
        )
        XCTAssertEqual(failure(result), .notForeground)
      }
    }

    func testMissingAmbiguousAndVanishedWindowsHaveNoFallback() {
      for refusal in [ApplicationWindowBoundsFailure.windowUnavailable, .ambiguousWindow] {
        for refusedRead in [1, 2] {
          var reads = 0
          let result = RunnerApplicationWindowBounds.observe(
            bundleId: bundleId,
            readState: { "runningForeground" },
            readWindowGeometry: {
              reads += 1
              return reads == refusedRead ? .failure(refusal) : .success(self.geometry(self.frame))
            }
          )
          XCTAssertEqual(failure(result), refusal)
          XCTAssertEqual(reads, refusedRead)
        }
      }
    }

    func testCurrentWindowSelectionReadsOnlyOneExistingHittableWindow() throws {
      var frameReads: [Int] = []
      let selected = RunnerApplicationWindowBounds.currentWindowGeometry(
        windows: [0, 1, 2], exists: { $0 != 0 }, isHittable: { $0 == 2 },
        frame: {
          frameReads.append($0)
          return self.frame
        }
      )
      XCTAssertEqual(try selected.get().frame, frame)
      XCTAssertEqual(frameReads, [2])
      for windows in [[], [0], [1]] {
        let refusal = RunnerApplicationWindowBounds.currentWindowGeometry(
          windows: windows, exists: { $0 != 0 }, isHittable: { $0 >= 2 },
          frame: { _ in
            XCTFail("missing and hidden windows cannot contribute geometry")
            return self.frame
          }
        )
        if case .failure(let failure) = refusal {
          XCTAssertEqual(failure, .windowUnavailable)
        } else {
          XCTFail("selection must fail closed")
        }
      }
      var existenceReads = 0
      let vanished = RunnerApplicationWindowBounds.currentWindowGeometry(
        windows: [2],
        exists: { _ in
          existenceReads += 1
          return existenceReads == 1
        },
        isHittable: { _ in true },
        frame: { _ in
          XCTFail("a vanished window has no observed frame")
          return self.frame
        }
      )
      if case .failure(let failure) = vanished {
        XCTAssertEqual(failure, .windowUnavailable)
      } else {
        XCTFail("vanished windows must be refused")
      }
    }

    func testObservedKeyboardWindowsUseTheExistingEnclosingApplicationFrame() throws {
      let windows = [
        CGRect(x: 0, y: 426, width: 1112, height: 55),
        CGRect(x: 0, y: 481, width: 1112, height: 353),
        frame,
      ]
      let selected = RunnerApplicationWindowBounds.currentWindowGeometry(
        windows: windows, exists: { _ in true }, isHittable: { _ in true }, frame: { $0 }
      )
      XCTAssertEqual(try selected.get().frame, frame)
      let observed = try RunnerApplicationWindowBounds.observe(
        bundleId: bundleId, readState: { "runningForeground" },
        readWindowGeometry: { self.select(windows) }
      ).get()
      XCTAssertEqual(observed.bounds, ApplicationWindowBounds(frame))
    }

    func testCoincidentWindowFramesDeduplicateWithoutChangingObservedGeometry() throws {
      let keyboard = CGRect(x: 0, y: 481, width: 1112, height: 353)
      let before = try select([frame, keyboard, frame, keyboard]).get()
      let after = try select([keyboard, frame]).get()
      XCTAssertEqual(before.frame, frame)
      XCTAssertEqual(before.candidateFrames.count, 2)
      XCTAssertTrue(before.isCoherent(with: after))
    }

    func testDisjointAndIncomparableWindowsHaveNoObservedEnclosingFrame() {
      let sets = [
        [
          CGRect(x: 0, y: 0, width: 500, height: 834),
          CGRect(x: 600, y: 0, width: 500, height: 834),
        ],
        [
          CGRect(x: 0, y: 0, width: 700, height: 834),
          CGRect(x: 400, y: 0, width: 700, height: 834),
        ],
        [
          CGRect(x: 0, y: 0, width: 1112, height: 600),
          CGRect(x: 0, y: 500, width: 1112, height: 334),
        ],
      ]
      for windows in sets {
        if case .failure(let failure) = select(windows) {
          XCTAssertEqual(failure, .ambiguousWindow)
        } else {
          XCTFail("no observed rectangle encloses these windows")
        }
      }
    }

    func testInvalidHittableCompanionWindowCannotBeDiscardedForValidOuterFrame() {
      for invalid in [
        CGRect.null, .zero, .infinite,
        CGRect(x: 0, y: 0, width: -1, height: 55),
        CGRect(x: CGFloat.nan, y: 481, width: 1112, height: 353),
      ] {
        if case .failure(let failure) = select([frame, invalid]) {
          XCTAssertEqual(failure, .invalidGeometry)
        } else {
          XCTFail("a real invalid window observation must remain unavailable")
        }
      }
    }

    func testChangedCandidateSetRefusesEvenWhenSelectedOuterFrameIsUnchanged() throws {
      let keyboard = CGRect(x: 0, y: 481, width: 1112, height: 353)
      var geometries = [try select([frame, keyboard]).get(), try select([frame]).get()]
      let result = RunnerApplicationWindowBounds.observe(
        bundleId: bundleId, readState: { "runningForeground" },
        readWindowGeometry: { .success(geometries.removeFirst()) }
      )
      XCTAssertEqual(failure(result), .windowChanged)
    }

    func testCandidateVanishingAfterItsFrameReadRefusesTheWholeObservation() {
      var reads = 0
      var frameReads = 0
      let result = RunnerApplicationWindowBounds.currentWindowGeometry(
        windows: [frame],
        exists: { _ in
          reads += 1
          return reads < 3
        },
        isHittable: { _ in true },
        frame: {
          frameReads += 1
          return $0
        }
      )
      if case .failure(let failure) = result {
        XCTAssertEqual(failure, .windowUnavailable)
      } else {
        XCTFail("a vanished frame cannot prove current geometry")
      }
      XCTAssertEqual(frameReads, 1)
    }

    func testChangedFrameAndForegroundLossRefuseObservedGeometry() {
      var frames = [frame, CGRect(x: 0, y: 0, width: 834, height: 1112)]
      let changed = RunnerApplicationWindowBounds.observe(
        bundleId: bundleId, readState: { "runningForeground" },
        readWindowGeometry: { .success(self.geometry(frames.removeFirst())) }
      )
      XCTAssertEqual(failure(changed), .windowChanged)
      var states = ["runningForeground", "runningBackground"]
      let backgrounded = RunnerApplicationWindowBounds.observe(
        bundleId: bundleId, readState: { states.removeFirst() },
        readWindowGeometry: { .success(self.geometry(self.frame)) }
      )
      XCTAssertEqual(failure(backgrounded), .notForeground)
    }

    func testInvalidDimensionsAndNonFiniteOriginsCannotBecomeLogicalBounds() {
      let invalidFrames: [CGRect] = [
        .null, .infinite, .zero,
        CGRect(x: 0, y: 0, width: -1112, height: 834),
        CGRect(x: 0, y: 0, width: 1112.5, height: 834),
        CGRect(x: 0, y: 0, width: 1112, height: 834.5),
        CGRect(x: CGFloat.nan, y: 0, width: 1112, height: 834),
        CGRect(x: 0, y: CGFloat.infinity, width: 1112, height: 834),
        CGRect(x: 0, y: 0, width: CGFloat.infinity, height: 834),
        CGRect(x: 0, y: 0, width: CGFloat(Int.max), height: 834),
      ]
      for invalid in invalidFrames {
        var reads = 0
        let result = RunnerApplicationWindowBounds.observe(
          bundleId: bundleId, readState: { "runningForeground" },
          readWindowGeometry: {
            reads += 1
            return .success(self.geometry(invalid))
          }
        )
        XCTAssertEqual(failure(result), .invalidGeometry, "\(invalid)")
        XCTAssertEqual(reads, 1)
      }
      XCTAssertEqual(
        ApplicationWindowBounds(CGRect(x: 2.5, y: -3.5, width: 1112, height: 834))?.x, 2.5)
    }

    func testBoundedTimeoutHonorsRemainingBudgetWithoutRetry() {
      XCTAssertEqual(RunnerApplicationWindowBounds.timeoutSeconds(nil), 15)
      XCTAssertEqual(RunnerApplicationWindowBounds.timeoutSeconds(15000), 15)
      XCTAssertEqual(RunnerApplicationWindowBounds.timeoutSeconds(60000), 15)
      XCTAssertEqual(RunnerApplicationWindowBounds.timeoutSeconds(9000), 9)
      XCTAssertEqual(RunnerApplicationWindowBounds.timeoutSeconds(8000), 8)
      XCTAssertEqual(RunnerApplicationWindowBounds.timeoutSeconds(250), 0.25)
      for invalid in [0.0, -1, .nan, .infinity] {
        XCTAssertEqual(RunnerApplicationWindowBounds.timeoutSeconds(invalid), 0.001)
      }
    }

    private func geometry(_ frame: CGRect) -> ApplicationWindowGeometry {
      ApplicationWindowGeometry(frame: frame, candidateFrames: [frame])
    }

    private func select(_ frames: [CGRect]) -> Result<
      ApplicationWindowGeometry, ApplicationWindowBoundsFailure
    > {
      RunnerApplicationWindowBounds.currentWindowGeometry(
        windows: frames, exists: { _ in true }, isHittable: { _ in true }, frame: { $0 }
      )
    }

    private func failure(
      _ result: Result<ApplicationWindowBoundsObservation, ApplicationWindowBoundsFailure>
    ) -> ApplicationWindowBoundsFailure? {
      if case .failure(let failure) = result { return failure }
      return nil
    }
  }
#endif
