/** @jsxImportSource react */
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@relay/ui-react/components/dialog";
import { Columns2, Plus, UserRound, X } from "lucide-react";
import { SelectField } from "../components/filter-select";
import type {
  ProductBrowserAuthFixture,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";
import type {
  PairedConfigurationRow,
  PairedConfigurationWorkspace,
} from "../data/paired-configuration";

/** One browser shows one account at a time, so a grid holds up to four accounts. */
export const MAX_ACCOUNTS = 4;
const SIGNED_OUT = "signed-out";

const TINTS = [
  "bg-sky-500/15 text-sky-700 dark:text-sky-300",
  "bg-violet-500/15 text-violet-700 dark:text-violet-300",
  "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  "bg-indigo-500/15 text-indigo-700 dark:text-indigo-300",
];

/** A stable tint per name, so the same account looks the same everywhere. */
export function tintFor(value: string): string {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return TINTS[hash % TINTS.length]!;
}

export function PersonAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  // Signed out is nobody in particular: a neutral silhouette, not an initial.
  if (name === "Signed out")
    return (
      <span
        aria-hidden="true"
        className={`grid shrink-0 place-items-center rounded-full bg-muted text-muted-foreground ${size === "sm" ? "size-6" : "size-9"}`}
      >
        <UserRound className={size === "sm" ? "size-3.5" : "size-4"} />
      </span>
    );
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full font-semibold ${tintFor(name)} ${size === "sm" ? "size-6 text-[11px]" : "size-9 text-sm"}`}
    >
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * A short name people can tell apart. A browser named after its host shows the host
 * with its port ("127.0.0.1:8793"); only true duplicates add the day they were made.
 */
export function browserLabel(
  space: ProductBrowserSpace,
  all: readonly ProductBrowserSpace[],
): string {
  const base = (item: ProductBrowserSpace) => {
    const site = host(item.startUrl);
    const hostname = site.replace(/:\d+$/u, "");
    return item.name === hostname || item.name === site ? site : item.name;
  };
  const name = base(space);
  if (all.filter((other) => base(other) === name).length < 2) return name;
  const day = new Date(space.createdAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  return `${name} · ${day}`;
}

type Props = {
  workspace: PairedConfigurationWorkspace;
  spaces: readonly ProductBrowserSpace[];
  accountsByBrowser: Readonly<Record<string, readonly ProductBrowserAuthFixture[]>>;
  onSave(workspace: PairedConfigurationWorkspace): Promise<void>;
  onOpen(): Promise<unknown>;
  onNewBrowser(): void;
};

/**
 * Several accounts at once: up to four browsers, each signed in to a different
 * account. The same set is what a run uses to check every account.
 */
export function SideBySide({
  workspace,
  spaces,
  accountsByBrowser,
  onSave,
  onOpen,
  onNewBrowser,
}: Props) {
  const [editing, setEditing] = useState(false);
  const open = useMutation({ mutationFn: onOpen });
  const rows = workspace.rows.slice(0, MAX_ACCOUNTS);
  const slots = Array.from({ length: MAX_ACCOUNTS }, (_, index) => rows[index]);
  const editor = (
    <AccountsEditor
      open={editing}
      onOpenChange={setEditing}
      workspace={workspace}
      spaces={spaces}
      accountsByBrowser={accountsByBrowser}
      onSave={onSave}
      onNewBrowser={onNewBrowser}
    />
  );
  // Nothing chosen yet: a quiet invitation, not a big empty grid and a disabled button.
  if (!rows.length)
    return (
      <section
        aria-labelledby="side-by-side-title"
        className="flex flex-wrap items-center gap-4 rounded-xl border border-border bg-card p-4"
      >
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
        >
          <Columns2 className="size-5" />
        </span>
        <div className="grid min-w-0 flex-1 gap-0.5">
          <h2 id="side-by-side-title" className="text-sm font-semibold">
            Compare accounts side by side
          </h2>
          <p className="text-xs text-muted-foreground">
            Open up to four browsers at once, each signed in as a different account.
          </p>
        </div>
        <Button variant="outline" onClick={() => setEditing(true)}>
          Choose accounts
        </Button>
        {editor}
      </section>
    );
  return (
    <section
      aria-labelledby="side-by-side-title"
      className="grid items-center gap-6 rounded-2xl border border-border bg-card p-5 sm:p-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]"
    >
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <h2 id="side-by-side-title" className="text-lg font-semibold tracking-tight">
            Compare accounts side by side
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Open up to four browsers next to each other, each signed in to a different account, like
            Admin, Member, and Guest. A run can check all of them in one go.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={open.isPending} onClick={() => open.mutate()}>
            <Columns2 aria-hidden="true" />
            {open.isPending ? "Opening…" : "Open side by side"}
          </Button>
          <Button variant="outline" onClick={() => setEditing(true)}>
            Edit accounts
          </Button>
          <span className="text-xs text-muted-foreground">
            {rows.length} of {MAX_ACCOUNTS} accounts
          </span>
        </div>
        {open.error ? (
          <p role="alert" className="text-sm text-destructive">
            {open.error instanceof Error ? open.error.message : "Couldn’t open these browsers."}
          </p>
        ) : null}
      </div>

      {/* A small picture of the grid you'll get; empty slots invite the next account. */}
      <div
        className="grid aspect-[16/9] grid-cols-2 grid-rows-2 gap-2 rounded-xl border border-border bg-muted/40 p-2"
        aria-label="Accounts side by side"
      >
        {slots.map((row, index) =>
          row ? (
            <div
              key={row.id}
              className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border bg-background shadow-xs"
            >
              <div className="flex items-center gap-1 border-b border-border px-2 py-1">
                <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                <span className="size-1.5 rounded-full bg-muted-foreground/30" />
                <span className="ml-1 truncate font-mono text-[10px] text-muted-foreground">
                  {row.browserName}
                </span>
              </div>
              <div className="flex min-h-0 flex-1 items-center gap-2.5 px-3">
                <PersonAvatar name={row.accountName ?? "Signed out"} />
                <span className="grid min-w-0">
                  <span className="truncate text-sm font-medium">
                    {row.accountName ?? "Signed out"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {host(spaces.find((space) => space.id === row.browserId)?.startUrl ?? "")}
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <button
              key={`empty-${index}`}
              type="button"
              onClick={() => setEditing(true)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-xs text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
            >
              <Plus className="size-3.5" aria-hidden="true" /> Add an account
            </button>
          ),
        )}
      </div>

      {editor}
    </section>
  );
}

type Draft = { key: string; browserId: string; accountId: string };

/** A browser is one identity: its most recent saved sign-in, else signed out. */
export function defaultAccount(accounts: readonly ProductBrowserAuthFixture[] | undefined): string {
  const usable = (accounts ?? []).filter(
    (account) => !account.revokedAt && (!account.expiresAt || account.expiresAt > Date.now()),
  );
  return [...usable].sort((a, b) => b.createdAt - a.createdAt)[0]?.id ?? SIGNED_OUT;
}

function draftsFrom(workspace: PairedConfigurationWorkspace): Draft[] {
  return workspace.rows.slice(0, MAX_ACCOUNTS).map((row) => ({
    key: row.id,
    browserId: row.browserId,
    accountId: row.accountId ?? SIGNED_OUT,
  }));
}

function AccountsEditor({
  open,
  onOpenChange,
  workspace,
  spaces,
  accountsByBrowser,
  onSave,
  onNewBrowser,
}: Omit<Props, "onOpen"> & { open: boolean; onOpenChange(open: boolean): void }) {
  const [drafts, setDrafts] = useState<Draft[]>(() => draftsFrom(workspace));
  const used = new Set(drafts.map((draft) => draft.browserId));
  const free = spaces.filter((space) => !used.has(space.id));
  const original = draftsFrom(workspace);
  const changed =
    drafts.length !== original.length ||
    drafts.some(
      (draft, index) =>
        draft.browserId !== original[index]?.browserId ||
        draft.accountId !== original[index]?.accountId,
    );
  const save = useMutation({
    mutationFn: async () => {
      const rows = drafts.flatMap((draft): PairedConfigurationRow[] => {
        const space = spaces.find((item) => item.id === draft.browserId);
        if (!space) return [];
        const account = (accountsByBrowser[space.id] ?? []).find(
          (item) => item.id === draft.accountId,
        );
        // Keep a saved name when it still uses the same browser and account.
        const previous = workspace.rows.find((row) => row.id === draft.key);
        const unchanged =
          previous?.browserId === space.id &&
          (previous.accountId ?? SIGNED_OUT) === draft.accountId;
        return [
          {
            id: previous ? draft.key : `row-${Date.now()}-${draft.key}`,
            name: unchanged ? previous.name : space.name,
            browserId: space.id,
            browserName: space.name,
            ...(space.environment?.engine ? { engine: space.environment.engine } : {}),
            ...(account
              ? {
                  accountId: account.id,
                  accountName: account.name,
                  accountRevision: String(account.revision),
                  ...(account.reference ? { accountReference: account.reference } : {}),
                }
              : { signedOutAttested: true as const }),
          },
        ];
      });
      await onSave({ ...workspace, rows, updatedAt: Date.now() });
    },
    onSuccess: () => onOpenChange(false),
  });

  function update(key: string, change: Partial<Draft>) {
    setDrafts((current) =>
      current.map((draft) =>
        draft.key === key
          ? {
              ...draft,
              ...change,
              // A different browser brings its own sign-in.
              ...(change.browserId && change.browserId !== draft.browserId
                ? { accountId: defaultAccount(accountsByBrowser[change.browserId]) }
                : {}),
            }
          : draft,
      ),
    );
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setDrafts(draftsFrom(workspace));
          save.reset();
        }
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-xl" showCloseButton={false}>
        <DialogTitle>Accounts side by side</DialogTitle>
        <DialogDescription>
          Pick up to four browsers. Each one opens with its own saved sign-in, so each is a
          different account.
        </DialogDescription>
        <ol className="grid list-none gap-2 p-0" aria-label="Accounts">
          {drafts.map((draft, index) => {
            const accounts = accountsByBrowser[draft.browserId] ?? [];
            const accountName =
              accounts.find((account) => account.id === draft.accountId)?.name ?? "Signed out";
            return (
              <li
                key={draft.key}
                className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border border-border p-3"
              >
                <PersonAvatar name={accountName} />
                <div className="grid min-w-0 gap-1 [&_[data-slot=select-trigger]]:w-full">
                  <SelectField
                    compact
                    label="Browser"
                    value={draft.browserId}
                    options={spaces
                      .filter((space) => space.id === draft.browserId || !used.has(space.id))
                      .map((space) => ({ value: space.id, label: browserLabel(space, spaces) }))}
                    onValueChange={(browserId) => update(draft.key, { browserId })}
                  />
                  {/* One browser is one identity: choosing the browser chooses the account. */}
                  <p className="flex min-h-5 items-center gap-1.5 ps-1 text-xs text-muted-foreground">
                    {accountName === "Signed out" ? "Opens signed out" : `Opens as ${accountName}`}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove account ${index + 1}`}
                  onClick={() =>
                    setDrafts((current) => current.filter((item) => item.key !== draft.key))
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            );
          })}
        </ol>
        {drafts.length < MAX_ACCOUNTS ? (
          free.length ? (
            <Button
              variant="outline"
              className="w-fit"
              onClick={() =>
                setDrafts((current) => [
                  ...current,
                  {
                    key: `new-${current.length}-${free[0]!.id}`,
                    browserId: free[0]!.id,
                    accountId: defaultAccount(accountsByBrowser[free[0]!.id]),
                  },
                ])
              }
            >
              <Plus aria-hidden="true" /> Add an account
            </Button>
          ) : (
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
              Every browser is already used. Add another browser for the next account.
              <Button
                variant="link"
                className="h-auto p-0"
                onClick={() => {
                  onOpenChange(false);
                  onNewBrowser();
                }}
              >
                New browser
              </Button>
            </p>
          )
        ) : null}
        {save.error ? (
          <p role="alert" className="text-sm text-destructive">
            Couldn’t save these accounts. Try again.
          </p>
        ) : null}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!changed || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { host as browserHost };
