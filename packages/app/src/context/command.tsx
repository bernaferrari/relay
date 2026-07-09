/**
 * OpenCode-style command registry: every action is a command with a real keybind.
 */
import { For, Show, createEffect, createSignal, onCleanup, type JSX } from "solid-js";
import { createSimpleContext } from "@grok-device/ui/context/helper";

export type Command = {
  id: string;
  title: string;
  subtitle?: string;
  /** Parsed bind, e.g. "mod+enter", "escape", "space", "mod+1" */
  keybind?: string;
  group?: string;
  disabled?: () => boolean;
  run: () => void | Promise<void>;
};

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  return el.isContentEditable;
}

/** Match OpenCode-ish keybind strings against a KeyboardEvent. */
export function matchesKeybind(bind: string, e: KeyboardEvent): boolean {
  const parts = bind
    .toLowerCase()
    .split("+")
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return false;

  const wantMod = parts.includes("mod") || parts.includes("cmd") || parts.includes("meta");
  const wantCtrl = parts.includes("ctrl") || parts.includes("control");
  const wantAlt = parts.includes("alt") || parts.includes("option");
  const wantShift = parts.includes("shift");
  const keyPart = parts.find(
    (p) => !["mod", "cmd", "meta", "ctrl", "control", "alt", "option", "shift"].includes(p),
  );
  if (!keyPart) return false;

  const modPressed = e.metaKey || e.ctrlKey;
  if (wantMod && !modPressed) return false;
  if (wantMod) {
    /* mod means either meta or ctrl — already checked */
  } else if (wantCtrl) {
    if (!e.ctrlKey) return false;
  } else {
    if (e.metaKey || e.ctrlKey) return false;
  }
  if (wantAlt !== e.altKey) return false;
  if (wantShift !== e.shiftKey) return false;

  const k = e.key.toLowerCase();
  if (keyPart === "enter" || keyPart === "return") return k === "enter";
  if (keyPart === "escape" || keyPart === "esc") return k === "escape";
  if (keyPart === "space") return k === " " || k === "spacebar";
  if (keyPart === "up") return k === "arrowup";
  if (keyPart === "down") return k === "arrowdown";
  if (keyPart.length === 1) return k === keyPart;
  return k === keyPart;
}

/** Subsequence fuzzy match with light scoring (lower = better; -1 = no match). */
function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  let qi = 0;
  let score = 0;
  let prev = -2;
  for (let i = 0; i < text.length && qi < query.length; i++) {
    if (text[i] === query[qi]) {
      if (i === prev + 1) score -= 3;
      if (i === 0 || /[\s\-_/.]/.test(text[i - 1] ?? "")) score -= 5;
      prev = i;
      qi++;
    }
  }
  return qi === query.length ? score : -1;
}

function formatKeybind(bind: string): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform || "");
  return bind
    .split("+")
    .map((p) => {
      const x = p.trim().toLowerCase();
      if (x === "mod" || x === "cmd" || x === "meta") return isMac ? "⌘" : "Ctrl";
      if (x === "ctrl" || x === "control") return isMac ? "⌃" : "Ctrl";
      if (x === "alt" || x === "option") return isMac ? "⌥" : "Alt";
      if (x === "shift") return isMac ? "⇧" : "Shift";
      if (x === "enter" || x === "return") return "↵";
      if (x === "escape" || x === "esc") return "Esc";
      if (x === "space") return "Space";
      return x.length === 1 ? x.toUpperCase() : x;
    })
    .join(isMac ? "" : "+");
}

export const { use: useCommand, provider: CommandProvider } = createSimpleContext({
  name: "Command",
  gate: false,
  init: () => {
    const [open, setOpen] = createSignal(false);
    const [query, setQuery] = createSignal("");
    const [commands, setCommands] = createSignal<Command[]>([]);
    const [active, setActive] = createSignal(0);
    /** Surface stack: dialogs increment this so global keybinds defer to them. */
    const [modalCount, setModalCount] = createSignal(0);
    const modalOpen = () => modalCount() > 0;
    /** Register an open modal; returns a disposer to call on close. */
    function pushModal(): () => void {
      setModalCount((n) => n + 1);
      return () => setModalCount((n) => Math.max(0, n - 1));
    }

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

    const filtered = () => {
      const q = query().trim().toLowerCase();
      const all = commands().filter((c) => !c.disabled?.());
      if (!q) {
        // Cluster commands by group (first-appearance order) so a group label
        // never renders twice — registrations from different components can
        // interleave the same group name (e.g. "Device", "Jobs").
        const order: string[] = [];
        const buckets = new Map<string, Command[]>();
        for (const c of all) {
          const g = c.group ?? "";
          let bucket = buckets.get(g);
          if (!bucket) {
            bucket = [];
            buckets.set(g, bucket);
            order.push(g);
          }
          bucket.push(c);
        }
        return order.flatMap((g) => buckets.get(g)!);
      }
      const scored: { c: Command; s: number }[] = [];
      for (const c of all) {
        const hay = `${c.title} ${c.subtitle ?? ""} ${c.group ?? ""} ${c.id}`.toLowerCase();
        const s = fuzzyScore(q, hay);
        if (s >= 0) scored.push({ c, s });
      }
      scored.sort((a, b) => a.s - b.s);
      return scored.map((x) => x.c);
    };

    async function run(id: string) {
      const cmd = commands().find((c) => c.id === id);
      if (!cmd || cmd.disabled?.()) return;
      setOpen(false);
      setQuery("");
      try {
        await cmd.run();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[command]", id, err);
        window.dispatchEvent(
          new CustomEvent("specimen:toast", { detail: { text: msg, tone: "error" } }),
        );
      }
    }

    function onKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // Always: open/close palette
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery("");
        setActive(0);
        return;
      }

      if (open()) {
        if (e.key === "Escape") {
          e.preventDefault();
          setOpen(false);
          return;
        }
        const list = filtered();
        const n = list.length;
        const down =
          e.key === "ArrowDown" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "n");
        const up = e.key === "ArrowUp" || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "p");
        if (down) {
          e.preventDefault();
          if (n) setActive((i) => (i + 1) % n);
          return;
        }
        if (up) {
          e.preventDefault();
          if (n) setActive((i) => (i - 1 + n) % n);
          return;
        }
        if (e.key === "Enter") {
          e.preventDefault();
          const c = list[active()];
          if (c) void run(c.id);
          return;
        }
        return; // don't run global binds while palette open / typing in it
      }

      if (isTypingTarget(e.target)) return;
      // Modals own their keys — never dispatch global binds while one is open.
      if (modalOpen()) return;

      // Dispatch registered keybinds (first match wins). Scope the two hazardous
      // binds (escape → cancel, space → pause/resume) away from interactive
      // elements so e.g. Space on a focused button activates it instead of
      // pausing a run, and Escape on a focused control doesn't cancel a job.
      const onInteractive =
        e.target instanceof HTMLElement &&
        Boolean(
          e.target.closest('button, a, [role="option"], [role="listbox"], input, select, textarea'),
        );
      for (const c of commands()) {
        if (!c.keybind || c.disabled?.()) continue;
        if ((c.keybind === "escape" || c.keybind === "space") && onInteractive) continue;
        if (matchesKeybind(c.keybind, e)) {
          e.preventDefault();
          void run(c.id);
          return;
        }
      }
    }

    if (typeof window !== "undefined") {
      window.addEventListener("keydown", onKeyDown);
      onCleanup(() => window.removeEventListener("keydown", onKeyDown));
    }
    return {
      open,
      setOpen,
      query,
      setQuery,
      commands,
      filtered,
      active,
      setActive,
      register,
      run,
      formatKeybind,
      modalOpen,
      pushModal,
    };
  },
});

export function CommandPalette(): JSX.Element {
  const cmd = useCommand();
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (cmd.open()) {
      cmd.setActive(0);
      queueMicrotask(() => inputRef?.focus());
    }
  });

  // reset active when filter changes
  createEffect(() => {
    cmd.query();
    cmd.setActive(0);
  });

  // keep the active item in view during keyboard navigation
  createEffect(() => {
    const a = cmd.active();
    if (!cmd.open()) return;
    queueMicrotask(() =>
      listRef?.querySelector(`[data-i="${a}"]`)?.scrollIntoView({ block: "nearest" }),
    );
  });

  const filtered = cmd.filtered;
  const groupStart = (idx: number) => {
    const list = filtered();
    if (idx === 0) return true;
    return (list[idx]?.group ?? "") !== (list[idx - 1]?.group ?? "");
  };

  return (
    <div
      class="cmd-overlay"
      classList={{ "cmd-overlay--open": cmd.open() }}
      aria-hidden={!cmd.open()}
      onClick={(e) => {
        if (e.target === e.currentTarget) cmd.setOpen(false);
      }}
    >
      {/* Unmounted while closed so no phantom open dialog lingers in the
          DOM / accessibility tree (the overlay stays for the backdrop fade). */}
      <Show when={cmd.open()}>
        <div class="cmd-palette" role="dialog" aria-label="Command palette" aria-modal="true">
          <div class="cmd-palette__head">
            <input
              ref={inputRef}
              class="cmd-input"
              placeholder="Search commands, tests…"
              value={cmd.query()}
              onInput={(e) => cmd.setQuery(e.currentTarget.value)}
              autocomplete="off"
              spellcheck={false}
            />
            <Show
              when={filtered().length > 0}
              fallback={
                <div class="cmd-empty" role="presentation">
                  No matching commands
                </div>
              }
            >
              <div class="cmd-list" role="listbox" ref={listRef}>
                <For each={filtered()}>
                  {(c, i) => (
                    <>
                      <Show when={groupStart(i())}>
                        <div class="cmd-group" role="presentation">
                          {c.group ?? "Commands"}
                        </div>
                      </Show>
                      <button
                        type="button"
                        role="option"
                        class="cmd-item"
                        data-i={i()}
                        classList={{ "cmd-item--active": cmd.active() === i() }}
                        aria-selected={cmd.active() === i()}
                        onMouseMove={(e) => {
                          if (e.movementX || e.movementY) cmd.setActive(i());
                        }}
                        onClick={() => void cmd.run(c.id)}
                      >
                        <span class="cmd-item__main">
                          <span class="cmd-item__title">{c.title}</span>
                          <Show when={c.subtitle}>
                            <span class="cmd-item__sub">{c.subtitle}</span>
                          </Show>
                        </span>
                        <span class="cmd-item__meta">
                          <Show when={c.keybind}>
                            <kbd class="cmd-item__bind">{cmd.formatKeybind(c.keybind!)}</kbd>
                          </Show>
                        </span>
                      </button>
                    </>
                  )}
                </For>
              </div>
            </Show>
          </div>
          <div class="cmd-hint">
            <span>
              <kbd>↑↓</kbd> move
            </span>
            <span>
              <kbd>↵</kbd> run
            </span>
            <span>
              <kbd>esc</kbd> close
            </span>
            <span>
              <kbd>
                {typeof navigator !== "undefined" && /Mac/.test(navigator.platform) ? "⌘" : "Ctrl"}K
              </kbd>{" "}
              toggle
            </span>
          </div>
        </div>
      </Show>
    </div>
  );
}
