import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SelectField } from "./filter-select";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("shows a choice prompt for an unavailable saved value without replacing it", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const changed = vi.fn();
  const render = (available: boolean) =>
    act(async () =>
      root.render(
        <SelectField
          label="Device or browser"
          value="browser-saved-id"
          options={[
            { value: "other", label: "Other browser" },
            ...(available ? [{ value: "browser-saved-id", label: "QA browser" }] : []),
          ]}
          placeholder="Choose a device"
          onValueChange={changed}
        />,
      ),
    );
  try {
    await render(false);
    expect(host.textContent).toContain("Choose a device");
    expect(host.textContent).not.toContain("browser-saved-id");
    expect(changed).not.toHaveBeenCalled();
    await render(true);
    expect(host.textContent).toContain("QA browser");
    expect(host.querySelector<HTMLLabelElement>("label")?.control).toBe(
      host.querySelector('[role="combobox"]'),
    );
    expect(changed).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
