/** @jsxImportSource react */
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { Button } from "@relay/ui-react/components/button";
import { productClientForPlatform } from "../data/product-client";

import { MAX_FIXTURE_BYTES } from "@relay/protocol";
export async function fixtureBase64(file: File): Promise<string> {
  if (!file.size || file.size > MAX_FIXTURE_BYTES)
    throw new Error("Choose a non-empty file up to 25 MiB.");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read that file. Choose it again."));
    reader.onload = () => {
      if (typeof reader.result !== "string" || !reader.result.includes(",")) {
        reject(new Error("Could not read that file."));
        return;
      }
      resolve(reader.result.slice(reader.result.indexOf(",") + 1));
    };
    reader.readAsDataURL(file);
  });
}

export function ManagedFixturePicker({
  value,
  onChange,
}: {
  value: string;
  onChange(file: string): void;
}) {
  const { platform } = useRouteContext({ from: "__root__" });
  const [open, setOpen] = useState(false);
  const fixtures = useQuery({
    queryKey: ["managed-fixtures"],
    enabled: open,
    queryFn: async () => {
      const { client } = await productClientForPlatform(platform);
      return (await client.invoke("fixture.list", {})).fixtures;
    },
  });
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const base64 = await fixtureBase64(file);
      const { client } = await productClientForPlatform(platform);
      return client.invoke("fixture.import", { name: file.name, base64 });
    },
    onSuccess: async ({ fixture }) => {
      onChange(fixture.file);
      await fixtures.refetch();
    },
  });
  return (
    <div className="grid gap-2">
      <Button type="button" variant="outline" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Close file picker" : "Choose or import a file"}
      </Button>
      {open ? (
        <>
          <label>
            Saved file
            <select
              aria-label="Saved upload file"
              value={value}
              disabled={upload.isPending}
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              onChange={(event) => onChange(event.currentTarget.value)}
            >
              <option value="">Choose a file</option>
              {value && !fixtures.data?.some((file) => file.file === value) ? (
                <option value={value}>Current file</option>
              ) : null}
              {fixtures.data?.map((file) => (
                <option key={file.file} value={file.file}>
                  {file.name} · {Math.ceil(file.size / 1024)} KiB
                </option>
              ))}
            </select>
          </label>
          <label>
            Import image, video, or file
            <input
              type="file"
              aria-label="Import upload fixture"
              disabled={upload.isPending}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) upload.mutate(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Up to 25 MiB. Relay keeps a project copy for future runs.
          </p>
          {fixtures.isPending ? <p role="status">Loading files…</p> : null}
          {upload.isPending ? <p role="status">Importing file…</p> : null}
          {fixtures.isError ? (
            <Button type="button" variant="ghost" onClick={() => void fixtures.refetch()}>
              Retry loading files
            </Button>
          ) : null}
          {upload.error || fixtures.error ? (
            <p role="alert" className="text-destructive">
              {(upload.error ?? fixtures.error)?.message}
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
