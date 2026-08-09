import { useTheme, type ColorScheme } from "@relay/ui/theme/context";
import { For } from "solid-js";
import { useServer } from "../context/server";
import {
  ACCESSIBILITY_OVERLAY_MODES,
  ACCESSIBILITY_OVERLAY_MODE_DESCRIPTIONS,
  ACCESSIBILITY_OVERLAY_MODE_LABELS,
} from "../lib/accessibility-overlay-mode";
import { cn } from "../lib/cn";
import { seg, segBtn, segBtnOn } from "../lib/ui";

const rowCls =
  "flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-b-0";
const rowCopyCls = "flex min-w-0 flex-col gap-0.5";
const rowTitleCls = "text-12-medium text-text-strong";
const rowDescCls = "text-12-regular leading-snug text-text-weak";

export function AppearanceSettingsPanel() {
  const theme = useTheme();
  const server = useServer();
  return (
    <>
      <div class={rowCls}>
        <div class={rowCopyCls}>
          <span class={rowTitleCls}>Color scheme</span>
          <span class={rowDescCls}>
            Relay keeps the same visual language in light and dark mode.
          </span>
        </div>
        <div class="shrink-0">
          <div class={seg} role="group" aria-label="Color scheme">
            {(
              [
                ["system", "System"],
                ["light", "Light"],
                ["dark", "Dark"],
              ] as const
            ).map(([id, label]) => (
              <button
                type="button"
                class={cn(segBtn, theme.colorScheme() === id && segBtnOn)}
                onClick={() => theme.setColorScheme(id as ColorScheme)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div class={rowCls}>
        <div class={rowCopyCls}>
          <span class={rowTitleCls}>Accessibility overlay</span>
          <span class={rowDescCls}>
            {ACCESSIBILITY_OVERLAY_MODE_DESCRIPTIONS[server.accessibilityMode()]}
          </span>
        </div>
        <div class="shrink-0">
          <div class={seg} role="group" aria-label="Accessibility overlay">
            <For each={ACCESSIBILITY_OVERLAY_MODES}>
              {(mode) => (
                <button
                  type="button"
                  class={cn(segBtn, server.accessibilityMode() === mode && segBtnOn)}
                  aria-pressed={server.accessibilityMode() === mode}
                  onClick={() => server.setAccessibilityMode(mode)}
                >
                  {ACCESSIBILITY_OVERLAY_MODE_LABELS[mode]}
                </button>
              )}
            </For>
          </div>
        </div>
      </div>
    </>
  );
}
