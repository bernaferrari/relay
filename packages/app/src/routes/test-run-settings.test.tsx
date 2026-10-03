/** @jsxImportSource react */
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TestRunSettings } from "./test-run-settings";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  document.body.replaceChildren();
});

it("keeps a newly recorded browser in discovery while cached destinations refresh", async () => {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const browser = (targetId: string) => ({
    targetId,
    kind: "browser" as const,
    platform: "browser" as const,
    name: targetId,
    detail: "Managed browser",
  });
  const props = {
    testId: "test-1",
    activeRun: false,
    targetId: "new-browser",
    recordedPlatforms: ["browser"] as const,
    targets: {
      data: [browser("previous-browser")],
      isPending: false,
      isError: false,
      isFetching: true,
    },
    profiles: { data: [] },
    builds: { data: [] },
    pairedCount: 0,
    canStart: false,
    editorState: "saved" as const,
    configuration: {
      selection: { targetId: "new-browser" },
      targetUnavailable: true,
      loading: false,
      saving: false,
      restored: false,
      edited: true,
      pristine: false,
      setSelection: vi.fn(),
      retry: vi.fn(),
      error: undefined,
    },
    onRetryScope: vi.fn(),
    startPending: false,
    onStart: vi.fn(),
  } satisfies ComponentProps<typeof TestRunSettings>;
  await act(async () => root!.render(<TestRunSettings {...props} />));
  expect(host.textContent).not.toContain("Saved target is unavailable");
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Finding browsers");

  await act(async () =>
    root!.render(
      <TestRunSettings
        {...props}
        targets={{ ...props.targets, data: [browser("new-browser")], isFetching: false }}
        configuration={{ ...props.configuration, targetUnavailable: false }}
        canStart
      />,
    ),
  );
  expect(host.textContent).toContain("new-browser");
  expect(
    [...host.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Run now",
    )?.disabled,
  ).toBe(false);

  await act(async () =>
    root!.render(<TestRunSettings {...props} targets={{ ...props.targets, isFetching: false }} />),
  );
  expect(host.textContent).toContain("Saved target is unavailable");
});
