import { render } from "solid-js/web";
import { expect, test, vi } from "vitest";
import { FirstOperatorRunCard } from "./first-operator-run";

test("first operator run names honest device state and bind/run actions", () => {
  const root = document.createElement("div");
  document.body.append(root);
  const onAction = vi.fn();
  const onDismiss = vi.fn();
  const dispose = render(
    () => (
      <FirstOperatorRunCard
        stage="bind"
        title="Bind a Combine cell"
        detail="Language × Settings tour has selected cells with no runtime profile."
        actionLabel="Open Combine"
        deviceLabel="Pixel 9 is ready"
        deviceDetail="Relay can now record or run an explicitly chosen Test on this Device."
        onAction={onAction}
        onDismiss={onDismiss}
      />
    ),
    root,
  );
  expect(root.textContent).toContain("First operator run");
  expect(root.textContent).toContain("Pixel 9 is ready");
  expect(root.textContent).toContain("no runtime profile");
  expect(root.querySelector("[data-first-operator-run='bind']")).toBeTruthy();
  const open = [...root.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("Open Combine"),
  );
  open?.click();
  expect(onAction).toHaveBeenCalledTimes(1);
  expect(onDismiss).not.toHaveBeenCalled();
  dispose();
});
