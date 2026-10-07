import CoreGraphics
import Foundation

struct SelectorCandidateBounds: Codable, Equatable {
  let x: Double
  let y: Double
  let width: Double
  let height: Double

  init?(_ frame: CGRect) {
    guard !frame.isNull, !frame.isInfinite,
      frame.origin.x.isFinite, frame.origin.y.isFinite,
      frame.width.isFinite, frame.height.isFinite,
      frame.width > 0, frame.height > 0,
      frame.maxX.isFinite, frame.maxY.isFinite
    else { return nil }
    x = Double(frame.minX)
    y = Double(frame.minY)
    width = Double(frame.width)
    height = Double(frame.height)
  }
}

enum SelectorCandidateStatus: String, Codable {
  case resolved, ambiguous, unresolved
}

struct SelectorCandidateReceipt: Codable {
  let version: Int
  let source: String
  let appBundleId: String
  let appStateBefore: String
  let appStateAfter: String
  let selectorKey: String
  let selectorValue: String
  let allowNonHittableCoordinateFallback: Bool
  let filtersByExpectedPoint: Bool
  let coordinateSpace: String
  let status: SelectorCandidateStatus
  let candidateCount: Int
  let candidateBounds: SelectorCandidateBounds?
  let candidateHittable: Bool?
  let windowBounds: ApplicationWindowBounds?
}

struct SelectorCandidateMatchObservation {
  let candidateCount: Int
  let ambiguous: Bool
  let usedNonHittableFallback: Bool
  let selectedFrame: CGRect?
}

/// A single native selector census followed by coherence checks on that selected element.
/// This observes the tap policy; it does not authorize a future input or repair an app.
enum RunnerSelectorCandidateReceipt {
  static func observe(
    bundleId: String,
    excludedBundleIds: Set<String>,
    selectorKey: String,
    selectorValue: String,
    allowNonHittableFallback: Bool,
    expectedPoint: CGPoint?,
    readState: () -> String,
    hasSystemSurface: () -> Bool,
    readMatch: () -> SelectorCandidateMatchObservation,
    readSelected: () -> (exists: Bool, hittable: Bool, frame: CGRect)?,
    readWindow: () -> CGRect?
  ) -> SelectorCandidateReceipt? {
    guard RunnerApplicationWindowBounds.isBundleIdentifier(bundleId),
      !excludedBundleIds.contains(bundleId),
      ["id", "label", "value", "text"].contains(selectorKey),
      !selectorValue.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else { return nil }
    let before = readState()
    guard before == "runningForeground", !hasSystemSurface() else { return nil }
    let match = readMatch()
    guard match.candidateCount >= 0,
      !match.ambiguous || match.candidateCount >= 2,
      match.selectedFrame == nil || match.candidateCount >= 1
    else { return nil }
    var status: SelectorCandidateStatus = match.ambiguous ? .ambiguous : .unresolved
    var bounds: SelectorCandidateBounds?
    var windowBounds: ApplicationWindowBounds?
    if !match.ambiguous, !match.usedNonHittableFallback, let frame = match.selectedFrame {
      guard let first = readSelected(), first.exists, first.hittable, first.frame == frame,
        let candidate = SelectorCandidateBounds(frame),
        let window = readWindow(), let logicalWindow = ApplicationWindowBounds(window),
        TapPointPolicy.isAllowed(elementFrame: frame, windowFrame: window),
        let second = readSelected(), second.exists, second.hittable, second.frame == frame,
        readWindow() == window
      else { return nil }
      status = .resolved
      bounds = candidate
      windowBounds = logicalWindow
    }
    let after = readState()
    guard after == "runningForeground", !hasSystemSurface() else { return nil }
    return SelectorCandidateReceipt(
      version: 1, source: "xcui-tap-selector-policy", appBundleId: bundleId,
      appStateBefore: before, appStateAfter: after, selectorKey: selectorKey,
      selectorValue: selectorValue,
      allowNonHittableCoordinateFallback: allowNonHittableFallback,
      filtersByExpectedPoint: expectedPoint != nil, coordinateSpace: "application-logical",
      status: status, candidateCount: match.candidateCount, candidateBounds: bounds,
      candidateHittable: status == .resolved ? true : nil, windowBounds: windowBounds
    )
  }
}
