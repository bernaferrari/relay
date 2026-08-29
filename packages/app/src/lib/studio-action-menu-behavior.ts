import { createEffect, onCleanup, onMount, type Accessor } from "solid-js";

export function createStudioActionMenuBehavior(props: {
  open: Accessor<boolean>;
  setOpen: (open: boolean) => void;
  trigger: () => HTMLButtonElement | undefined;
  menu: () => HTMLDivElement | undefined;
}) {
  const visibleItems = () =>
    props.menu()
      ? [...props.menu()!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].filter(
          (item) => !item.disabled && item.offsetParent !== null,
        )
      : [];

  createEffect(() => {
    if (!props.open()) return;
    queueMicrotask(() => visibleItems()[0]?.focus());
  });

  onMount(() => {
    const dismiss = (event: MouseEvent) => {
      if (
        props.open() &&
        !props.menu()?.contains(event.target as Node) &&
        !props.trigger()?.contains(event.target as Node)
      ) {
        props.setOpen(false);
      }
    };
    const close = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !props.open()) return;
      event.stopPropagation();
      props.setOpen(false);
      queueMicrotask(() => props.trigger()?.focus());
    };
    document.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", close, true);
    onCleanup(() => {
      document.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", close, true);
    });
  });

  return { visibleItems };
}
