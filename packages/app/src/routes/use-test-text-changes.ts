import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import type { ProductTestEditorDocument } from "../data/test-editor-product-service";
import type { ProductTestTextAction } from "../data/test-text-actions";
import type { LiveTestEditorSession } from "../data/live-test-editor-product-service";
import { collectStepEntries } from "./test-editor-route-helpers";
import type { useTestStepDrafts } from "./use-test-step-drafts";

export function useTestTextChanges({
  currentDocument,
  currentLiveEditor,
  saveDocument,
  setSaveNotice,
  acknowledgeTextDraft,
}: {
  currentDocument(): ProductTestEditorDocument | undefined;
  currentLiveEditor(): LiveTestEditorSession | undefined;
  saveDocument(next: ProductTestEditorDocument | LiveTestEditorSession): void;
  setSaveNotice(notice: string): void;
  acknowledgeTextDraft: ReturnType<typeof useTestStepDrafts>["acknowledgeTextDraft"];
}) {
  const { testEditorService, queryClient } = useRouteContext({ from: "__root__" });
  return useMutation({
    mutationFn: async (input: { stepId: string; action: ProductTestTextAction; text: string }) => {
      const document = currentDocument();
      if (!document || !testEditorService.saveText)
        throw new TypeError("Text editing is unavailable. Reload this Test.");
      return testEditorService.saveText({ document, ...input });
    },
    onMutate: () => setSaveNotice("Saving…"),
    onSuccess: (next, input) => {
      const live = currentLiveEditor();
      saveDocument(live ? { ...live, test: next } : next);
      const step = collectStepEntries(next.test.steps).find(
        (entry) => entry.step.id === input.stepId,
      )?.step;
      if (step) acknowledgeTextDraft(step, input.action.key, input.text);
      setSaveNotice("Saved · run to check changed text");
      void queryClient.invalidateQueries({ queryKey: ["test-editor"], refetchType: "inactive" });
    },
    onError: () => setSaveNotice("Could not save text; your draft is preserved"),
  });
}
