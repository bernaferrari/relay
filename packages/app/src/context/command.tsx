import { createSignal, onCleanup, type JSX } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";

export type Command = {
  id: string;
  title: string;
  subtitle?: string;
  keybind?: string;
  group?: string;
  run: () => void | Promise<void>;
};

export const { use: useCommand, provider: CommandProvider } = createSimpleContext({
  name: "Command",
  gate: false,
  init: () => {
    const [open, setOpen] = createSignal(false);
    const [query, setQuery] = createSignal("");
    const [commands, setCommands] = createSignal<Command[]>([]);

    function register(cmds: Command[]) {
      setCommands((prev) => {
        const map = new Map(prev.map((c) => [c.id, c]));
        for (const c of cmds) map.set(c.id, c);
        return [...map.values()];
      });
      return () => {
        setCommands((prev) => prev.filter((c) => !cmds.some((x) => x.id === c.id)));
      };
    }

    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
      }
      if (e.key === "Escape" && open()) {
        e.preventDefault();
        setOpen(false);
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", onKeyDown);
      onCleanup(() => window.removeEventListener("keydown", onKeyDown));
    }

    const filtered = () => {
      const q = query().trim().toLowerCase();
      const all = commands();
      if (!q) return all;
      return all.filter(
        (c) =>
          c.id.toLowerCase().includes(q) ||
          c.title.toLowerCase().includes(q) ||
          (c.subtitle?.toLowerCase().includes(q) ?? false) ||
          (c.group?.toLowerCase().includes(q) ?? false),
      );
    };

    async function run(id: string) {
      const cmd = commands().find((c) => c.id === id);
      if (!cmd) return;
      setOpen(false);
      await cmd.run();
    }

    return {
      open,
      setOpen,
      query,
      setQuery,
      commands,
      filtered,
      register,
      run,
    };
  },
});

export function CommandPalette(): JSX.Element {
  const cmd = useCommand();
  return (
    <div
      class="cmd-overlay"
      classList={{ "cmd-overlay--open": cmd.open() }}
      onClick={(e) => {
        if (e.target === e.currentTarget) cmd.setOpen(false);
      }}
    >
      <div class="cmd-palette" role="dialog" aria-label="Command palette">
        <input
          class="cmd-input"
          placeholder="Type a command…"
          value={cmd.query()}
          onInput={(e) => cmd.setQuery(e.currentTarget.value)}
          autofocus
        />
        <div class="cmd-list">
          {cmd.filtered().map((c) => (
            <button type="button" class="cmd-item" onClick={() => void cmd.run(c.id)}>
              <span class="cmd-item__title">{c.title}</span>
              <span class="cmd-item__meta">
                {c.group}
                {c.keybind ? ` · ${c.keybind}` : ""}
              </span>
            </button>
          ))}
          {cmd.filtered().length === 0 ? <div class="cmd-empty">No matching commands</div> : null}
        </div>
        <div class="cmd-hint">⌘K / Ctrl+K · Esc to close</div>
      </div>
    </div>
  );
}
