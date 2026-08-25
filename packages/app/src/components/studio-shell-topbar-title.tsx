import { Show } from "solid-js";
import { shellTopbarTitle } from "../lib/shell-layout";
import { displayTitle } from "../lib/job";

/** The left edge of the shell header: an editable map name in Tests, a static
 * label elsewhere. Kept out of studio-shell so the rename affordance's own
 * escape/commit behaviour lives next to the field it belongs to. */
export function ShellTopbarTitle(props: {
  area: "maps" | "runs";
  name: string;
  disabled: boolean;
  onNameInput: (value: string) => void;
  onCommit: (name: string) => void;
}) {
  let titleBeforeEdit = "";
  const shown = () => displayTitle(props.name);

  return (
    <div class={shellTopbarTitle}>
      <Show
        when={props.area === "maps"}
        fallback={
          props.area === "runs" ? (
            <strong class="max-w-full truncate px-2 text-body font-medium text-[var(--text-base)]">
              Run history
            </strong>
          ) : null
        }
      >
        <input
          type="text"
          size={Math.max(12, Math.min(34, shown().length + 1))}
          class="h-8 max-w-full min-w-[120px] cursor-text bg-transparent px-2 font-medium text-[var(--text-base)] outline-none transition-[box-shadow,color] duration-hover placeholder:text-[var(--text-weak)] hover:text-[var(--text-strong)] focus:text-[var(--text-strong)] focus:shadow-[inset_0_-1px_0_var(--border-strong-base)] max-[680px]:min-w-0"
          aria-label="Map name"
          data-focus-contained
          data-tip="Rename map"
          value={shown()}
          placeholder="My map"
          spellcheck={false}
          disabled={props.disabled}
          onFocus={() => {
            titleBeforeEdit = props.name;
          }}
          onInput={(event) => props.onNameInput(event.currentTarget.value)}
          onBlur={() => props.onCommit(props.name.trim() || "My map")}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              props.onNameInput(titleBeforeEdit);
              event.currentTarget.blur();
            }
          }}
        />
      </Show>
    </div>
  );
}
