import CoreGraphics
import Foundation

struct ApplicationWindowBounds: Codable, Equatable {
  let x: Double
  let y: Double
  let width: Int
  let height: Int

  init?(_ frame: CGRect) {
    let width = Double(frame.size.width)
    let height = Double(frame.size.height)
    guard !frame.isNull, !frame.isInfinite,
      Double(frame.origin.x).isFinite, Double(frame.origin.y).isFinite,
      width.isFinite, height.isFinite,
      width > 0, height > 0,
      width.rounded() == width, height.rounded() == height,
      width < Double(Int.max), height < Double(Int.max)
    else { return nil }
    self.x = Double(frame.origin.x)
    self.y = Double(frame.origin.y)
    self.width = Int(width)
    self.height = Int(height)
  }
}

enum ApplicationWindowBoundsFailure: String, Error {
  case invalidBundle
  case runnerHost
  case notForeground
  case windowUnavailable
  case ambiguousWindow
  case invalidGeometry
  case windowChanged
}

struct ApplicationWindowBoundsObservation: Equatable {
  let appBundleId: String
  let appStateBefore: String
  let appStateAfter: String
  let bounds: ApplicationWindowBounds
}

struct ApplicationWindowGeometry {
  let frame: CGRect
  let candidateFrames: [CGRect]

  func isCoherent(with other: ApplicationWindowGeometry) -> Bool {
    frame == other.frame && candidateFrames.count == other.candidateFrames.count
      && candidateFrames.allSatisfy { other.candidateFrames.contains($0) }
  }
}

enum RunnerApplicationWindowBounds {
  static func currentWindowGeometry<Window>(
    windows: [Window],
    exists: (Window) -> Bool,
    isHittable: (Window) -> Bool,
    frame: (Window) -> CGRect
  ) -> Result<ApplicationWindowGeometry, ApplicationWindowBoundsFailure> {
    let candidates = windows.filter { exists($0) && isHittable($0) }
    guard !candidates.isEmpty else { return .failure(.windowUnavailable) }
    var frames: [CGRect] = []
    for window in candidates {
      guard exists(window), isHittable(window) else { return .failure(.windowUnavailable) }
      let observed = frame(window)
      guard isPositiveFinite(observed) else { return .failure(.invalidGeometry) }
      guard exists(window), isHittable(window) else { return .failure(.windowUnavailable) }
      if !frames.contains(observed) { frames.append(observed) }
    }
    guard candidates.allSatisfy({ exists($0) && isHittable($0) }) else {
      return .failure(.windowUnavailable)
    }
    let enclosing = frames.filter { candidate in frames.allSatisfy { candidate.contains($0) } }
    guard enclosing.count == 1, let selected = enclosing.first else {
      return .failure(.ambiguousWindow)
    }
    return .success(ApplicationWindowGeometry(frame: selected, candidateFrames: frames))
  }

  static func observe(
    bundleId: String,
    excludedBundleIds: Set<String> = [],
    readState: () -> String,
    readWindowGeometry: () -> Result<ApplicationWindowGeometry, ApplicationWindowBoundsFailure>
  ) -> Result<ApplicationWindowBoundsObservation, ApplicationWindowBoundsFailure> {
    guard isBundleIdentifier(bundleId) else { return .failure(.invalidBundle) }
    guard !excludedBundleIds.contains(bundleId) else { return .failure(.runnerHost) }
    let before = readState()
    guard before == "runningForeground" else { return .failure(.notForeground) }
    let geometry: ApplicationWindowGeometry
    switch readWindowGeometry() {
    case .failure(let failure): return .failure(failure)
    case .success(let observed): geometry = observed
    }
    guard let bounds = ApplicationWindowBounds(geometry.frame) else {
      return .failure(.invalidGeometry)
    }
    let closingGeometry: ApplicationWindowGeometry
    switch readWindowGeometry() {
    case .failure(let failure): return .failure(failure)
    case .success(let observed): closingGeometry = observed
    }
    let after = readState()
    guard after == "runningForeground" else { return .failure(.notForeground) }
    guard geometry.isCoherent(with: closingGeometry) else { return .failure(.windowChanged) }
    return .success(
      ApplicationWindowBoundsObservation(
        appBundleId: bundleId, appStateBefore: before, appStateAfter: after, bounds: bounds
      ))
  }

  private static func isPositiveFinite(_ frame: CGRect) -> Bool {
    !frame.isNull && !frame.isInfinite
      && frame.origin.x.isFinite && frame.origin.y.isFinite
      && frame.size.width.isFinite && frame.size.height.isFinite
      && frame.size.width > 0 && frame.size.height > 0
      && frame.maxX.isFinite && frame.maxY.isFinite
  }

  static func isBundleIdentifier(_ bundleId: String) -> Bool {
    let parts = bundleId.split(separator: ".", omittingEmptySubsequences: false)
    let characters = CharacterSet(
      charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-")
    return parts.count >= 2
      && parts.allSatisfy { part in
        !part.isEmpty && part.unicodeScalars.allSatisfy { characters.contains($0) }
      }
  }

  static func timeoutSeconds(_ timeoutMs: Double?) -> TimeInterval {
    guard let timeoutMs else { return 15 }
    guard timeoutMs.isFinite, timeoutMs > 0 else { return 0.001 }
    return min(15, timeoutMs / 1000)
  }
}
