import { useCallback, useEffect, useRef, type MouseEvent } from "react";

type ReturnFocusState = { href: string; scrollTop: number };

/** Preserve the user's place when a collection row opens and Back returns to it. */
export function useCollectionReturnFocus(
  storageKey: string,
  visibleKey: unknown,
  hrefPrefix: string,
) {
  const pending = useRef<ReturnFocusState | undefined>(undefined);
  const remember = useCallback(
    (href: string) => {
      try {
        const main = document.querySelector<HTMLElement>(".relay-main");
        sessionStorage.setItem(
          storageKey,
          JSON.stringify({ href, scrollTop: main?.scrollTop ?? 0 } satisfies ReturnFocusState),
        );
      } catch {
        // Restoration is an enhancement when session storage is unavailable.
      }
    },
    [storageKey],
  );

  useEffect(() => {
    if (!pending.current) {
      try {
        const raw = sessionStorage.getItem(storageKey);
        if (raw) {
          const parsed: unknown = JSON.parse(raw);
          if (
            parsed &&
            typeof parsed === "object" &&
            typeof (parsed as ReturnFocusState).href === "string" &&
            typeof (parsed as ReturnFocusState).scrollTop === "number"
          ) {
            pending.current = parsed as ReturnFocusState;
          }
        }
      } catch {
        pending.current = undefined;
      }
    }
    const saved = pending.current;
    if (!saved) return;
    let second: number | undefined;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => {
        const anchor = document.querySelector<HTMLElement>(`a[href="${CSS.escape(saved.href)}"]`);
        if (!anchor) return;
        const main = document.querySelector<HTMLElement>(".relay-main");
        if (main) main.scrollTop = saved.scrollTop;
        anchor.focus();
        pending.current = undefined;
        try {
          sessionStorage.removeItem(storageKey);
        } catch {
          // Restoration is complete even when storage cleanup is unavailable.
        }
      });
    });
    return () => {
      cancelAnimationFrame(first);
      if (second !== undefined) cancelAnimationFrame(second);
    };
  }, [storageKey, visibleKey]);

  const onClickCapture = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>("a[href]");
      const href = anchor?.getAttribute("href");
      if (href?.startsWith(hrefPrefix)) remember(href);
    },
    [hrefPrefix, remember],
  );

  return { onClickCapture };
}
