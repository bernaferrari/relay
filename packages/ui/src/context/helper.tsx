import {
  createContext,
  createMemo,
  Show,
  useContext,
  type ParentProps,
  type Accessor,
} from "solid-js";

/**
 * Context modules may be replaced independently during Solid Fast Refresh. Keep
 * each named context's identity stable so a freshly refreshed consumer cannot
 * briefly look up a different context from its still-mounted provider.
 */
const relayContextsKey = Symbol.for("relay.ui.contexts");
type RelayContext<T> = ReturnType<typeof createContext<T | undefined>>;
type ContextRegistry = Map<string, RelayContext<unknown>>;

function relayContexts(): ContextRegistry {
  const scope = globalThis as typeof globalThis & {
    [relayContextsKey]?: ContextRegistry;
  };
  return (scope[relayContextsKey] ??= new Map());
}

export function createSimpleContext<T, Props extends Record<string, any>>(
  input: {
    name: string;
    init: ((input: Props) => T) | (() => T);
  } & (T extends { ready: unknown } ? { gate: boolean } : { gate?: boolean }),
) {
  const contexts = relayContexts();
  let ctx = contexts.get(input.name) as RelayContext<T> | undefined;
  if (!ctx) {
    ctx = createContext<T>();
    contexts.set(input.name, ctx as RelayContext<unknown>);
  }
  const context = ctx;

  return {
    provider: (props: ParentProps<Props>) => {
      const init = input.init(props);
      const gate = input.gate ?? true;

      if (!gate) {
        return <context.Provider value={init}>{props.children}</context.Provider>;
      }

      const isReady = createMemo(() => {
        // @ts-expect-error ready may not exist on T
        const ready = init.ready as Accessor<boolean> | boolean | undefined;
        return ready === undefined || (typeof ready === "function" ? ready() : ready);
      });

      return (
        <Show when={isReady()}>
          <context.Provider value={init}>{props.children}</context.Provider>
        </Show>
      );
    },
    use() {
      const value = useContext(context);
      if (!value) throw new Error(`${input.name} context must be used within a context provider`);
      return value;
    },
  };
}
