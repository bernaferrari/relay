# Relay interface

Relay is a focused desktop workspace for recording, understanding, and running app tests. The device and the user's work are the visual center. Controls explain what they do without exposing internal protocol or proof terminology.

## Shared visual language

The palette lives in `packages/ui-react/src/styles/globals.css`. Use its semantic tokens everywhere. Use the installed shadcn neutral palette and standard button variants. Light and dark mode share the same surface hierarchy; do not add bespoke page palettes.

| Surface          | Token                        | Purpose                                                                              |
| ---------------- | ---------------------------- | ------------------------------------------------------------------------------------ |
| Navigation frame | `background-weak`            | Sidebar and top navigation share one continuous background, without a dividing line. |
| Workspace        | `background-base`            | Inset, rounded working area directly beneath navigation; no extra top margin.        |
| Panels and cards | `surface-raised-strong`      | A small lightness increase groups related content.                                   |
| Controls         | `surface-base`, `input-base` | Subtle elevation, consistent 8–10px corners.                                         |

Use quiet borders only to separate adjacent functional regions. Avoid framing every label, row, or status in another card. Keep labels readable with `text-weak`; reserve `text-weaker` for genuinely secondary metadata. Use Lucide icons at consistent 16px optical size and text labels for important actions.

## Navigation and authoring

`AuthoringHeader` provides one hierarchy across setup, recording, review, and saved tests. Back/cancel is on the left, context and phase follow, and the primary next action is on the right. Android Back belongs directly beneath the device, because it controls the app rather than Relay navigation.

`AuthoringWorkspace` anchors the full-height device/result stage on the left and setup or steps on the right. Editing appears directly below the steps, never as an overlay covering them. Both regions scroll independently; narrow windows stack the stage above the tools. Keep this shared geometry across route changes rather than composing a new column layout per screen.

The global sidebar can be collapsed. Its background continues into the title bar. Pages use the same shell rather than adding separate navigation frames.

App creation is an option in the App menu. Device selection includes configured emulators, which also appear in Devices and the global picker. Starting a stopped emulator is part of selecting that device; configured devices must never be presented as runnable before they connect.

## Recording and review

Fit the entire device into available height, preserve its aspect ratio, and keep controls visible. A screenshot is never cropped to make a card fit. Step lists use compact numbered rows with gesture icons. Selecting a reviewed step reveals its editing details.

Show one status that explains the next action. Successful capture does not need a repeated “Verified” badge on every row and panel. Errors say what is unavailable and provide a relevant recovery action. A selected device temporarily missing from discovery remains a selected device awaiting availability, not a new empty selection.

Coordinate targets explicitly state their units and origin. Fixed screen pixels are measured from the full screen's top-left and do not promise to adapt across sizes. Accessibility labels and identifiers are alternative deliberate bindings. Changing a binding still requires replay through the canonical authoring workflow.
