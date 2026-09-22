import { act, useState } from "react";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
  Link,
} from "@tanstack/react-router";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TestEditorDoneButton } from "./test-editor-done-button";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
});
function button(label: string) {
  const element = [...document.querySelectorAll("button")].find(
    (item) => item.textContent === label,
  );
  if (!element) throw new Error(`Missing ${label}`);
  return element;
}
let history: ReturnType<typeof createMemoryHistory>;
let setProps: (props: Parameters<typeof TestEditorDoneButton>[0]) => void;
async function render(props: Parameters<typeof TestEditorDoneButton>[0]) {
  if (!root) {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    history = createMemoryHistory({ initialEntries: ["/tests"] });
    const parent = createRootRoute({ component: Outlet });
    const editor = createRoute({
      getParentRoute: () => parent,
      path: "/tests",
      component: function Editor() {
        const [currentProps, updateProps] = useState(props);
        setProps = updateProps;
        return (
          <>
            <TestEditorDoneButton
              {...currentProps}
              onLeave={() => {
                currentProps.onLeave();
                void router.navigate({ to: "/runs" });
              }}
            />
            <Link to="/runs">Results</Link>
          </>
        );
      },
    });
    const results = createRoute({
      getParentRoute: () => parent,
      path: "/runs",
      component: () => <p>Results page</p>,
    });
    const router = createRouter({ routeTree: parent.addChildren([editor, results]), history });
    await act(async () => root.render(<RouterProvider router={router} />));
  } else await act(async () => setProps(props));
  for (let i = 0; i < 3; i++)
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}
it("requires an explicit choice before leaving an unsaved checkpoint and blocks pending saves", async () => {
  const onLeave = vi.fn();
  const props = { onLeave, saving: false, hasUnsavedChanges: true, hasUnsavedCheckpoint: true };
  await render(props);
  await act(async () => document.querySelector<HTMLAnchorElement>("a")!.click());
  expect(history.location.pathname).toBe("/tests");
  expect(document.body.textContent).toContain("new screenshot checkpoint will be discarded");
  await act(async () => button("Keep editing").click());
  expect(history.location.pathname).toBe("/tests");
  await act(async () => button("Done editing").click());
  await render({ ...props, saving: true });
  expect(button("Leave without saving").disabled).toBe(true);
  await act(async () => button("Leave without saving").click());
  expect(history.location.pathname).toBe("/tests");
  await render(props);
  await act(async () => button("Leave without saving").click());
  expect(history.location.pathname).toBe("/runs");
});
