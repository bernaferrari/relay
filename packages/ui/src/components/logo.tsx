import { type ComponentProps, splitProps } from "solid-js";

export interface LogoProps extends ComponentProps<"div"> {
  /** Show only the mark (no wordmark) */
  markOnly?: boolean;
  /** Compact wordmark */
  compact?: boolean;
}

export function Logo(props: LogoProps) {
  const [split, rest] = splitProps(props, [
    "markOnly",
    "compact",
    "class",
    "classList",
    "children",
  ]);
  return (
    <div
      {...rest}
      data-component="logo"
      data-compact={split.compact ? "true" : undefined}
      classList={{
        ...split.classList,
        [split.class ?? ""]: !!split.class,
      }}
    >
      <span data-slot="logo-mark" aria-hidden="true" />
      {!split.markOnly && (
        <span data-slot="logo-wordmark">
          {split.compact ? (
            "Grok"
          ) : (
            <>
              Grok <em>Device</em>
            </>
          )}
        </span>
      )}
      {split.children}
    </div>
  );
}
