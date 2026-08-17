import { cn } from "../lib/cn";

export type AuthoringSurface = "test" | "map";

export function AuthoringSurfaceSwitch(props: {
  value: AuthoringSurface;
  onChange: (value: AuthoringSurface) => void;
}) {
  return (
    <div
      class="flex h-9 items-center rounded-lg border border-[var(--border-weak-base)] bg-[var(--surface-base)] p-0.5"
      role="group"
      aria-label="Authoring surface"
    >
      {(["test", "map"] as const).map((surface) => (
        <button
          type="button"
          class={cn(
            "min-h-8 rounded-md px-3 text-caption font-medium transition-[background-color,color,box-shadow] active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-[var(--border-strong-focus)]",
            props.value === surface
              ? "bg-[var(--surface-raised-stronger-non-alpha)] text-[var(--text-strong)] shadow-sm"
              : "text-[var(--text-weak)] hover:text-[var(--text-base)]",
          )}
          aria-pressed={props.value === surface}
          onClick={() => props.onChange(surface)}
        >
          {surface === "test" ? "Test" : "Canvas"}
        </button>
      ))}
    </div>
  );
}
