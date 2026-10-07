import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type {
  ProductTestEditorDocument,
  TestEditorProductService,
} from "./test-editor-product-service";
import { textParameterNames } from "./test-text-actions";
import type { TestData } from "@relay/protocol";

export type TestTextInput = {
  name: string;
  value: string;
  definition?: TestData;
  required: boolean;
};

/** Only text parameters in the visible saved Test are offered as run overrides. */
export function useTestTextInputs(
  document: ProductTestEditorDocument | undefined,
  service: TestEditorProductService,
) {
  const names = useMemo(
    () => [
      ...new Set(
        Object.values(document?.textActions ?? {})
          .flat()
          .flatMap((action) => textParameterNames(action.text)),
      ),
    ],
    [document],
  );
  const definitions = useQuery({
    queryKey: ["test-text-parameters"],
    queryFn: () => service.listTextParameters!(),
    enabled: names.length > 0 && Boolean(service.listTextParameters),
  });
  const key = `${document?.appMapId}:${document?.test.id}`;
  const [draft, setDraft] = useState<{ key: string; values: Record<string, string> }>({
    key,
    values: {},
  });
  const inputs: TestTextInput[] = names.map((name) => {
    const definition = definitions.data?.find((item) => item.name === name || item.id === name);
    const saved =
      definition?.scope === "shared" && !definition.sensitive && definition.source !== "generated"
        ? (definition.values?.find((value) => value.trim()) ?? definition.fallback)
        : undefined;
    const value = (draft.key === key ? draft.values[name] : undefined) ?? saved ?? "";
    const required = Boolean(
      definition &&
      (definition.scope === "private" ||
        (!definition.values?.some((item) => item.trim()) &&
          !definition.fallback?.trim() &&
          definition.source !== "generated")),
    );
    return { name, value, definition, required };
  });
  const variables = Object.fromEntries(
    inputs.filter((input) => input.value.trim()).map((input) => [input.name, input.value]),
  );
  return {
    inputs,
    variables,
    ready:
      !definitions.isLoading &&
      inputs.every((input) => !input.required || Boolean(input.value.trim())),
    loading: definitions.isLoading,
    error: definitions.error,
    retry: () => void definitions.refetch(),
    setValue: (name: string, value: string) =>
      setDraft((current) => ({
        key,
        values: { ...(current.key === key ? current.values : {}), [name]: value },
      })),
  };
}
