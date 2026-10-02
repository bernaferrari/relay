import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { RecordingWaitConditions } from "./recording-wait-conditions";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const action = {
  id: "wait-1",
  intent: "Wait for result · Copy message",
  waitConditions: [
    {
      kind: "expect" as const,
      condition: "gone" as const,
      target: { label: "Stop message" },
      timeoutMs: 300_000,
    },
    {
      kind: "wait-for" as const,
      condition: "visible" as const,
      target: { identifier: "response.copy" },
      timeoutMs: 300_000,
    },
  ],
};

async function setInput(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

it("shows exact ordered readiness conditions and edits targets and budgets through replace", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onEdit = vi.fn();
  try {
    await act(async () =>
      root.render(<RecordingWaitConditions action={action} canEdit onEdit={onEdit} />),
    );
    expect(host.textContent).toContain("Stop message disappears");
    expect(host.textContent).toContain("response.copy appears");
    expect(host.textContent).toContain("up to 5 min");
    expect(host.textContent).not.toContain("succeeded");
    await act(async () => host.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const inputs = dialog.querySelectorAll<HTMLInputElement>("label > input");
    await setInput(inputs[0]!, "Stop response");
    await setInput(inputs[1]!, "90");
    await setInput(inputs[2]!, "response.download");
    await setInput(inputs[3]!, "120");
    await act(async () =>
      dialog
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onEdit).toHaveBeenCalledExactlyOnceWith({
      kind: "replace",
      actionId: "wait-1",
      interaction: {
        kind: "steps",
        label: action.intent,
        steps: [
          {
            kind: "expect",
            condition: "gone",
            target: { label: "Stop response" },
            timeoutMs: 90_000,
          },
          { kind: "wait-for", target: { identifier: "response.download" }, timeoutMs: 120_000 },
        ],
      },
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("empty controls and invalid budgets cannot replace executable waits", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onEdit = vi.fn();
  try {
    await act(async () =>
      root.render(<RecordingWaitConditions action={action} canEdit onEdit={onEdit} />),
    );
    await act(async () => host.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!,
      form = dialog.querySelector("form")!;
    const inputs = dialog.querySelectorAll<HTMLInputElement>("label > input");
    await setInput(inputs[0]!, " ");
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onEdit).not.toHaveBeenCalled();
    await setInput(inputs[0]!, "Stop response");
    await setInput(inputs[1]!, "901");
    await act(async () =>
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onEdit).not.toHaveBeenCalled();
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("default budgets remain omitted and refreshed conditions replace unsaved editor state", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onEdit = vi.fn();
  try {
    await act(async () =>
      root.render(<RecordingWaitConditions action={action} canEdit onEdit={onEdit} />),
    );
    await act(async () => host.querySelector("button")!.click());
    const next = {
      ...action,
      waitConditions: [
        { kind: "wait-for" as const, condition: "visible" as const, target: { label: "Done" } },
      ],
    };
    await act(async () =>
      root.render(<RecordingWaitConditions action={next} canEdit onEdit={onEdit} />),
    );
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.querySelector<HTMLInputElement>("label > input")!.value).toBe("Done");
    await act(async () =>
      dialog
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })),
    );
    expect(onEdit).toHaveBeenCalledWith({
      kind: "replace",
      actionId: action.id,
      interaction: {
        kind: "steps",
        label: action.intent,
        steps: [{ kind: "wait-for", target: { label: "Done" } }],
      },
    });
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("unsupported actions show no editor and pending transitions disable editing", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onEdit = vi.fn();
  try {
    await act(async () =>
      root.render(
        <RecordingWaitConditions
          action={{ id: "mixed", intent: "Tap and wait" }}
          canEdit
          onEdit={onEdit}
        />,
      ),
    );
    expect(host.textContent).toBe("");
    await act(async () =>
      root.render(<RecordingWaitConditions action={action} canEdit={false} onEdit={onEdit} />),
    );
    expect(host.querySelector<HTMLButtonElement>("button")!.disabled).toBe(true);
    expect(onEdit).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});

it("awaited wait save fences duplicates and dismissal, retains failed draft, then closes on success", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host),
    onEdit = vi.fn();
  let rejectSave: (error: Error) => void = () => undefined;
  const firstSave = new Promise<void>((_resolve, reject) => {
    rejectSave = reject;
  });
  const onSaveWait = vi
    .fn()
    .mockImplementationOnce(() => firstSave)
    .mockResolvedValueOnce(undefined);
  try {
    await act(async () =>
      root.render(
        <RecordingWaitConditions action={action} canEdit onEdit={onEdit} onSaveWait={onSaveWait} />,
      ),
    );
    await act(async () => host.querySelector("button")!.click());
    const dialog = document.querySelector('[role="dialog"]')!;
    const field = dialog.querySelector<HTMLInputElement>("label > input")!;
    await setInput(field, "Stop response");
    const submit = () =>
      dialog
        .querySelector("form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    await act(async () => {
      submit();
      submit();
    });
    expect(onSaveWait).toHaveBeenCalledTimes(1);
    expect(onEdit).not.toHaveBeenCalled();
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(true);
    expect(
      [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Cancel")!
        .disabled,
    ).toBe(true);
    await act(async () =>
      dialog.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await act(async () => rejectSave(new Error("Canonical recording revision changed")));
    expect(dialog.querySelector('[role="alert"]')!.textContent).toContain(
      "Your changes are still here",
    );
    expect(field.value).toBe("Stop response");
    expect(dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!.disabled).toBe(false);
    await act(async () => {
      submit();
    });
    expect(onSaveWait).toHaveBeenCalledTimes(2);
    expect(onSaveWait.mock.calls[1]![0].interaction.steps[0].target.label).toBe("Stop response");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
