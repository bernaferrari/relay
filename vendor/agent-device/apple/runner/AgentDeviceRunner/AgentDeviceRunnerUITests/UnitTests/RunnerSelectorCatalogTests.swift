import XCTest
import AgentDeviceSnapshotPresentation

#if AGENT_DEVICE_RUNNER_UNIT_TESTS
final class RunnerSelectorCatalogTests: XCTestCase {
  private let window = CGRect(x: 0, y: 0, width: 1112, height: 834)
  private let query = SelectorCatalogQuery(selectorKey: "id", selectorValue: "same")

  func testReadPolicyCountsDistinctCandidatesWithoutCollapsingTheirIdenticalPresentation() {
    let cases: [([Bool], Bool, Bool?, Int, Int)] = [
      ([], true, false, 0, 0),
      ([false], true, false, 1, 0),
      ([false, false], true, false, 2, 0),
      ([true], true, true, 1, 1),
      ([true, false], true, true, 2, 1),
      ([true, true], false, nil, 2, 2),
    ]
    for (hittable, ok, found, raw, hits) in cases {
      let results = RunnerSelectorCatalog.classify(
        queries: [query], candidates: hittable.map { candidate(hittable: $0) }
      )
      XCTAssertEqual(results.count, 1)
      XCTAssertEqual(results[0].ok, ok)
      XCTAssertEqual(results[0].found, found)
      XCTAssertEqual(results[0].rawMatchCount, raw)
      XCTAssertEqual(results[0].hittableMatchCount, hits)
      XCTAssertEqual(results[0].nodes.count, found == true ? 1 : 0)
      XCTAssertEqual(results[0].error?.code, ok ? nil : "AMBIGUOUS_MATCH")
    }
  }

  func testOneCandidateMatchingTwoQueriesIsEmittedTwiceInRequestOrder() {
    let queries = [
      SelectorCatalogQuery(selectorKey: "label", selectorValue: "NAME"),
      query,
      SelectorCatalogQuery(selectorKey: "id", selectorValue: "missing"),
      query,
    ]
    let results = RunnerSelectorCatalog.classify(queries: queries, candidates: [candidate()])
    XCTAssertEqual(results.map(\.queryIndex), [0, 1, 2, 3])
    XCTAssertEqual(results.map(\.found), [true, true, false, true])
    XCTAssertEqual(results.flatMap(\.nodes).count, 3)
    XCTAssertEqual(results[0].nodes, results[1].nodes)
    XCTAssertEqual(results[1].nodes, results[3].nodes)
  }

  func testMatchingUsesOriginalAttributesAndTheSameNativePredicateAsSingleReads() {
    let candidates = [candidate(label: " name ", value: NSNumber(value: 7)), candidate(label: "name")]
    let queries = [
      SelectorCatalogQuery(selectorKey: "label", selectorValue: " name "),
      SelectorCatalogQuery(selectorKey: "value", selectorValue: "7"),
      SelectorCatalogQuery(selectorKey: "text", selectorValue: " SAME "),
      SelectorCatalogQuery(selectorKey: "id", selectorValue: "  "),
      SelectorCatalogQuery(selectorKey: "unknown", selectorValue: "same"),
    ]
    let results = RunnerSelectorCatalog.classify(queries: queries, candidates: candidates)
    XCTAssertEqual(results[0].rawMatchCount, 1, "only request values are trimmed")
    XCTAssertEqual(results[0].nodes.first?.label, "name")
    XCTAssertEqual(results[2].rawMatchCount, 2)
    XCTAssertEqual(results[2].error?.code, "AMBIGUOUS_MATCH")
    XCTAssertEqual(results[3].found, false)
    XCTAssertEqual(results[4].found, false)
    let native = NSPredicate(format: "value ==[c] %@", "7")
    XCTAssertEqual(results[1].rawMatchCount, candidates.filter { native.evaluate(with: $0.attributes) }.count)
  }

  func testOneEnumerationAndOneFactReadPerCandidateServeAllQueries() throws {
    var enumerations = 0
    var reads: [Int] = []
    let receipt = try observe(
      queries: [query, SelectorCatalogQuery(selectorKey: "label", selectorValue: "name")],
      enumerate: { predicates in
        enumerations += 1
        XCTAssertEqual(predicates.count, 2)
        return [0, 1]
      },
      readCandidate: { index in reads.append(index); return self.candidate(hittable: index == 0) }
    )
    XCTAssertEqual(enumerations, 1)
    XCTAssertEqual(reads, [0, 1])
    XCTAssertEqual(receipt?.results.map(\.rawMatchCount), [2, 2])
    XCTAssertEqual(receipt?.results.map(\.found), [true, true])
    XCTAssertEqual(receipt?.coverage, "requested-selectors")
    let encoded = try JSONSerialization.jsonObject(with: JSONEncoder().encode(receipt)) as? [String: Any]
    XCTAssertNil(encoded?["nodes"])
    XCTAssertNil(encoded?["truncated"])
  }

  func testForegroundSurfaceAndDeadlineRefusalsNeverEnumerateCandidates() throws {
    for (state, surface, expired) in [("runningBackground", false, false), ("runningForeground", true, false), ("runningForeground", false, true)] {
      let receipt = try observe(
        deadline: expired ? .distantPast : .distantFuture,
        readState: { state }, hasSystemSurface: { surface },
        enumerate: { _ in XCTFail("unavailable observations cannot enumerate"); return [] }
      )
      XCTAssertNil(receipt)
    }
  }

  func testDisappearingCandidateChangedWindowAndLateDeadlineCannotProveAMiss() throws {
    XCTAssertNil(try observe(readCandidate: { _ in nil }))
    var windows = [window, CGRect(x: 0, y: 0, width: 834, height: 1112)]
    XCTAssertNil(try observe(readWindow: { windows.removeFirst() }))
    var now = Date(timeIntervalSince1970: 0)
    XCTAssertNil(try observe(
      deadline: Date(timeIntervalSince1970: 1), now: { now },
      enumerate: { _ in now = Date(timeIntervalSince1970: 2); return [] }
    ))
    var states = ["runningForeground", "runningBackground"]
    XCTAssertNil(try observe(readState: { states.removeFirst() }))
    var surfaces = [false, true]
    XCTAssertNil(try observe(hasSystemSurface: { surfaces.removeFirst() }))
  }

  private func candidate(hittable: Bool = true, label: String = "name", value: Any = "value") -> SelectorCatalogCandidate {
    SelectorCatalogCandidate(
      attributes: ["identifier": "same", "label": label, "value": value],
      node: SnapshotPresentation.singleElementRead(RawAXNode(
        index: 0, type: "Button", label: label.trimmingCharacters(in: .whitespacesAndNewlines),
        identifier: "same", value: String(describing: value), rect: SnapshotRect(CGRect(x: 10, y: 10, width: 44, height: 44)),
        enabled: true, focused: nil, selected: nil, hittable: hittable, depth: 0,
        parentIndex: nil, hiddenContentAbove: nil, hiddenContentBelow: nil
      )), text: label.trimmingCharacters(in: .whitespacesAndNewlines)
    )
  }

  private func observe(
    queries: [SelectorCatalogQuery]? = nil, deadline: Date = .distantFuture,
    now: () -> Date = { Date() }, readState: () -> String = { "runningForeground" },
    hasSystemSurface: () -> Bool = { false }, readWindow: (() -> CGRect?)? = nil,
    enumerate: ([NSPredicate]) throws -> [Int] = { _ in [0] },
    readCandidate: ((Int) throws -> SelectorCatalogCandidate?)? = nil
  ) throws -> SelectorCatalogReceipt? {
    try RunnerSelectorCatalog.observe(
      bundleId: "ai.x.GrokApp", queries: queries ?? [query], deadline: deadline, now: now,
      readState: readState, hasSystemSurface: hasSystemSurface,
      readWindow: readWindow ?? { self.window }, enumerate: enumerate,
      readCandidate: readCandidate ?? { _ in self.candidate() }
    )
  }
}

#if os(iOS)
extension RunnerTests {
  @MainActor
  func testCatalogNativeAcquisitionMatchesSingleReadWithoutDiscardingNonHittableDuplicates() throws {
    let identifier = "agent-device-selector-read-duplicate"
    app.launchArguments = ["--agent-device-selector-read-regression"]
    app.launch()
    defer { invalidateCachedTarget(reason: "unit_test_cleanup"); app.terminate() }
    XCTAssertTrue(app.waitForExistence(timeout: appExistenceTimeout))
    let baseline = queryElement(app: app, selectorKey: "id", selectorValue: identifier)
    XCTAssertTrue(baseline.ok)
    XCTAssertEqual(baseline.data?.found, true)
    var enumerations = 0
    var candidateReads = 0
    let receipt = try RunnerSelectorCatalog.observe(
      bundleId: "com.example.fixture", queries: [
        SelectorCatalogQuery(selectorKey: "id", selectorValue: identifier),
        SelectorCatalogQuery(selectorKey: "text", selectorValue: identifier),
      ], deadline: Date().addingTimeInterval(15),
      readState: { Self.applicationStateName(self.app.state) }, hasSystemSurface: { false },
      readWindow: { self.onScreenWindowFrame(app: self.app) },
      enumerate: { predicates in
        enumerations += 1
        return self.app.descendants(matching: .any)
          .matching(NSCompoundPredicate(orPredicateWithSubpredicates: predicates)).allElementsBoundByIndex
      }, readCandidate: { element in
        candidateReads += 1
        return try self.readSelectorCatalogCandidate(element)
      }
    )
    let observed = try XCTUnwrap(receipt)
    XCTAssertEqual(enumerations, 1)
    XCTAssertEqual(candidateReads, 2)
    XCTAssertEqual(observed.results.map(\.rawMatchCount), [2, 2])
    XCTAssertEqual(observed.results.map(\.hittableMatchCount), [1, 1])
    XCTAssertEqual(observed.results.map(\.found), [true, true])
    XCTAssertEqual(observed.results[0].nodes, baseline.data?.nodes)
    XCTAssertEqual(observed.results[0].text, baseline.data?.text)
    XCTAssertEqual(observed.results[0].nodes, observed.results[1].nodes)
  }
}
#endif
#endif
