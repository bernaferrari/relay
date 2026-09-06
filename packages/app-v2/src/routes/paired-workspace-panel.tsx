/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type {
  ProductBrowserAuthFixture,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";
import {
  openPairedWorkspaceInLive,
  pairedWorkspaceSummary,
  type PairedConfigurationRow,
  type PairedConfigurationWorkspace,
} from "../data/paired-configuration";

export function PairedWorkspacePanel({
  workspace,
  spaces,
  accountsByBrowser,
  onSave,
  onOpenLive,
}: {
  workspace: PairedConfigurationWorkspace;
  spaces: readonly ProductBrowserSpace[];
  accountsByBrowser: Readonly<Record<string, readonly ProductBrowserAuthFixture[]>>;
  onSave: (workspace: PairedConfigurationWorkspace) => Promise<void>;
  onOpenLive: (plan: {
    browserId: string;
    accountId?: string;
    accountRevision?: string;
    accountReference?: string;
    signedOut?: true;
  }) => Promise<unknown>;
}) {
  const [name, setName] = useState("");
  const [browserId, setBrowserId] = useState(spaces[0]?.id ?? "");
  const [accountId, setAccountId] = useState("");
  const selected = spaces.find((space) => space.id === browserId);
  const accounts = accountsByBrowser[browserId] ?? [];

  const saveRow = useMutation({
    mutationFn: async () => {
      if (!selected || !name.trim()) throw new TypeError("Name this pair and choose a Browser.");
      const account = accounts.find((item) => item.id === accountId);
      const row: PairedConfigurationRow = {
        id: `row-${Date.now()}`,
        name: name.trim(),
        browserId: selected.id,
        browserName: selected.name,
        ...(selected.environment?.engine ? { engine: selected.environment.engine } : {}),
        ...(account
          ? {
              accountId: account.id,
              accountName: account.name,
              accountRevision: String(account.revision),
              ...(account.reference ? { accountReference: account.reference } : {}),
            }
          : { signedOutAttested: true as const }),
      };
      await onSave({ ...workspace, rows: [...workspace.rows, row], updatedAt: Date.now() });
    },
    onSuccess: () => {
      setName("");
      setAccountId("");
    },
  });

  const openLive = useMutation({
    mutationFn: () => openPairedWorkspaceInLive({ workspace, openSpace: onOpenLive }),
  });

  return (
    <section className="mt-8 grid gap-3" aria-labelledby="paired-workspace-title">
      <div>
        <h2 id="paired-workspace-title" className="text-base font-semibold">
          Saved Browser and Account workspace
        </h2>
        <p className="text-sm text-muted-foreground">{pairedWorkspaceSummary(workspace)}</p>
      </div>
      {workspace.rows.length ? (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Named Browser and Account pairs</caption>
          <thead>
            <tr className="text-left text-muted-foreground">
              <th className="border-b border-border py-2 pr-3 font-medium">Name</th>
              <th className="border-b border-border py-2 pr-3 font-medium">Browser</th>
              <th className="border-b border-border py-2 font-medium">Account</th>
            </tr>
          </thead>
          <tbody>
            {workspace.rows.map((row) => (
              <tr key={row.id}>
                <td className="border-b border-border py-2 pr-3">{row.name}</td>
                <td className="border-b border-border py-2 pr-3">
                  {row.browserName}
                  {row.engine ? ` · ${row.engine}` : ""}
                </td>
                <td className="border-b border-border py-2">{row.accountName ?? "Signed out"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          saveRow.mutate();
        }}
      >
        <Input
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          placeholder="Admin desktop"
          aria-label="Pair name"
        />
        <select
          className="min-h-10 rounded-md border border-border bg-background px-3"
          value={browserId}
          onChange={(event) => {
            setBrowserId(event.currentTarget.value);
            setAccountId("");
          }}
          aria-label="Browser"
        >
          {spaces.map((space) => (
            <option key={space.id} value={space.id}>
              {space.name}
            </option>
          ))}
        </select>
        <select
          className="min-h-10 rounded-md border border-border bg-background px-3"
          value={accountId}
          onChange={(event) => setAccountId(event.currentTarget.value)}
          aria-label="Account"
        >
          <option value="">Signed out</option>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name}
            </option>
          ))}
        </select>
        <Button type="submit" variant="outline" disabled={!spaces.length || saveRow.isPending}>
          {saveRow.isPending ? "Saving…" : "Add pair"}
        </Button>
      </form>
      {saveRow.error ? (
        <p className="text-sm text-destructive" role="alert">
          {saveRow.error instanceof Error ? saveRow.error.message : "Could not save this pair."}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="default"
          disabled={!workspace.rows.length || openLive.isPending}
          onClick={() => openLive.mutate()}
        >
          {openLive.isPending ? "Opening…" : "Open in Live"}
        </Button>
        {openLive.data ? (
          <p className="text-sm text-muted-foreground" role="status">
            Opened {openLive.data.plan.map((row) => row.name).join(", ")}.
          </p>
        ) : null}
      </div>
    </section>
  );
}
