import { useLayoutEffect, useRef, useState } from "react";
import type { LiveTargetInput } from "../data/live-target-session";

type Queue = { inputs: LiveTargetInput[]; active: boolean; stopped: boolean };
const freshQueue = (): Queue => ({ inputs: [], active: false, stopped: false });
const recoverText = (inputs: LiveTargetInput[]) =>
  inputs
    .map((input) =>
      "text" in input
        ? (input.text ?? "")
        : input.kind === "key"
          ? input.key === "enter"
            ? "\n"
            : `[${input.key}]`
          : "",
    )
    .join("");

/** Buffer intended keys, never retry an uncertain mutation, and never carry
 * pending text into a different preview session. Clicks remain fenced by busy. */
export function useLiveKeyboardQueue({
  enabled,
  busy,
  scope,
  send,
}: {
  enabled: boolean;
  busy: boolean;
  scope: string;
  send(input: LiveTargetInput): Promise<boolean>;
}) {
  const queue = useRef(freshQueue());
  const paused = useRef(false);
  const latest = useRef({ enabled, busy, send });
  latest.current = { enabled, busy, send };
  const [recovery, setRecovery] = useState<string>();
  const interrupt = (current: Queue, inputs: LiveTargetInput[]) => {
    current.stopped = true;
    current.inputs = [];
    if (inputs.length) {
      paused.current = true;
      setRecovery(recoverText(inputs));
    }
  };
  async function drain() {
    const current = queue.current;
    if (current.active || current.stopped || paused.current) return;
    current.active = true;
    try {
      while (
        current === queue.current &&
        !current.stopped &&
        current.inputs.length &&
        latest.current.enabled &&
        !latest.current.busy
      ) {
        const input = current.inputs.shift()!;
        let delivered = false;
        try {
          delivered = await latest.current.send(input);
        } catch {
          /* Preserve text for explicit human recovery. */
        }
        if (current !== queue.current) return;
        if (!delivered) {
          interrupt(current, [input, ...current.inputs]);
          return;
        }
      }
    } finally {
      current.active = false;
    }
  }
  useLayoutEffect(() => {
    const previous = queue.current;
    interrupt(previous, previous.inputs);
    const current = freshQueue();
    queue.current = current;
    return () => {
      current.stopped = true;
    };
  }, [scope, enabled]);
  useLayoutEffect(() => {
    if (enabled && !busy) void drain();
  });
  return {
    enqueue(input: LiveTargetInput) {
      const current = queue.current;
      if (!enabled || current.stopped || paused.current) return;
      if (current.inputs.length >= 256) {
        interrupt(current, [...current.inputs, input]);
        return;
      }
      current.inputs.push(input);
      void drain();
    },
    recovery,
    clearRecovery() {
      paused.current = false;
      setRecovery(undefined);
      queue.current.stopped = false;
    },
  };
}
