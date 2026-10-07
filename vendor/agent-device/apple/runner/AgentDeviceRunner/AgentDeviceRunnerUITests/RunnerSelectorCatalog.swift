import Foundation
import CoreGraphics
import AgentDeviceSnapshotPresentation

struct SelectorCatalogQuery: Codable {
  let selectorKey: String
  let selectorValue: String
}

struct SelectorCatalogCandidate {
  /// Original native attributes: matching precedes presentation trimming and value stringification.
  let attributes: [String: Any]
  let node: PresentedNode
  let text: String?
}

struct SelectorCatalogQueryResult: Codable {
  let queryIndex: Int
  let selectorKey: String
  let selectorValue: String
  let ok: Bool
  let found: Bool?
  let rawMatchCount: Int
  let hittableMatchCount: Int
  let nodes: [PresentedNode]
  let text: String?
  let error: ErrorPayload?
}

struct SelectorCatalogReceipt: Codable {
  let version: Int
  let source: String
  let coverage: String
  let appBundleId: String
  let appStateBefore: String
  let appStateAfter: String
  let coordinateSpace: String
  let geometrySource: String
  let bounds: ApplicationWindowBounds
  let results: [SelectorCatalogQueryResult]
}

enum RunnerSelectorCatalog {
  static let maxQueries = 64
  static let maxCandidates = 512

  static func classify(
    queries: [SelectorCatalogQuery], candidates: [SelectorCatalogCandidate]
  ) -> [SelectorCatalogQueryResult] {
    queries.enumerated().map { queryIndex, query in
      let predicate = RunnerSelectorPredicate.make(key: query.selectorKey, value: query.selectorValue)
      let matches = candidates.filter { predicate?.evaluate(with: $0.attributes) == true }
      let facts = matches.map {
        SelectorCandidateFacts(isHittable: $0.node.hittable == true, hasTappableFrame: false)
      }
      let hitCount = facts.filter(\.isHittable).count
      let decision = classifyDirectSelectorCandidates(
        facts, allowNonHittableFallback: false, rawMatchPolicy: .preferHittableMatch
      )
      let selected: SelectorCatalogCandidate?
      let ok: Bool
      let found: Bool?
      let error: ErrorPayload?
      switch decision {
      case .noMatch:
        selected = nil; ok = true; found = false; error = nil
      case .ambiguous:
        selected = nil; ok = false; found = nil
        error = ErrorPayload(code: "AMBIGUOUS_MATCH", message: "selector matched multiple elements")
      case .selected(let index, _):
        selected = matches[index]; ok = true; found = true; error = nil
      }
      return SelectorCatalogQueryResult(
        queryIndex: queryIndex, selectorKey: query.selectorKey, selectorValue: query.selectorValue,
        ok: ok, found: found, rawMatchCount: matches.count, hittableMatchCount: hitCount,
        nodes: selected.map { [$0.node] } ?? [], text: selected?.text, error: error
      )
    }
  }

  /// Completeness describes only the requested native predicates. A catalog supplies no hierarchy,
  /// response-tree completeness, ref namespace, or permission for future input.
  static func observe<Element>(
    bundleId: String, excludedBundleIds: Set<String> = [], queries: [SelectorCatalogQuery],
    deadline: Date, now: () -> Date = { Date() }, readState: () -> String,
    hasSystemSurface: () -> Bool, readWindow: () -> CGRect?,
    enumerate: ([NSPredicate]) throws -> [Element],
    readCandidate: (Element) throws -> SelectorCatalogCandidate?
  ) throws -> SelectorCatalogReceipt? {
    guard RunnerApplicationWindowBounds.isBundleIdentifier(bundleId),
      !excludedBundleIds.contains(bundleId), !queries.isEmpty, queries.count <= maxQueries,
      queries.allSatisfy({ $0.selectorKey.count <= 32 && $0.selectorValue.count <= 4096 }),
      now() < deadline
    else { return nil }
    let before = readState()
    guard before == "runningForeground", !hasSystemSurface(), now() < deadline,
      let frame = readWindow(), let bounds = ApplicationWindowBounds(frame), now() < deadline
    else { return nil }
    let predicates = queries.compactMap {
      RunnerSelectorPredicate.make(key: $0.selectorKey, value: $0.selectorValue)
    }
    let elements: [Element]
    if predicates.isEmpty { elements = [] }
    else { elements = try enumerate(predicates) }
    guard elements.count <= maxCandidates, now() < deadline else { return nil }
    var candidates: [SelectorCatalogCandidate] = []
    for element in elements {
      guard now() < deadline, let candidate = try readCandidate(element), now() < deadline else {
        return nil
      }
      candidates.append(candidate)
    }
    let results = classify(queries: queries, candidates: candidates)
    guard now() < deadline, readWindow() == frame else { return nil }
    let after = readState()
    guard after == "runningForeground", !hasSystemSurface(), now() < deadline else { return nil }
    return SelectorCatalogReceipt(
      version: 1, source: "xcui-selector-catalog", coverage: "requested-selectors",
      appBundleId: bundleId, appStateBefore: before, appStateAfter: after,
      coordinateSpace: "application-logical", geometrySource: "xcui-window-frame", bounds: bounds,
      results: results
    )
  }
}
