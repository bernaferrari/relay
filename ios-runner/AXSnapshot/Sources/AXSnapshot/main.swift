import Foundation
import ApplicationServices
import Cocoa

struct AXNode: Codable {
    struct Frame: Codable {
        let x: Double
        let y: Double
        let width: Double
        let height: Double
    }

    let role: String?
    let subrole: String?
    let label: String?
    let value: String?
    let identifier: String?
    let frame: Frame?
    let children: [AXNode]
}

struct AXSnapshotError: Error, CustomStringConvertible {
    let message: String
    var description: String { message }
}

let simulatorBundleId = "com.apple.iphonesimulator"
let defaultMaxDepth = 40

func hasAccessibilityPermission() -> Bool {
    AXIsProcessTrusted()
}

func findSimulatorApp() -> NSRunningApplication? {
    NSWorkspace.shared.runningApplications.first { $0.bundleIdentifier == simulatorBundleId }
}

func axElement(for app: NSRunningApplication) -> AXUIElement {
    AXUIElementCreateApplication(app.processIdentifier)
}

func getAttribute<T>(_ element: AXUIElement, _ attribute: CFString) -> T? {
    var value: AnyObject?
    let result = AXUIElementCopyAttributeValue(element, attribute, &value)
    guard result == .success else { return nil }
    return value as? T
}

func getChildren(_ element: AXUIElement) -> [AXUIElement] {
    if let children: [AXUIElement] = getAttribute(element, kAXChildrenAttribute as CFString),
       !children.isEmpty {
        return children
    }
    if let children: [AXUIElement] = getAttribute(element, kAXVisibleChildrenAttribute as CFString),
       !children.isEmpty {
        return children
    }
    if let children: [AXUIElement] = getAttribute(element, kAXContentsAttribute as CFString),
       !children.isEmpty {
        return children
    }
    return []
}

func getLabel(_ element: AXUIElement) -> String? {
    if let label: String = getAttribute(element, "AXLabel" as CFString) {
        return label
    }
    if let desc: String = getAttribute(element, kAXDescriptionAttribute as CFString) {
        return desc
    }
    return nil
}

func getValue(_ element: AXUIElement) -> String? {
    if let value: String = getAttribute(element, kAXValueAttribute as CFString) {
        return value
    }
    if let number: NSNumber = getAttribute(element, kAXValueAttribute as CFString) {
        return number.stringValue
    }
    return nil
}

func getIdentifier(_ element: AXUIElement) -> String? {
    getAttribute(element, kAXIdentifierAttribute as CFString)
}

func getFrame(_ element: AXUIElement) -> AXNode.Frame? {
    var positionRef: CFTypeRef?
    var sizeRef: CFTypeRef?
    AXUIElementCopyAttributeValue(element, kAXPositionAttribute as CFString, &positionRef)
    AXUIElementCopyAttributeValue(element, kAXSizeAttribute as CFString, &sizeRef)
    guard let posValue = positionRef, let sizeValue = sizeRef else {
        return nil
    }
    if CFGetTypeID(posValue) != AXValueGetTypeID() || CFGetTypeID(sizeValue) != AXValueGetTypeID() {
        return nil
    }
    let posAx = posValue as! AXValue
    let sizeAx = sizeValue as! AXValue
    var point = CGPoint.zero
    var size = CGSize.zero
    AXValueGetValue(posAx, .cgPoint, &point)
    AXValueGetValue(sizeAx, .cgSize, &size)
    return AXNode.Frame(
        x: Double(point.x),
        y: Double(point.y),
        width: Double(size.width),
        height: Double(size.height)
    )
}

func buildTree(_ element: AXUIElement, depth: Int = 0, maxDepth: Int = defaultMaxDepth) -> AXNode {
    let children = depth < maxDepth
        ? getChildren(element).map { buildTree($0, depth: depth + 1, maxDepth: maxDepth) }
        : []
    return AXNode(
        role: getAttribute(element, kAXRoleAttribute as CFString),
        subrole: getAttribute(element, kAXSubroleAttribute as CFString),
        label: getLabel(element),
        value: getValue(element),
        identifier: getIdentifier(element),
        frame: getFrame(element),
        children: children
    )
}

func findIOSAppSnapshot(in simulator: NSRunningApplication) -> (AXUIElement, AXNode.Frame?, AXUIElement, [AXUIElement])? {
    let appElement = axElement(for: simulator)
    let windows = getChildren(appElement).filter {
        (getAttribute($0, kAXRoleAttribute as CFString) as String?) == "AXWindow"
    }
    if windows.isEmpty { return nil }

    if let focused: AXUIElement = getAttribute(appElement, kAXFocusedWindowAttribute as CFString),
       let root = chooseRoot(in: focused) {
        let extras = findToolbarExtras(in: focused, root: root)
        return (root, getFrame(focused), focused, extras)
    }

    let sorted = windows.sorted { lhs, rhs in
        let l = getFrame(lhs)
        let r = getFrame(rhs)
        let la = (l?.width ?? 0) * (l?.height ?? 0)
        let ra = (r?.width ?? 0) * (r?.height ?? 0)
        return la > ra
    }
    for window in sorted {
        if let root = chooseRoot(in: window) {
            let extras = findToolbarExtras(in: window, root: root)
            return (root, getFrame(window), window, extras)
        }
    }
    return nil
}

func chooseRoot(in window: AXUIElement) -> AXUIElement? {
    let windowFrame = getFrame(window)
    let candidates = findGroupCandidates(in: window, windowFrame: windowFrame)
    return candidates.first?.element
}

private func elementId(_ element: AXUIElement) -> UInt {
    return UInt(bitPattern: Unmanaged.passUnretained(element).toOpaque())
}

private func collectDescendantIds(from root: AXUIElement) -> Set<UInt> {
    var seen: Set<UInt> = []
    var stack = [root]
    while !stack.isEmpty {
        let current = stack.removeLast()
        let id = elementId(current)
        if seen.contains(id) { continue }
        seen.insert(id)
        stack.append(contentsOf: getChildren(current))
    }
    return seen
}

private func frameIntersects(_ frame: AXNode.Frame?, _ target: AXNode.Frame?) -> Bool {
    guard let frame = frame, let target = target else { return false }
    let fx1 = frame.x
    let fy1 = frame.y
    let fx2 = frame.x + frame.width
    let fy2 = frame.y + frame.height
    let tx1 = target.x
    let ty1 = target.y
    let tx2 = target.x + target.width
    let ty2 = target.y + target.height
    return fx1 < tx2 && fx2 > tx1 && fy1 < ty2 && fy2 > ty1
}

private func isToolbarLike(_ element: AXUIElement) -> Bool {
    let role = (getAttribute(element, kAXRoleAttribute as CFString) as String?) ?? ""
    let subrole = (getAttribute(element, kAXSubroleAttribute as CFString) as String?) ?? ""
    if role == "AXToolbar" || role == "AXTabGroup" || role == "AXTabBar" {
        return true
    }
    if subrole == "AXTabBar" {
        return true
    }
    return false
}

private func findToolbarExtras(in window: AXUIElement, root: AXUIElement) -> [AXUIElement] {
    let rootFrame = getFrame(root)
    let rootIds = collectDescendantIds(from: root)
    var extras: [AXUIElement] = []
    var stack = getChildren(window)
    while !stack.isEmpty {
        let current = stack.removeLast()
        if isToolbarLike(current) && !rootIds.contains(elementId(current)) {
            let frame = getFrame(current)
            if frameIntersects(frame, rootFrame) {
                extras.append(current)
            }
        }
        stack.append(contentsOf: getChildren(current))
    }
    return extras
}

private struct GroupCandidate {
    let element: AXUIElement
    let area: Double
    let descendantCount: Int
}

private func findGroupCandidates(in root: AXUIElement, windowFrame: AXNode.Frame?) -> [GroupCandidate] {
    var candidates: [GroupCandidate] = []
    func walk(_ element: AXUIElement) {
        let children = getChildren(element)
        let role = (getAttribute(element, kAXRoleAttribute as CFString) as String?) ?? ""
        if role == "AXGroup" {
            let hasNonToolbarChild = children.contains {
                ((getAttribute($0, kAXRoleAttribute as CFString) as String?) ?? "") != "AXToolbar"
            }
            if hasNonToolbarChild {
                let frame = getFrame(element)
                let area = frameArea(frame, windowFrame: windowFrame)
                if area > 0 {
                    let descendantCount = countDescendants(element)
                    candidates.append(
                        GroupCandidate(
                            element: element,
                            area: area,
                            descendantCount: descendantCount
                        )
                    )
                }
            }
        }
        for child in children {
            walk(child)
        }
    }
    walk(root)
    candidates.sort { lhs, rhs in
        if lhs.area == rhs.area { return lhs.descendantCount > rhs.descendantCount }
        return lhs.area > rhs.area
    }
    return candidates
}

private func frameArea(_ frame: AXNode.Frame?, windowFrame: AXNode.Frame?) -> Double {
    guard let frame = frame else { return 0 }
    if let windowFrame = windowFrame {
        let windowArea = max(1.0, windowFrame.width * windowFrame.height)
        let area = frame.width * frame.height
        if area > windowArea { return 0 }
        if area < windowArea * 0.2 { return 0 }
        return area
    }
    return frame.width * frame.height
}

private func countDescendants(_ element: AXUIElement, limit: Int = 2000) -> Int {
    var count = 0
    var stack = getChildren(element)
    while !stack.isEmpty && count < limit {
        let current = stack.removeLast()
        count += 1
        stack.append(contentsOf: getChildren(current))
    }
    return count
}

private struct SnapshotPayload: Codable {
    let windowFrame: AXNode.Frame?
    let root: AXNode
}

func main() throws {
    guard hasAccessibilityPermission() else {
        throw AXSnapshotError(message: "Accessibility permission not granted. Enable it in System Settings > Privacy & Security > Accessibility.")
    }
    guard let simulator = findSimulatorApp() else {
        throw AXSnapshotError(message: "iOS Simulator is not running.")
    }
    guard let (root, windowFrame, _, extras) = findIOSAppSnapshot(in: simulator) else {
        throw AXSnapshotError(message: "Could not find iOS app content in Simulator.")
    }
    var tree = buildTree(root)
    if !extras.isEmpty {
        let extraNodes = extras.map { buildTree($0) }
        tree = AXNode(
            role: tree.role,
            subrole: tree.subrole,
            label: tree.label,
            value: tree.value,
            identifier: tree.identifier,
            frame: tree.frame,
            children: tree.children + extraNodes
        )
    }
    let snapshot = SnapshotPayload(windowFrame: windowFrame, root: tree)
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    let data = try encoder.encode(snapshot)
    if let json = String(data: data, encoding: .utf8) {
        print(json)
    } else {
        throw AXSnapshotError(message: "Failed to encode AX snapshot JSON.")
    }
}

do {
    try main()
} catch {
    fputs("axsnapshot error: \(error)\n", stderr)
    exit(1)
}
