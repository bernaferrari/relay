import XCTest
import AgentDeviceSnapshotPresentation

extension RunnerTests {
  @MainActor
  func executeSelectorCatalog(command: Command, deadline: Date) throws -> Response {
    #if os(iOS)
      guard let bundleId = command.appBundleId, let queries = command.selectorQueries else {
        return selectorCatalogUnavailable()
      }
      let testBundle = Bundle(for: RunnerTests.self)
      guard let hostBundleId = testBundle.object(
        forInfoDictionaryKey: "AgentDeviceRunnerAppBundleIdentifier"
      ) as? String, RunnerApplicationWindowBounds.isBundleIdentifier(hostBundleId) else {
        return selectorCatalogUnavailable()
      }
      let excluded = Set([hostBundleId, testBundle.bundleIdentifier, Bundle.main.bundleIdentifier].compactMap { $0 })
      let application = XCUIApplication(bundleIdentifier: bundleId)
      var window: XCUIElement?
      let failures = currentXCTestFailureCount()
      let receipt = try RunnerSelectorCatalog.observe(
        bundleId: bundleId, excludedBundleIds: excluded, queries: queries, deadline: deadline,
        readState: { Self.applicationStateName(application.state) },
        hasSystemSurface: { self.hasForegroundSystemSurfaceForSelectorReceipt() },
        readWindow: {
          if let window { return window.exists ? window.frame : nil }
          for candidate in application.windows.allElementsBoundByIndex where candidate.exists {
            let frame = candidate.frame
            if !frame.isEmpty { window = candidate; return frame }
          }
          return nil
        },
        enumerate: { predicates in
          application.descendants(matching: .any)
            .matching(NSCompoundPredicate(orPredicateWithSubpredicates: predicates))
            .allElementsBoundByIndex
        },
        readCandidate: { try self.readSelectorCatalogCandidate($0) }
      )
      guard !didRecordXCTestFailure(since: failures), let receipt else {
        return selectorCatalogUnavailable()
      }
      return Response(ok: true, data: DataPayload(selectorCatalog: receipt))
    #else
      return Response(ok: false, error: ErrorPayload(
        code: "UNSUPPORTED_OPERATION", message: "querySelectorCatalog is supported only on iOS runners"
      ))
    #endif
  }

  /// Snapshot attributes are cached unmodified for native predicate matching. Actual XCTest
  /// hittability is a separate fact; regular snapshot geometric estimates never select a result.
  @MainActor
  func readSelectorCatalogCandidate(_ element: XCUIElement) throws -> SelectorCatalogCandidate? {
    guard element.exists else { return nil }
    let snapshot = try element.snapshot()
    let hittable = element.isHittable
    // Legacy queryElement publishes this logical frame. An isolated snapshot.frame can be native
    // device space; unlike a full tree, it has no window ancestry for orientation normalization.
    let frame = element.frame
    let label = snapshot.label.trimmingCharacters(in: .whitespacesAndNewlines)
    let identifier = snapshot.identifier.trimmingCharacters(in: .whitespacesAndNewlines)
    let value = String(describing: snapshot.value ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let node = SnapshotPresentation.singleElementRead(RawAXNode(
      index: 0, type: elementTypeName(snapshot.elementType), label: label.isEmpty ? nil : label,
      identifier: identifier.isEmpty ? nil : identifier, value: value.isEmpty ? nil : value,
      rect: SnapshotRect(frame), enabled: snapshot.isEnabled, focused: nil,
      selected: snapshot.isSelected ? true : nil, hittable: hittable, depth: 0, parentIndex: nil,
      hiddenContentAbove: nil, hiddenContentBelow: nil
    ))
    let text: String?
    switch snapshot.elementType {
    case .textField, .secureTextField, .searchField, .textView:
      text = [value, label, identifier].first { !$0.isEmpty }
    default:
      text = [label, value, identifier].first { !$0.isEmpty }
    }
    return SelectorCatalogCandidate(
      attributes: ["label": snapshot.label, "identifier": snapshot.identifier, "value": snapshot.value ?? NSNull()],
      node: node, text: text
    )
  }

  private func selectorCatalogUnavailable() -> Response {
    Response(ok: false, error: ErrorPayload(
      code: "SELECTOR_CATALOG_UNAVAILABLE",
      message: "Current foreground app selector catalog unavailable",
      hint: "Keep the named app foreground and retry the observation after accessibility work settles."
    ))
  }
}
