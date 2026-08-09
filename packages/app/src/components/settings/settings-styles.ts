import { copyDescription, copyStack, copyTitle } from "../../lib/ui";

export const rowCls =
  "flex items-center justify-between gap-4 border-b border-border-weak-base py-3 last:border-b-0";

export const rowCopyCls = copyStack;
export const rowTitleCls = `text-12-medium ${copyTitle}`;
export const rowDescCls = `text-12-regular ${copyDescription}`;
export const inputCls =
  "h-8 w-full rounded-md border border-border-weak-base bg-surface-raised-stronger-non-alpha px-2.5 text-12-regular text-text-strong focus:border-border-focus focus:outline-none";
