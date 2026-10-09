/** @jsxImportSource react */
import { useState, type FormEvent } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";

/**
 * Paste an OpenRouter key so plain-English steps and screenshot checks can
 * run. The key is written to this computer only and never shown again.
 */
export function ModelKeyForm({
  save,
  onSaved,
}: {
  save(key: string): Promise<{ configured: boolean; source: string }>;
  onSaved?(): void;
}) {
  const [key, setKey] = useState("");
  const mutation = useMutation({
    mutationFn: (value: string) => save(value),
    onSuccess: () => {
      setKey("");
      onSaved?.();
    },
  });
  function submit(event: FormEvent) {
    event.preventDefault();
    if (key.trim() && !mutation.isPending) mutation.mutate(key.trim());
  }
  return (
    <form className="grid gap-2 pb-4" aria-label="Model key" onSubmit={submit}>
      <Label htmlFor="settings-model-key" className="text-xs text-muted-foreground">
        OpenRouter key
      </Label>
      <div className="flex gap-2">
        <Input
          id="settings-model-key"
          type="password"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-or-…"
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
