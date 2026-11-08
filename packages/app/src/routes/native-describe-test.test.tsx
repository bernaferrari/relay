import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { NativeDescribeTest } from "./native-describe-test";
const mocks = vi.hoisted(() => ({
  draftSteps: vi.fn(),
  createDraft: vi.fn(),
  navigate: vi.fn(),
  context: {} as Record<string, unknown>,
}));
vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => mocks.context,
  useNavigate: () => mocks.navigate,
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
afterEach(() => {
  act(() => root?.unmount());
  document.body.replaceChildren();
  vi.clearAllMocks();
});
async function render(originApplication = "ai.x.grok") {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  mocks.context = {
    testEditorService: { draftSteps: mocks.draftSteps, createDraft: mocks.createDraft },
    queryClient: client,
  };
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <NativeDescribeTest appId="grok" originApplication={originApplication} />
      </QueryClientProvider>,
    ),
  );
  const input = document.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      input,
      "Send a message and check the reply",
    );
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return document.querySelector("button")!;
}
it("creates a native draft with its application and check steps without starting a recording", async () => {
  const steps = [
    { kind: "instruction", intent: "Send message" },
    { kind: "validation", intent: "Reply appears" },
  ];
  mocks.draftSteps.mockResolvedValue({ name: "Reply", steps });
  mocks.createDraft.mockResolvedValue({ test: { id: "saved" } });
  const button = await render();
  await act(async () => button.click());
  await vi.waitFor(() =>
    expect(mocks.createDraft).toHaveBeenCalledWith(
      expect.objectContaining({ appMapId: "grok", originApplication: "ai.x.grok", steps }),
    ),
  );
  expect(mocks.navigate).toHaveBeenCalledWith({
    to: "/tests/$testId",
    params: { testId: "saved" },
  });
});
it("requires an application before creating a native draft", async () => {
  const button = await render("");
  expect(button.disabled).toBe(true);
  expect(mocks.createDraft).not.toHaveBeenCalled();
});
it("shows drafting failures without creating a partial test", async () => {
  mocks.draftSteps.mockRejectedValue(new Error("Model unavailable"));
  const button = await render();
  await act(async () => button.click());
  await vi.waitFor(() =>
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Model unavailable"),
  );
  expect(mocks.createDraft).not.toHaveBeenCalled();
});
