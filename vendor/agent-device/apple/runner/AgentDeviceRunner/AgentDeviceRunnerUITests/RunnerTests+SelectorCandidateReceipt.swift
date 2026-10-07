import XCTest

extension RunnerTests {
  @MainActor
  func executeSelectorCandidateReceipt(command: Command) -> Response {
    #if os(iOS)
      guard let bundleId = command.appBundleId,
        let key = command.selectorKey, let value = command.selectorValue,
        RunnerApplicationWindowBounds.isBundleIdentifier(bundleId)
      else { return selectorCandidateUnavailable() }
      let testBundle = Bundle(for: RunnerTests.self)
      guard
        let hostBundleId = testBundle.object(
          forInfoDictionaryKey: "AgentDeviceRunnerAppBundleIdentifier"
        ) as? String, RunnerApplicationWindowBounds.isBundleIdentifier(hostBundleId)
      else { return selectorCandidateUnavailable() }
      let excluded = Set(
        [hostBundleId, testBundle.bundleIdentifier, Bundle.main.bundleIdentifier]
          .compactMap { $0 })
      let application = XCUIApplication(bundleIdentifier: bundleId)
      let allowFallback = command.allowNonHittableCoordinateFallback == true
      var point: CGPoint?
      if allowFallback, let x = command.x, let y = command.y {
        guard x.isFinite, y.isFinite else { return selectorCandidateUnavailable() }
        point = CGPoint(x: x, y: y)
      }
      let failures = currentXCTestFailureCount()
      var selected: XCUIElement?
      var window: XCUIElement?
      let receipt = RunnerSelectorCandidateReceipt.observe(
        bundleId: bundleId, excludedBundleIds: excluded,
        selectorKey: key, selectorValue: value, allowNonHittableFallback: allowFallback,
        expectedPoint: point,
        readState: { Self.applicationStateName(application.state) },
        hasSystemSurface: { self.hasForegroundSystemSurfaceForSelectorReceipt() },
        readMatch: {
          let match = self.findElement(
            app: application, selectorKey: key, selectorValue: value,
            allowNonHittableFallback: allowFallback, expectedPoint: point
          )
          selected = match.element
          return SelectorCandidateMatchObservation(
            candidateCount: match.rawMatchCount, ambiguous: match.isAmbiguous,
            usedNonHittableFallback: match.usedNonHittableFallback,
            selectedFrame: match.element?.frame
          )
        },
        readSelected: {
          guard let selected, selected.exists else { return nil }
          return (true, selected.isHittable, selected.frame)
        },
        readWindow: {
          if let window {
            return window.exists ? window.frame : nil
          }
          // Same first existing nonempty window as native tap eligibility, without app.frame fallback.
          for candidate in application.windows.allElementsBoundByIndex where candidate.exists {
            let frame = candidate.frame
            if !frame.isEmpty {
              window = candidate
              return frame
            }
          }
          return nil
        }
      )
      guard !didRecordXCTestFailure(since: failures), let receipt else {
        return selectorCandidateUnavailable()
      }
      return Response(ok: true, data: DataPayload(selectorCandidateReceipt: receipt))
    #else
      return selectorCandidateUnavailable()
    #endif
  }

  private func selectorCandidateUnavailable() -> Response {
    Response(
      ok: false,
      error: ErrorPayload(
        code: "SELECTOR_CANDIDATE_UNAVAILABLE",
        message: "Current foreground app selector candidate proof unavailable"
      ))
  }
}
