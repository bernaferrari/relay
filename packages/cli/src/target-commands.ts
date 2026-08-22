import {
  commandPath as path,
  mappedOperation as mapped,
  type MappedOperationDescriptor,
} from "./command-descriptors.js";

/** Device discovery, observation, recovery, and direct-control commands. */
export const targetCommandDescriptors: readonly MappedOperationDescriptor[] = [
  mapped("target.actions.list", path("action list")),
  mapped(
    "target.devices.list",
    path("target device list"),
    path("device list", [], undefined, {
      summary: "List connected devices",
      examples: ["relay device list"],
    }),
  ),
  mapped("target.list", path("target list")),
  mapped("target.create", path("target create")),
  mapped("target.delete", path("target delete", ["targetId"])),
  mapped("target.preflight", path("target preflight", ["targetId"])),
  mapped("target.open", path("target open", ["targetId"])),
  mapped(
    "target.boot",
    path("target boot", ["serial"]),
    path("device boot", ["serial"], undefined, {
      summary: "Boot a device",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
  ),
  mapped(
    "target.authorize",
    path("target authorize", ["serial"]),
    path("device authorize", ["serial"], undefined, {
      summary: "Authorize a device for control",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
  ),
  mapped(
    "target.snapshot.capture",
    path("target observe", ["serial"]),
    path("target snapshot", ["serial"]),
    path(
      "device observe",
      ["serial"],
      { visual: true },
      {
        summary:
          "Read the current screen. Default JSON is a digest; --full or --file returns the accessibility tree",
        argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
        inputHelp: [
          {
            name: "full",
            type: "boolean",
            description:
              "Return the full snapshot tree (nodes) instead of the digest; also set by --full or --file",
          },
        ],
        examples: [
          "relay device observe 00008110 --json",
          "relay device observe 00008110 --json --full",
          "relay device observe 00008110 --file tree.json",
        ],
        note: "Read-only. Default --json is a digest (app, header, controls, nodeCount). --full or --file is the tree. On iPad, Relay can still return pixels when XCTest accessibility control is unavailable.",
      },
    ),
    path(
      "device snapshot",
      ["serial"],
      { visual: true },
      {
        summary:
          "Read the current screen. Default JSON is a digest; --full or --file returns the accessibility tree",
        argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
        inputHelp: [
          {
            name: "full",
            type: "boolean",
            description:
              "Return the full snapshot tree (nodes) instead of the digest; also set by --full or --file",
          },
        ],
        examples: [
          "relay device snapshot emulator-5554 --json",
          "relay device snapshot emulator-5554 --json --full",
          "relay device snapshot emulator-5554 --file tree.json",
        ],
        note: "Read-only. Default --json is a digest (app, header, controls, nodeCount). --full or --file is the tree. On iPad, Relay can still return pixels when XCTest accessibility control is unavailable.",
      },
    ),
  ),
  mapped(
    "target.screenshot.capture",
    path("target screenshot", ["serial"], undefined, { behavior: "screenshot" }),
    path("device screenshot", ["serial"], undefined, {
      summary: "Capture the current screen as PNG",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      examples: [
        "relay device screenshot emulator-5554 --file current.png",
        "relay device screenshot emulator-5554 --binary > current.png",
        "relay device screenshot 00008110 --mark 78,88 --file preview.png",
      ],
      note: "Use --file <path> for a PNG file or --binary for raw PNG bytes on stdout. --mark x,y paints a tap preview and does not tap.",
      behavior: "screenshot",
    }),
  ),
  mapped(
    "target.scroll-survey.capture",
    path("target survey", ["serial"]),
    path("device survey", ["serial"], undefined, {
      summary: "Capture a bounded scrollable page with original viewport evidence",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "maxScrolls",
          type: "integer (1-12)",
          description: "Maximum downward scrolls; defaults to 4",
        },
      ],
      examples: [
        "relay device survey emulator-5554 --json",
        "relay device survey 00008110 --input '{\"maxScrolls\":6}' --json",
      ],
      note: "Requires an exclusive lease. Relay keeps every original PNG + accessibility snapshot, stops at uncertain seams, and restores the starting viewport.",
    }),
  ),
  mapped(
    "target.app.launch",
    path("target app launch", ["serial", "app"]),
    path("device launch", ["serial", "app"], undefined, {
      summary: "Launch an app and make it the active device session",
      argumentHelp: [
        { name: "serial", type: "string", description: "Connected device serial" },
        { name: "app", type: "string", description: "App name, package, or bundle identifier" },
      ],
      inputHelp: [
        {
          name: "relaunch",
          type: "boolean",
          description: "Terminate first for a clean launch; defaults to false",
        },
      ],
      examples: [
        "relay device launch emulator-5554 com.example.app",
        "relay device launch 00008110 Settings",
      ],
    }),
  ),
  mapped(
    "target.app.locales",
    path("target app locales", ["serial", "package"]),
    path("device app-locales", ["serial", "package"], undefined, {
      summary: "List the locales declared by an installed Android app",
      argumentHelp: [
        { name: "serial", type: "string", description: "Connected Android device serial" },
        { name: "package", type: "string", description: "Android package name" },
      ],
      examples: ["relay device app-locales emulator-5554 com.example.app --json"],
      note: "Reads the installed app's locale configuration dynamically; the result is not a hard-coded language list.",
    }),
  ),
  mapped(
    "target.recover",
    path("target recover", ["serial"]),
    path("device recover", ["serial"], undefined, {
      summary: "Verify and, only when necessary, repair live device control",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "reason",
          type: "connect | observe | control | record | auto",
          description: "Recovery phase for Activity attribution",
        },
        {
          name: "recoveryFenceAssignmentId",
          type: "string",
          description:
            "Release this interrupted local worker assignment only after Relay captures fresh screenshot and accessibility evidence",
        },
      ],
      examples: [
        'relay device recover 00008110 --input \'{"reason":"control"}\'',
        "relay device recover RQCY104BG8X",
      ],
      note: "iPad: first proves the existing XCTest session; only a failed proof gets one bounded runner repair. It never resets the app or restarts the iPad. Android: wake the screen and retry labels. Unlock still needs a person. Supplying recoveryFenceAssignmentId is local-host-only and records a new pixel/semantic/pixel proof before any durable fence is released.",
    }),
  ),
  mapped(
    "target.ui.describe",
    path("target ui", ["serial"], undefined, {
      summary: "Describe app/sheet/keyboard/bounds for the current target",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      examples: ["relay target ui 00008110"],
    }),
    path("device ui", ["serial"], undefined, {
      summary: "Describe app/sheet/keyboard/bounds for the current target",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
  ),
  mapped(
    "target.ui.back",
    path("target back", ["serial"], undefined, {
      summary: "Sheet-aware back (Back/parent title before Close)",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      examples: ['relay target back 00008110 --input \'{"parentTitles":["Settings"]}\''],
      note: "Requires an exclusive lease owned by the same --actor.",
    }),
    path("device back", ["serial"]),
  ),
  mapped(
    "target.ui.scrollCollect",
    path("target scroll-collect", ["serial"], undefined, {
      summary: "Scroll a list and collect interactive controls without overscroll-dismiss",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      note: "Requires an exclusive lease owned by the same --actor.",
    }),
    path("device scroll-collect", ["serial"]),
  ),
  mapped(
    "target.interact",
    path("target interact", ["serial"]),
    path("device interact", ["serial"], undefined, {
      summary: "Perform a semantic device interaction",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "kind",
          type: "identifier | label | point | ref | find | text-match | swipe | key | type | replace",
          required: true,
          description: "Semantic interaction kind",
        },
      ],
      examples: [
        "relay lease create 00008110 --actor agent:mapper",
        'relay device interact 00008110 --actor agent:mapper --input \'{"kind":"label","label":"Continue"}\'',
        'relay device interact 00008110 --preview --file preview.png --input \'{"kind":"label","label":"Back"}\'',
        'relay device interact emulator-5554 --input \'{"kind":"swipe","from":{"x":540,"y":1800},"to":{"x":540,"y":650},"durationMs":300}\'',
      ],
      note: "Device input requires an active exclusive lease owned by the same --actor. --preview paints the selection on a screenshot and does not tap.",
    }),
  ),
  mapped(
    "target.ground",
    path("target ground", ["serial"]),
    path("device ground", ["serial"], undefined, {
      summary: "Resolve text or structured target to an InteractInput without tapping",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "target",
          type: "string | InteractInput",
          required: true,
          description: "Text to ground (Appearance, Menu), or a full InteractInput to passthrough",
        },
      ],
      examples: [
        'relay device ground emulator-5554 --input \'{"target":"Appearance"}\' --json',
        'relay device ground emulator-5554 --input \'{"target":"Menu"}\' --actor agent:mapper --json',
      ],
      note: "Uses a11y → Grok header heuristics → optional OpenRouter vision. Does not tap. Prefer device do to ground+tap in one step.",
    }),
  ),
  mapped(
    "target.do",
    path("target do", ["serial", "target"]),
    path("device do", ["serial", "target"], undefined, {
      summary: "Ground a text target then tap it",
      argumentHelp: [
        { name: "serial", type: "string", description: "Connected device serial" },
        {
          name: "target",
          type: "string",
          description: "Accessibility label, identifier, or natural-language name",
        },
      ],
      examples: [
        "relay device do emulator-5554 Appearance --actor agent:mapper --json",
        "relay device do emulator-5554 Menu --actor agent:mapper --json",
      ],
      note: "Requires an exclusive lease. Grounds via a11y/heuristic/vision then commits interact.",
    }),
  ),
  mapped(
    "target.touch",
    path("target touch", ["serial"]),
    path("device touch", ["serial"], undefined, {
      summary: "Send a low-level touch event",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "action",
          type: "down | move | up | cancel",
          required: true,
          description: "Touch phase",
        },
        { name: "x", type: "number", required: true, description: "Normalized x coordinate" },
        { name: "y", type: "number", required: true, description: "Normalized y coordinate" },
      ],
      note: "Requires an active exclusive lease owned by the same --actor. Create one with relay lease create <serial> --actor <id>.",
    }),
  ),
  mapped(
    "target.key",
    path("target key", ["serial"]),
    path("device key", ["serial"], undefined, {
      summary: "Send a device key",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "kind",
          type: "text | key",
          required: true,
          description: "Keyboard input kind",
        },
        { name: "text", type: "string", description: "Required when kind is text" },
        { name: "key", type: "enter | backspace", description: "Required when kind is key" },
      ],
      note: "Requires an active exclusive lease owned by the same --actor. Create one with relay lease create <serial> --actor <id>.",
    }),
  ),
  mapped(
    "target.scroll",
    path("target scroll", ["serial"]),
    path("device scroll", ["serial"], undefined, {
      summary: "Scroll the current device screen",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        { name: "x", type: "number", required: true, description: "Gesture origin x" },
        { name: "y", type: "number", required: true, description: "Gesture origin y" },
        { name: "scrollX", type: "number", required: true, description: "Horizontal delta" },
        { name: "scrollY", type: "number", required: true, description: "Vertical delta" },
      ],
      note: "Requires an active exclusive lease owned by the same --actor. Create one with relay lease create <serial> --actor <id>.",
    }),
  ),
  mapped(
    "target.video.start",
    path("target video", ["serial"]),
    path("device video", ["serial"], undefined, {
      summary: "Record device video",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      inputHelp: [
        {
          name: "action",
          type: "start | stop",
          required: true,
          description: "Recording action (Apple devices)",
        },
      ],
    }),
  ),
];
