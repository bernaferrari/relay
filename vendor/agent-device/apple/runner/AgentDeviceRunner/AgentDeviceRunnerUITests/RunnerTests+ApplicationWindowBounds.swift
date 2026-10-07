import XCTest

extension RunnerTests {
  @MainActor
  func executeApplicationWindowBounds(command: Command) -> Response {
    #if os(iOS)
      guard let bundleId = command.appBundleId,
        RunnerApplicationWindowBounds.isBundleIdentifier(bundleId)
      else {
        return Response(
          ok: false,
          error: ErrorPayload(
            code: "INVALID_ARGS", message: "appWindowBounds requires an exact appBundleId"
          ))
      }
      let testBundle = Bundle(for: RunnerTests.self)
      guard
        let hostBundleId = testBundle.object(
          forInfoDictionaryKey: "AgentDeviceRunnerAppBundleIdentifier"
        ) as? String, RunnerApplicationWindowBounds.isBundleIdentifier(hostBundleId)
      else {
        return applicationWindowBoundsUnavailable("Runner host identity unavailable")
      }
      let excludedBundleIds = Set(
        [
          hostBundleId, testBundle.bundleIdentifier, Bundle.main.bundleIdentifier,
        ].compactMap { $0 })
      guard !excludedBundleIds.contains(bundleId) else {
        return applicationWindowBoundsUnavailable(
          ApplicationWindowBoundsFailure.runnerHost.rawValue)
      }
      let application = XCUIApplication(bundleIdentifier: bundleId)
      let failureCountBefore = currentXCTestFailureCount()
      let observation = RunnerApplicationWindowBounds.observe(
        bundleId: bundleId,
        excludedBundleIds: excludedBundleIds,
        readState: { Self.applicationStateName(application.state) },
        readWindowGeometry: {
          // The same window frame anchors the iOS snapshot viewport; it is already in app orientation.
          RunnerApplicationWindowBounds.currentWindowGeometry(
            windows: application.windows.allElementsBoundByIndex,
            exists: { $0.exists }, isHittable: { $0.isHittable }, frame: { $0.frame }
          )
        }
      )
      guard !didRecordXCTestFailure(since: failureCountBefore) else {
        return applicationWindowBoundsUnavailable("XCTest could not observe the current app window")
      }
      switch observation {
      case .failure(let failure):
        return applicationWindowBoundsUnavailable(failure.rawValue)
      case .success(let observed):
        return Response(
          ok: true,
          data: DataPayload(
            appBundleId: observed.appBundleId,
            appStateBefore: observed.appStateBefore,
            appStateAfter: observed.appStateAfter,
            source: "current-window",
            coordinateSpace: "application-logical",
            geometrySource: "xcui-window-frame",
            bounds: observed.bounds
          ))
      }
    #else
      return Response(
        ok: false,
        error: ErrorPayload(
          code: "UNSUPPORTED_OPERATION", message: "appWindowBounds is supported only on iOS runners"
        ))
    #endif
  }

  private func applicationWindowBoundsUnavailable(_ reason: String) -> Response {
    Response(
      ok: false,
      error: ErrorPayload(
        code: "WINDOW_BOUNDS_UNAVAILABLE",
        message: "Current foreground app window bounds unavailable: \(reason)"
      ))
  }
}
