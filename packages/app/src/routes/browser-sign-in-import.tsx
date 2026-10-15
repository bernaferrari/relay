/** @jsxImportSource react */
import { useId, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from "@relay/ui-react/components/dialog";
import { Input } from "@relay/ui-react/components/input";
import { Field, FieldLabel, FieldError } from "@relay/ui-react/components/field";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@relay/ui-react/components/select";
import { Upload } from "lucide-react";
import { parseBrowserSessionImport, type BrowserImportedStorage } from "@relay/protocol";
import type {
  BrowserSpacesProductService,
  ProductBrowserSpace,
} from "../data/browser-spaces-product-service";

export function BrowserSignInImport({
  service,
  spaces,
  spaceId,
}: {
  service: BrowserSpacesProductService;
  spaces: readonly ProductBrowserSpace[];
  spaceId?: string;
}) {
  const query = useQueryClient(),
    id = useId();
  const fileRequest = useRef(0);
  const [open, setOpen] = useState(false),
    [target, setTarget] = useState(spaceId ?? ""),
    [name, setName] = useState("");
  const [state, setState] = useState<BrowserImportedStorage>(),
    [error, setError] = useState<string>(),
    [pending, setPending] = useState(false);
  const domains = [
    ...new Set([
      ...(state?.cookies.map((cookie) => cookie.domain.replace(/^\./u, "")) ?? []),
      ...(state?.origins.map((row) => new URL(row.origin).hostname) ?? []),
    ]),
  ];
  if (!service.importAuthenticationFixture) return null;
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        fileRequest.current++;
        if (next) {
          setState(undefined);
          setError(undefined);
          setName("");
          setTarget(spaceId ?? spaces[0]?.id ?? "");
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" disabled={!spaces.length} />}>
        <Upload aria-hidden="true" /> Import cookies
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Import sign-in</DialogTitle>
        <DialogDescription>
          Choose a browser cookie export or Playwright storage-state JSON. Sign-ins are stored
          encrypted on your Relay host.
        </DialogDescription>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!state || !target || !name.trim() || pending) return;
            setPending(true);
            setError(undefined);
            void service.importAuthenticationFixture!({
              spaceId: target,
              name: name.trim(),
              storageState: state,
            })
              .then(async () => {
                await query.invalidateQueries({ queryKey: ["browser-spaces", target, "accounts"] });
                await query.invalidateQueries({ queryKey: ["app-resources", "account-lanes"] });
                setOpen(false);
                setState(undefined);
              })
              .catch(() =>
                setError("Couldn’t import this sign-in. Check the Relay connection and try again."),
              )
              .finally(() => setPending(false));
          }}
        >
          {!spaceId ? (
            <Field>
              <FieldLabel htmlFor={`${id}-browser`}>Browser</FieldLabel>
              <Select
                value={target}
                onValueChange={(value) => setTarget(value ?? "")}
                items={spaces.map((space) => ({ value: space.id, label: space.name }))}
              >
                <SelectTrigger id={`${id}-browser`} className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {spaces.map((space) => (
                    <SelectItem key={space.id} value={space.id}>
                      {space.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`${id}-file`}>Sign-in file</FieldLabel>
            <Input
              id={`${id}-file`}
              type="file"
              accept=".json,application/json"
              disabled={pending}
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                const request = ++fileRequest.current;
                setState(undefined);
                setError(undefined);
                if (!file) return;
                if (file.size > 8 * 1024 * 1024) {
                  setError("Choose a sign-in file smaller than 8 MB.");
                  return;
                }
                void file
                  .text()
                  .then((raw) => {
                    if (request !== fileRequest.current) return;
                    const parsed = parseBrowserSessionImport(raw);
                    setState(parsed);
                    setName(
                      (current) => current || file.name.replace(/\.json$/iu, "").slice(0, 128),
                    );
                  })
                  .catch(() => {
                    if (request === fileRequest.current)
                      setError(
                        "Choose a supported browser cookie or Playwright storage-state JSON file.",
                      );
                  });
              }}
            />
          </Field>
          {state ? (
            <p className="text-xs text-muted-foreground">
              {state.cookies.length} {state.cookies.length === 1 ? "cookie" : "cookies"}
              {state.origins.length
                ? ` · ${state.origins.length} site${state.origins.length === 1 ? "" : "s"}`
                : ""}
              {domains.length
                ? ` · ${domains.slice(0, 4).join(", ")}${domains.length > 4 ? "…" : ""}`
                : ""}
            </p>
          ) : null}
          <Field>
            <FieldLabel htmlFor={`${id}-name`}>Account name</FieldLabel>
            <Input
              id={`${id}-name`}
              value={name}
              maxLength={128}
              onChange={(event) => setName(event.currentTarget.value)}
              placeholder="For example, Staging member"
              disabled={pending}
            />
          </Field>
          {error ? <FieldError>{error}</FieldError> : null}
          <div className="flex justify-end gap-2">
            <DialogClose render={<Button variant="ghost" disabled={pending} />}>Cancel</DialogClose>
            <Button type="submit" disabled={!state || !target || !name.trim() || pending}>
              {pending ? "Importing…" : "Import sign-in"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
