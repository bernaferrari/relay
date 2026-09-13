/** @jsxImportSource react */
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Box, Globe2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { SelectField } from "../components/filter-select";
import type {
  ProductAppVersion,
  ProductBrowserAccount,
} from "../data/app-resources-product-service";

export type VersionDraft = {
  id: string;
  name: string;
  platform: ProductAppVersion["platform"];
  status: ProductAppVersion["status"];
  applicationId?: string;
  configuration?: string;
  sourceSha?: string;
};

export type AccountDraft = {
  targetId: string;
  name: string;
  expiresAt?: number;
};

export type AccountRefreshInput = AccountDraft & { fixtureId: string };

export function VersionRow({
  version,
  canEdit,
  onEdit,
}: {
  version: ProductAppVersion;
  canEdit: boolean;
  onEdit(): void;
}) {
  return (
    <li className="grid min-h-[66px] grid-cols-[36px_minmax(0,1fr)_auto_minmax(110px,auto)] items-center gap-3 px-3.5 py-[11px] max-[780px]:grid-cols-[36px_minmax(0,1fr)_auto]">
      <span
        className="grid size-9 place-items-center rounded-md border border-border bg-background text-foreground"
        aria-hidden="true"
      >
        {version.platform === "web" ? <Globe2 /> : <Box />}
      </span>
      <span className="grid min-w-0 gap-1">
        <strong>{version.name}</strong>
        <small>
          {platformLabel(version.platform)}
          {version.configuration ? ` · ${version.configuration}` : ""}
          {version.applicationId ? ` · ${version.applicationId}` : ""}
        </small>
      </span>
      <span
        className={`inline-flex min-h-6 items-center rounded-full bg-background px-2.5 text-[11px] font-semibold capitalize text-muted-foreground`}
      >
        {statusLabel(version.status)}
      </span>
      <time dateTime={new Date(version.updatedAt).toISOString()}>
        Updated {shortDate(version.updatedAt)}
      </time>
      {canEdit ? (
        <span className="grid min-h-[66px] grid-cols-[36px_minmax(0,1fr)_auto_minmax(110px,auto)] items-center gap-3 px-3.5 py-[11px] max-[780px]:col-start-2 max-[780px]:col-end-[-1]">
          <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${version.name}`}>
            Edit
          </Button>
        </span>
      ) : null}
    </li>
  );
}

export function VersionEditorDialog({
  value,
  pending,
  error,
  onClose,
  onSubmit,
}: {
  value?: ProductAppVersion;
  pending: boolean;
  error: Error | null;
  onClose(): void;
  onSubmit(input: VersionDraft): void;
}) {
  const [draft, setDraft] = useState<VersionDraft>(() => versionDraft(value));
  const editing = value !== undefined;

  function submit(event: FormEvent) {
    event.preventDefault();
    const id = draft.id.trim();
    const name = draft.name.trim();
    if (!id || !name) return;
    onSubmit({
      id,
      name,
      platform: draft.platform,
      status: draft.status,
      ...(draft.applicationId?.trim() ? { applicationId: draft.applicationId.trim() } : {}),
      ...(draft.configuration?.trim() ? { configuration: draft.configuration.trim() } : {}),
      ...(draft.sourceSha?.trim() ? { sourceSha: draft.sourceSha.trim() } : {}),
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(720px,calc(100dvh-32px))] overflow-auto"
      >
        <DialogTitle>{editing ? "Edit version" : "Add version"}</DialogTitle>
        <DialogDescription>
          Register the exact build identity Relay can use. This does not associate a build with an
          saved Map.
        </DialogDescription>
        <form onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="version-id">Version ID</FieldLabel>
            <Input
              id="version-id"
              value={draft.id}
              onChange={(event) => setDraft({ ...draft, id: event.currentTarget.value })}
              placeholder="checkout-ios-3-4"
              autoComplete="off"
              readOnly={editing}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="version-name">Name</FieldLabel>
            <Input
              id="version-name"
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })}
              placeholder="Checkout 3.4.0"
              autoComplete="off"
            />
          </Field>
          <Field>
            <SelectField
              id="version-platform"
              label="Platform"
              value={draft.platform}
              disabled={editing}
              options={[
                { value: "ios", label: "iOS" },
                { value: "android", label: "Android" },
                { value: "web", label: "Web" },
              ]}
              onValueChange={(platform) =>
                setDraft({
                  ...draft,
                  platform: platform as ProductAppVersion["platform"],
                })
              }
            />
          </Field>
          {editing ? (
            <p className="text-xs text-muted-foreground">
              Current status: <strong>{statusLabel(draft.status)}</strong>. Relay updates build
              readiness from preflight, installation, and launch results.
            </p>
          ) : null}
          <div className="grid grid-cols-2 gap-3 max-[780px]:grid-cols-1">
            <Field>
              <FieldLabel htmlFor="version-configuration">Configuration</FieldLabel>
              <Input
                id="version-configuration"
                value={draft.configuration ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, configuration: event.currentTarget.value })
                }
                placeholder="release"
                autoComplete="off"
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="version-application-id">Application ID</FieldLabel>
              <Input
                id="version-application-id"
                value={draft.applicationId ?? ""}
                onChange={(event) =>
                  setDraft({ ...draft, applicationId: event.currentTarget.value })
                }
                placeholder="com.example.checkout"
                autoComplete="off"
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="version-source-sha">Source SHA (optional)</FieldLabel>
            <Input
              id="version-source-sha"
              value={draft.sourceSha ?? ""}
              onChange={(event) => setDraft({ ...draft, sourceSha: event.currentTarget.value })}
              placeholder="40-character source revision"
              autoComplete="off"
            />
          </Field>
          {error ? (
            <FieldError>
              {error instanceof Error ? error.message : "Relay could not save this version."}
            </FieldError>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="default"
              disabled={!draft.id.trim() || !draft.name.trim() || pending}
            >
              {pending ? "Saving…" : editing ? "Save version" : "Add version"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BrowserAccountDialog({
  account,
  targets,
  pending,
  error,
  onClose,
  onSave,
  onRefresh,
}: {
  account?: ProductBrowserAccount;
  targets: readonly { id: string; name: string }[];
  pending: boolean;
  error: Error | null;
  onClose(): void;
  onSave(input: AccountDraft): void;
  onRefresh(input: AccountRefreshInput): void;
}) {
  const editing = account !== undefined;
  const [name, setName] = useState(account?.fixture.name ?? "");
  const [targetId, setTargetId] = useState(account?.target.id ?? targets[0]?.id ?? "");
  const [expiresAt, setExpiresAt] = useState(formatDateInput(account?.fixture.expiresAt));

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !targetId) return;
    const expiry = parseDateInput(expiresAt);
    const input = {
      targetId,
      name: name.trim(),
      ...(expiry === undefined ? {} : { expiresAt: expiry }),
    };
    if (editing) onRefresh({ ...input, fixtureId: account.fixture.id });
    else onSave(input);
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(720px,calc(100dvh-32px))] overflow-auto"
      >
        <DialogTitle>{editing ? "Refresh browser sign-in" : "Save browser sign-in"}</DialogTitle>
        <DialogDescription>
          {editing
            ? "Capture the current reviewed state from this exact managed browser into the same fixture."
            : "Save the current reviewed state from an exact managed browser. Secrets stay on Relay and are never shown here."}
        </DialogDescription>
        <form onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="account-name">Sign-in name</FieldLabel>
            <Input
              id="account-name"
              value={name}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="Staging buyer"
              autoComplete="off"
            />
          </Field>
          <Field>
            <SelectField
              id="account-target"
              label="Managed browser"
              value={targetId}
              disabled={editing}
              options={targets.map((target) => ({
                value: target.id,
                label: target.name,
              }))}
              onValueChange={setTargetId}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="account-expiry">Expires on (optional)</FieldLabel>
            <Input
              id="account-expiry"
              type="date"
              value={expiresAt}
              onChange={(event) => setExpiresAt(event.currentTarget.value)}
            />
          </Field>
          {error ? (
            <FieldError>
              {error instanceof Error ? error.message : "Relay could not update this sign-in."}
            </FieldError>
          ) : null}
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="default" disabled={!name.trim() || !targetId || pending}>
              {pending ? "Saving…" : editing ? "Refresh sign-in" : "Save sign-in"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function RevokeAccountDialog({
  account,
  pending,
  error,
  onClose,
  onConfirm,
}: {
  account: ProductBrowserAccount;
  pending: boolean;
  error: Error | null;
  onClose(): void;
  onConfirm(): void;
}) {
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[min(720px,calc(100dvh-32px))] overflow-auto"
      >
        <DialogTitle>Revoke browser sign-in?</DialogTitle>
        <DialogDescription>
          This revokes “{account.fixture.name}” on {account.target.name}. Relay will keep the audit
          record and existing Runs keep their saved evidence. This sign-in will no longer be valid
          for future authenticated Tests.
        </DialogDescription>
        {error ? <FieldError>{error.message}</FieldError> : null}
        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="ghost" disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="default" disabled={pending} onClick={onConfirm}>
            {pending ? "Revoking…" : "Revoke sign-in"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function versionDraft(version?: ProductAppVersion): VersionDraft {
  return {
    id: version?.id ?? "",
    name: version?.name ?? "",
    platform: version?.platform ?? "ios",
    status: version?.status ?? "uploaded",
    applicationId: version?.applicationId,
    configuration: version?.configuration,
    sourceSha: version?.sourceSha,
  };
}

function formatDateInput(timestamp?: number): string {
  return timestamp === undefined ? "" : new Date(timestamp).toISOString().slice(0, 10);
}

function parseDateInput(value: string): number | undefined {
  if (!value) return undefined;
  const timestamp = Date.parse(`${value}T23:59:59.999Z`);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function platformLabel(platform: ProductAppVersion["platform"]): string {
  if (platform === "ios") return "iOS";
  if (platform === "android") return "Android";
  return "Web";
}

function statusLabel(status: string): string {
  return status.replace(/-/gu, " ").replace(/^./u, (letter) => letter.toLocaleUpperCase());
}

function shortDate(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(timestamp);
}
