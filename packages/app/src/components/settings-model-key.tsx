/** @jsxImportSource react */
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@relay/ui-react/components/select";

const PROVIDERS = [
  { value: "anthropic", label: "Anthropic", placeholder: "sk-ant-…" },
  { value: "openai", label: "OpenAI", placeholder: "sk-…" },
  { value: "google", label: "Google", placeholder: "AIza…" },
  { value: "openrouter", label: "OpenRouter", placeholder: "sk-or-…" },
  { value: "openai-compatible", label: "OpenAI-compatible", placeholder: "Provider key" },
] as const;

type ProviderId = (typeof PROVIDERS)[number]["value"];

/**
 * Paste a model provider key so plain-English steps and screenshot checks can
 * run. The key is written to this computer only and never shown again.
 */
export function ModelKeyForm({
  save,
  onSaved,
}: {
  save(
    key: string,
    options?: { provider?: string; baseURL?: string },
  ): Promise<{ configured: boolean; source: string; provider?: string }>;
  onSaved?(): void;
}) {
  const [key, setKey] = useState("");
  const [provider, setProvider] = useState<ProviderId>("anthropic");
  const [baseURL, setBaseURL] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string) =>
      save(value, {
        provider,
        ...(provider === "openai-compatible" && baseURL.trim() ? { baseURL: baseURL.trim() } : {}),
      }),
    onSuccess: () => {
      setKey("");
      onSaved?.();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!mutation.isPending && key.trim()) {
      mutation.mutate(key.trim());
    }
  }
  const selected = PROVIDERS.find((item) => item.value === provider) ?? PROVIDERS[0];
  return (
    <form className="grid gap-2 pb-4" aria-label="Model key" onSubmit={submit}>
      <Label htmlFor="settings-model-provider" className="text-xs text-muted-foreground">
        Model provider
      </Label>
      <Select
        value={provider}
        onValueChange={(value) => setProvider((value ?? "anthropic") as ProviderId)}
        items={PROVIDERS.map((item) => ({ value: item.value, label: item.label }))}
      >
        <SelectTrigger id="settings-model-provider" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {PROVIDERS.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {provider === "openai-compatible" ? (
        <>
          <Label htmlFor="settings-model-base-url" className="text-xs text-muted-foreground">
            Base URL
          </Label>
          <Input
            id="settings-model-base-url"
            type="url"
            autoComplete="off"
            spellCheck={false}
            placeholder="http://localhost:11434/v1"
            value={baseURL}
            disabled={mutation.isPending}
            onChange={(event) => setBaseURL(event.currentTarget.value)}
          />
        </>
      ) : null}
      <Label htmlFor="settings-model-key" className="text-xs text-muted-foreground">
        {selected.label} key
      </Label>
      <div className="flex gap-2">
        <Input
          id="settings-model-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder={selected.placeholder}
          value={key}
          disabled={mutation.isPending}
          onChange={(event) => setKey(event.currentTarget.value)}
        />
        <Button type="submit" size="sm" disabled={!key.trim() || mutation.isPending}>
          {mutation.isPending ? "Saving…" : "Save key"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate("")}
        >
          Remove
        </Button>
      </div>
      <p className="text-xs text-muted-foreground" role="status">
        {mutation.isError
          ? mutation.error instanceof Error
            ? mutation.error.message
            : "The key could not be saved."
          : mutation.data
            ? mutation.data.configured
              ? mutation.data.source === "environment"
                ? "Removed. Relay still uses the key from its environment."
                : "Saved on this computer. Plain-English steps and checks can run now."
              : "Removed."
            : "Stored only on this computer and never shown again."}
      </p>
    </form>
  );
}
