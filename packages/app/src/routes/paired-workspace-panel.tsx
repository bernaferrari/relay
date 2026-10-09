/** @jsxImportSource react */
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { SelectField } from "../components/filter-select";
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
    <section className="mt-10 grid gap-4" aria-labelledby="paired-workspace-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="grid gap-1">
          <h2 id="paired-workspace-title" className="text-base font-semibold">
            Saved browser sign-ins
          </h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            Pair a browser with an account so one run can check several people at once — for example
            Admin and Member side by side.
          </p>
        </div>
        {workspace.rows.length ? (
          <Button variant="outline" disabled={openLive.isPending} onClick={() => openLive.mutate()}>
            {openLive.isPending ? "Opening…" : "Open all side by side"}
          </Button>
        ) : null}
      </div>
      {workspace.rows.length ? (
        <div className="grid gap-1.5">
          <p className="text-xs text-muted-foreground">{pairedWorkspaceSummary(workspace)}</p>
          <ul
            className="m-0 grid list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0"
            aria-label="Saved browser sign-ins"
          >
            {workspace.rows.map((row) => (
              <li key={row.id} className="flex items-center justify-between gap-4 px-4 py-3">
                <span className="truncate text-sm font-medium">{row.name}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {row.browserName}
                  {row.engine ? ` · ${row.engine}` : ""} · {row.accountName ?? "Signed out"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {openLive.data ? (
        <p className="text-sm text-muted-foreground" role="status">
          Opened {openLive.data.plan.map((row) => row.name).join(", ")}.
        </p>
      ) : null}
      <form
        className="grid gap-3 rounded-xl border border-dashed border-border p-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
        aria-label="Add a sign-in combination"
        onSubmit={(event) => {
          event.preventDefault();
          saveRow.mutate();
        }}
      >
        <label className="grid min-w-0 gap-1.5 text-xs font-medium">
          Name
          <Input
            value={name}
            onChange={(event) => setName(event.currentTarget.value)}
            placeholder="e.g. Admin desktop"
            aria-label="Combination name"
          />
        </label>
        <SelectField
          label="Browser"
          value={browserId}
          options={spaces.map((space) => ({ value: space.id, label: space.name }))}
          onValueChange={(value) => {
            setBrowserId(value);
            setAccountId("");
          }}
        />
        <SelectField
          label="Signed in as"
          value={accountId || "signed-out"}
          options={[
            { value: "signed-out", label: "Signed out" },
            ...accounts.map((account) => ({ value: account.id, label: account.name })),
          ]}
          onValueChange={(value) => setAccountId(value === "signed-out" ? "" : value)}
        />
        <Button type="submit" disabled={!spaces.length || !name.trim() || saveRow.isPending}>
          {saveRow.isPending ? "Adding…" : "Add"}
        </Button>
      </form>
      {saveRow.error ? (
        <p className="text-sm text-destructive" role="alert">
          {saveRow.error instanceof Error ? saveRow.error.message : "Could not save this pair."}
        </p>
      ) : null}
    </section>
  );
}
