import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import type { ProductTestEditorDocument } from "../data/test-editor-product-service";
import type { ProductTestTextAction } from "../data/test-text-actions";
import { collectStepEntries } from "./test-editor-route-helpers";
import type { useTestStepDrafts } from "./use-test-step-drafts";

export function useTestTextChanges({
  currentDocument,
  saveDocument,
  setSaveNotice,
  acknowledgeTextDraft,
}: {
  currentDocument(): ProductTestEditorDocument | undefined;
  saveDocument(next: ProductTestEditorDocument): void;
  setSaveNotice(notice: string): void;
  acknowledgeTextDraft: ReturnType<typeof useTestStepDrafts>["acknowledgeTextDraft"];
}) {
  const { testEditorService, queryClient } = useRouteContext({ from: "__root__" });
  return useMutation({
    mutationFn: async (input: { stepId: string; action: ProductTestTextAction; text: string }) => {
      const document = currentDocument();
      if (!document || !testEditorService.saveText)
        throw new TypeError("Text editing is unavailable. Reload this test.");
      return testEditorService.saveText({ document, ...input });
    },
    onMutate: () => setSaveNotice("Saving…"),
    onSuccess: (next, input) => {
      saveDocument(next);
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
