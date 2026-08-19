import { cn } from "./cn";

/**
 * Field grammar for the Test workspace. One control height (32px), one control
 * type size (13px, `--type-control`), one focus treatment. The previous 16px
 * inputs were what made the step editor read like a web form from 2010.
 */
export const testEditorInput = cn(
  "min-h-9 w-full rounded-md border border-border-weak-base bg-background-base px-2.5 py-1",
  "text-body text-text-strong outline-none",
  "transition-[border-color,box-shadow] duration-hover motion-reduce:transition-none",
  "placeholder:text-text-weaker",
  "hover:enabled:border-border-base",
  "focus-visible:border-border-focus focus-visible:ring-2 focus-visible:ring-surface-info-weak",
  "disabled:text-text-weak",
);

/** Multi-line variant: same grammar, room to read a sentence. */
export const testEditorTextarea = cn(testEditorInput, "min-h-16 resize-y py-2");

/** Label directly above its control (6px gap at the call site). */
export const testEditorLabel = "text-caption/[1.25] font-medium text-text-base";

/** Section heading inside the editor — named for what the section does. */
export const testEditorSection = "text-caption/[1.25] font-semibold text-text-strong";

/** Helper line under a control or a switch row. */
export const testEditorHint = "text-caption/[1.4] text-text-weak";

/** Row inside a rail or list: full width, quiet hover, keyboard-visible focus. */
export const testQuietRow = cn(
  "w-full rounded-md text-left transition-colors duration-hover motion-reduce:transition-none",
  "hover:bg-surface-base-hover",
  "focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-border-strong-focus",
);

/** Selection is one filled wash. No border, no ring, no decorative rail. */
export const testSelectedRow =
  "bg-[var(--product-accent-soft)] hover:bg-[var(--product-accent-soft)]";
