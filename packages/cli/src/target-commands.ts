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
    path("target devices"),
    path("device list", [], undefined, {
      summary: "List connected devices",
      examples: ["relay device list", "relay target device list --json"],
    }),
  ),
  mapped(
    "target.avds.list",
    path("target avd list"),
    path("device avd list", [], undefined, {
      summary: "List configured Android emulators (including stopped AVDs)",
      examples: ["relay device avd list --json"],
      note: "Read-only. AVDs are separate from connected devices; a stopped AVD has no ADB serial until it boots.",
    }),
  ),
  mapped(
    "target.health.get",
    path("target health", ["serial"]),
    path("device health", ["serial"], undefined, {
      summary: "Read bounded target health without taking control",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      examples: ["relay device health 00008110 --json"],
      note: "Read-only. Pixels, semantics, input, and overall health are reported independently; pixel-only does not mean disconnected.",
    }),
  ),
  mapped(
    "target.input.receipt.get",
    path("target input receipt", ["serial"]),
    path("device input-receipt", ["serial"], undefined, {
      summary: "Read a durable reconciliation receipt without sending input",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      examples: ["relay device input-receipt 00008110 --mutationId ios-input-123 --json"],
    }),
  ),
  mapped(
    "target.input.reconcile",
    path("target input reconcile", ["serial", "mutationId", "outcome"]),
    path("device reconcile-input", ["serial", "mutationId", "outcome"], undefined, {
      summary: "Review one uncertain device input against a fresh observation",
      argumentHelp: [
        { name: "serial", type: "string", description: "Connected iOS device serial" },
        { name: "mutationId", type: "string", description: "Pending mutation from target health" },
        {
          name: "outcome",
          type: "applied | not-applied | ambiguous",
          description: "Human-reviewed result of the uncertain command",
        },
      ],
      examples: ["relay device reconcile-input 00008110 ios-input-123 applied --confirm --json"],
      note: "Relay captures fresh immutable pixels and semantics before releasing the exact-once fence. Ambiguous keeps the target stopped for human review.",
    }),
  ),
  mapped("target.list", path("target list")),
  mapped("target.app.list", path("device apps", ["serial"])),
  mapped("target.create", path("target create")),
  mapped("target.delete", path("target delete", ["targetId"])),
  mapped("target.preflight", path("target preflight", ["targetId"])),
  mapped("target.open", path("target open", ["targetId"]), path("browser open", ["targetId"])),
  mapped(
    "target.browser-auth.save",
    path("browser auth save", ["targetId"], undefined, {
      summary: "Encrypt and freeze the current reviewed browser sign-in state",
      argumentHelp: [
        { name: "targetId", type: "string", description: "Managed browser target identifier" },
      ],
      inputHelp: [
        { name: "name", type: "string", description: "Human-readable fixture name" },
        {
          name: "expiresAt",
          type: "unix milliseconds",
          description: "Optional required expiry for this exact fixture revision",
        },
      ],
      examples: [
        'relay browser auth save staging-web --input \'{"name":"Reviewed staging account"}\' --confirm --json',
      ],
      note: "Human-only. Open the Browser Device and complete sign-in first. Relay stores encrypted browser state and returns a non-secret exact reference.",
    }),
  ),
  mapped(
    "target.browser-auth.list",
    path("browser auth list", ["targetId"], undefined, {
      summary: "List non-secret browser sign-in fixture metadata",
      examples: ["relay browser auth list staging-web --json"],
    }),
  ),
  mapped(
    "target.browser-auth.revoke",
    path("browser auth revoke", ["targetId", "reference"], undefined, {
      summary: "Revoke one exact browser sign-in fixture revision",
      examples: [
        "relay browser auth revoke staging-web authfx:00000000-0000-4000-8000-000000000000:1 --confirm --json",
      ],
      note: "Human-only. A revoked fixture fails closed in every future Proof.",
    }),
  ),
  mapped(
    "target.browser-auth.probe",
    path("browser auth probe", ["targetId", "reference"], undefined, {
      summary: "Check whether a saved browser sign-in is still signed in",
      argumentHelp: [
        { name: "targetId", type: "string", description: "Managed browser target identifier" },
        {
          name: "reference",
          type: "string",
          description: "Exact authfx fixture reference",
        },
      ],
      examples: [
        "relay browser auth probe staging-web authfx:00000000-0000-4000-8000-000000000000:1 --json",
      ],
      note: "Opens a fresh headed-off proof context with the encrypted cookies. Signed-out or expired fixtures fail closed before the next Plan.",
    }),
  ),
  mapped(
    "target.browser-auth.health",
    path("browser auth health", ["targetId"], undefined, {
      summary: "Check live sign-ins and which Lanes they bind",
      argumentHelp: [
        { name: "targetId", type: "string", description: "Managed browser target identifier" },
      ],
      inputHelp: [
        {
          name: "probe",
          type: "boolean",
          description:
            "Open a proof browser for each live sign-in. Defaults to true. Revoked fixtures are not opened.",
        },
      ],
      examples: ["relay browser auth health grok-com --json"],
      note: "Does not write authenticationFixtureId onto the saved browser environment. Concurrent N-account is unmeasured until more than one live fixture exists. Revoked lab A/B/C are not accounts. Electron persist:lane:grok-lab is a separate store from Playwright grok-lab; absent is blocked, not a SuperGrok pass.",
    }),
  ),
  mapped(
    "target.boot",
    path("target boot", ["serial"]),
    path("device boot", ["serial"], undefined, {
      summary: "Boot a device",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
    }),
  ),
  mapped(
    "target.avd.boot",
    path("target avd boot", ["avdName"]),
    path("device avd boot", ["avdName"], undefined, {
      summary: "Boot exactly one named Android emulator",
      argumentHelp: [{ name: "avdName", type: "string", description: "Exact configured AVD name" }],
      inputHelp: [
        { name: "headless", type: "boolean", description: "Boot without a window or audio" },
        { name: "timeoutMs", type: "number", description: "Readiness budget, 1000–300000 ms" },
      ],
      examples: ["relay device avd boot Pixel_9_API_36 --headless --json"],
      note: "Local-host only. Relay never guesses an AVD or reuses a tab/session; it returns the observed ADB serial after sys.boot_completed=1.",
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
    path("browser snapshot", ["serial"], { visual: true }),
    path(
      "device observe",
      ["serial"],
      { visual: true },
      {
        summary:
          "Read the current screen. --json prints the raw tree (nodes); human output is a digest unless --full prints the raw tree; --file writes a review tree",
        argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
        inputHelp: [
          {
            name: "full",
            type: "boolean",
            description:
              "Force the raw snapshot tree (nodes) in human output; --json/--ndjson already include it; set by --full",
          },
        ],
        examples: [
          "relay device observe 00008110 --json",
          "relay device observe 00008110 --json --full",
          "relay device observe 00008110 --file tree.json",
        ],
        note: "Read-only. --json/--ndjson stdout is the raw tree (nodes), matching HTTP /snapshot?visual=1; plain human output stays a digest (app, header, controls, nodeCount) unless --full. --file writes a review tree: document defaults, nodes only write overrides. On iPad, Relay can still return pixels when XCTest accessibility control is unavailable. --lane applies the saved browser fixture overlay; snapshot grok-com without a Lane is the unsigned profile.",
      },
    ),
    path(
      "device observe",
      [],
      { visual: true },
      {
        summary: "Read the current screen using --lane instead of a positional serial",
        examples: ["relay device observe --lane grok-lab --json --full"],
        note: "--lane or --input serial is required when the positional serial is omitted.",
      },
    ),
    path(
      "device snapshot",
      ["serial"],
      { visual: true },
      {
        summary:
          "Read the current screen. --json prints the raw tree (nodes); human output is a digest unless --full prints the raw tree; --file writes a review tree",
        argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
        inputHelp: [
          {
            name: "full",
            type: "boolean",
            description:
              "Force the raw snapshot tree (nodes) in human output; --json/--ndjson already include it; set by --full",
          },
        ],
        examples: [
          "relay device snapshot emulator-5554 --json",
          "relay device snapshot emulator-5554 --json --full",
          "relay device snapshot emulator-5554 --file tree.json",
          "relay device snapshot --lane grok-lab --json --full",
        ],
        note: "Read-only. --json/--ndjson stdout is the raw tree (nodes), matching HTTP /snapshot?visual=1; plain human output stays a digest (app, header, controls, nodeCount) unless --full. --file writes a review tree: document defaults, nodes only write overrides. On iPad, Relay can still return pixels when XCTest accessibility control is unavailable. --lane applies the saved browser fixture overlay; snapshot grok-com without a Lane is the unsigned profile.",
      },
    ),
    path(
      "device snapshot",
      [],
      { visual: true },
      {
        summary: "Read the current screen using --lane instead of a positional serial",
        examples: ["relay device snapshot --lane grok-lab --json --full"],
        note: "--lane or --input serial is required when the positional serial is omitted.",
      },
    ),
  ),
  mapped(
    "target.screenshot.capture",
    path("target screenshot", ["serial"], undefined, { behavior: "screenshot" }),
    path("browser screenshot", ["serial"], undefined, { behavior: "screenshot" }),
    path("device screenshot", ["serial"], undefined, {
      summary: "Capture the current screen as PNG",
      argumentHelp: [{ name: "serial", type: "string", description: "Connected device serial" }],
      examples: [
        "relay device screenshot emulator-5554 --file current.png",
        "relay device screenshot emulator-5554 --binary > current.png",
        "relay device screenshot 00008110 --mark 78,88 --file preview.png",
      ],
      note: "Happy path 1/3: screenshot, then interact, then screenshot again. Use --file <path> for a PNG file or --binary for raw PNG bytes on stdout. --mark x,y paints a tap preview and does not tap. On iOS 17+ this uses go-ios pixels (tunnel), not target.open. A missing XCTest session is not a failed screenshot. Do not start with test run or survey.",
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
          description: "Maximum downward scrolls; defaults to 4; set by --max-scrolls",
        },
        {
          name: "dir",
          type: "string",
          description:
            "Folder for sibling 00.png / 00.json frames (review tree: defaults + overrides). Prefer --dir over inline --json. Refuses a non-empty dest unless --force.",
        },
        {
          name: "force",
          type: "boolean",
          description: "Overwrite a non-empty survey directory. Only valid with dir.",
        },
        {
          name: "restore",
          type: "boolean",
          description:
            "Restore the starting viewport after capture. Default true. --no-restore skips the up-swipes when the next action relaunches or abandons.",
        },
      ],
      examples: [
        "relay device survey emulator-5554 --dir ./survey --json",
        "relay device survey 00008110 --dir ./survey --max-scrolls 3 --no-restore --json",
      ],
      note: "Requires an exclusive lease owned by the same --actor. Prefer --dir so stdout stays a digest (index, offsetY, files, label counts) instead of megabytes of base64. Refuses a non-empty dest unless --force. Default restores the start viewport; --no-restore leaves the list where it landed.",
    }),
  ),
  mapped(
    "target.app.launch",
    path("target app launch", ["serial", "app"]),
    path("browser navigate", ["serial", "app"]),
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
      note: "List only. Apply one tag directly with `relay device locale <serial> <package> <tag>`, or teach an appLocale Variable (`relay variable save`) and run it as a Combine. Combine export writes screenshots plus accessibility JSON.",
    }),
  ),
  mapped(
    "target.app.locale.set",
    path("target locale", ["serial", "package", "locale"]),
    path("device locale", ["serial", "package", "locale"], undefined, {
      summary: "Set an Android app's per-app locale and verify it took",
      argumentHelp: [
        { name: "serial", type: "string", description: "Connected Android device serial" },
        { name: "package", type: "string", description: "Android package name" },
        { name: "locale", type: "string", description: "BCP-47 tag such as de, he, or pt-BR" },
      ],
      examples: [
        "relay device locale emulator-5554 com.example.app de --json",
        "relay device locale RQCY104BG8X ai.x.grok he",
      ],
      note: "Applies Android's per-app locale (he/iw and id/in aliases retried), reads the locale back, and fails when the app still reports another language. Requires an exclusive lease owned by the same --actor. For saved coverage teach an appLocale Variable (`relay variable save`) and run it with `relay test run <map> <test> --in language=<tag>`. Combine export writes screenshots plus accessibility JSON.",
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
      note: "iPad: first proves the existing XCTest session; only a failed proof gets one bounded runner repair. It never resets the app or restarts the iPad. A dead go-ios userspace tunnel is restored on this same recover — do not spawn `ios tunnel start` as a sidecar and do not reboot. Android: wake the screen and retry labels. Unlock still needs a person. Supplying recoveryFenceAssignmentId is local-host-only and records a new pixel/semantic/pixel proof before any durable fence is released.",
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
    path("browser click", ["serial", "label"], { kind: "label" }),
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
        'relay device interact --preview --lane grok-lab --file preview.png --input \'{"kind":"label","label":"Imagine"}\'',
        'relay device interact emulator-5554 --input \'{"kind":"swipe","from":{"x":540,"y":1800},"to":{"x":540,"y":650},"durationMs":300}\'',
      ],
      note: "Happy path 2/3 after screenshot. Device input requires an active exclusive lease owned by the same --actor. --preview paints the selection on a screenshot and does not tap. --lane fills the target (and browser fixture overlay) so --input-file is not needed.",
    }),
    path("device interact", [], undefined, {
      summary: "Interact using --lane instead of a positional serial",
      examples: [
        'relay device interact --preview --lane grok-lab --file preview.png --input \'{"kind":"label","label":"Back"}\'',
      ],
      note: "--lane or --input serial is required when the positional serial is omitted.",
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
