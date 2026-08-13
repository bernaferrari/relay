/**
 * Focus management for a modal dialog: focus the first focusable child, trap
 * Tab/Shift+Tab within `root`, and restore focus to the previously-active
 * element when the returned disposer runs. ~40 lines, no dependencies.
 */
const FOCUSABLE =
  'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not([aria-label="Close"]), [tabindex]:not([tabindex="-1"])';

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.offsetParent !== null || el === document.activeElement,
  );
}

export function trapFocus(root: HTMLElement): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;

  const list = focusables(root);
  const target = list[0] ?? root;
  root.tabIndex = -1;
  target.focus({ preventScroll: true });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const items = focusables(root);
    if (items.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement as HTMLElement | null;
    if (e.shiftKey) {
      if (active === first || !root.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else if (active === last) {
      e.preventDefault();
      first.focus();
    }
  }

  root.addEventListener("keydown", onKeyDown);

  return () => {
    root.removeEventListener("keydown", onKeyDown);
    root.tabIndex = -1;
    previouslyFocused?.focus?.({ preventScroll: true });
  };
}

/** Move focus into a non-modal interruption while keeping surrounding chrome
 * reachable, then return focus when the interruption clears. */
export function focusFirstAndRestore(root: HTMLElement): () => void {
  const previouslyFocused = document.activeElement as HTMLElement | null;
  const target = focusables(root)[0] ?? root;
  root.tabIndex = -1;
  target.focus({ preventScroll: true });
  return () => previouslyFocused?.focus?.({ preventScroll: true });
}
