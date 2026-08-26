import { Suspense } from "solid-js";
import { cn } from "../lib/cn";
import { modalPanel, modalScrim } from "../lib/ui";
import { WorkspaceSkeleton } from "./workspace-skeleton";
import { DataWorkspace } from "./studio-shell-workspaces";

/** Centered Variables workspace dialog launched from the map properties panel. */
export function StudioShellVariablesDialog(props: {
  /** The shell traps focus in whatever element this reports. */
  ref: (element: HTMLElement) => void;
  onClose: () => void;
  onConfigureProvider: () => void;
}) {
  return (
    <div
      class={cn(modalScrim, "z-[var(--z-modal-nested)] flex items-center justify-center p-5")}
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) props.onClose();
      }}
    >
      <section
        ref={props.ref}
        class={cn(modalPanel, "h-[min(82vh,760px)] w-[min(100%,980px)] outline-none")}
        role="dialog"
        aria-modal="true"
        aria-label="Variables"
        tabindex={-1}
      >
        <Suspense fallback={<WorkspaceSkeleton label="variables" />}>
          <DataWorkspace
            embedded
            onClose={props.onClose}
            onConfigureProvider={props.onConfigureProvider}
          />
        </Suspense>
      </section>
    </div>
  );
}
