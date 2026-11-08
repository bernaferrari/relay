import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { ManagedFixturePicker, fixtureBase64 } from "./managed-fixture-picker";
const relay = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useRouteContext: () => ({ platform: {} }) }));
vi.mock("../data/product-client", () => ({
  productClientForPlatform: async () => ({ client: relay }),
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.resetAllMocks();
});
async function render() {
  const onChange = vi.fn();
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <ManagedFixturePicker value="" onChange={onChange} />
      </QueryClientProvider>,
    ),
  );
  return onChange;
}
it("lists managed fixtures only when opened and selects their portable reference", async () => {
  relay.invoke.mockResolvedValue({
    fixtures: [{ file: "fixture:hash/sample.txt", name: "sample.txt", size: 3 }],
  });
  const onChange = await render();
  expect(relay.invoke).not.toHaveBeenCalled();
  await act(async () => document.querySelector("button")!.click());
  await vi.waitFor(() => expect(document.body.textContent).toContain("sample.txt"));
  const select = document.querySelector("select")!;
  await act(async () => {
    select.value = "fixture:hash/sample.txt";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(onChange).toHaveBeenCalledWith("fixture:hash/sample.txt");
});
it("imports file bytes and chooses the server-owned fixture reference", async () => {
  relay.invoke.mockImplementation(async (id) =>
    id === "fixture.list"
      ? { fixtures: [] }
      : { fixture: { file: "fixture:hash/sample.txt", name: "sample.txt", size: 3 } },
  );
  const onChange = await render();
  await act(async () => document.querySelector("button")!.click());
  const input = document.querySelector('input[type="file"]')!;
  Object.defineProperty(input, "files", { value: [new File(["abc"], "sample.txt")] });
  await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
  await vi.waitFor(() => expect(onChange).toHaveBeenCalledWith("fixture:hash/sample.txt"));
  expect(relay.invoke).toHaveBeenCalledWith("fixture.import", {
    name: "sample.txt",
    base64: "YWJj",
  });
});
it("rejects oversized files before reading or sending their bytes", async () => {
  const file = new File(["a"], "huge.mp4");
  Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 + 1 });
  await expect(fixtureBase64(file)).rejects.toThrow("25 MiB");
  expect(relay.invoke).not.toHaveBeenCalled();
});
