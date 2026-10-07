import Foundation

enum RunnerSelectorPredicate {
  /// Empty values and unsupported keys preserve querySelector's successful found:false result.
  static func make(key: String, value: String) -> NSPredicate? {
    let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !value.isEmpty else { return nil }
    switch key {
    case "id": return NSPredicate(format: "identifier ==[c] %@", value)
    case "label": return NSPredicate(format: "label ==[c] %@", value)
    case "value": return NSPredicate(format: "value ==[c] %@", value)
    case "text":
      return NSPredicate(format: "label ==[c] %@ OR identifier ==[c] %@ OR value ==[c] %@", value, value, value)
    default: return nil
    }
  }
}
