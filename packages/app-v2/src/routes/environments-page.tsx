/** @jsxImportSource react */
import {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@relay/ui-react/components/dialog";
import { Field, FieldError, FieldLabel } from "@relay/ui-react/components/field";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Checkbox } from "@relay/ui-react/components/checkbox";
import { FieldLabel as ChoiceLabel } from "@relay/ui-react/components/field";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useRouteContext } from "@tanstack/react-router";
import { Globe2, Plus, RotateCcw } from "lucide-react";
import { useState, type FormEvent } from "react";
import { LibraryPage, PageHeader } from "../components/page-layout";
import { Breadcrumbs, EmptyState, RecoveryState } from "../components/product-patterns";
import { readSetupContinuation } from "../data/setup-continuation";
import { PageLoading } from "./recording-shared";

function displayHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function EnvironmentsPage() {
  const { browserSpacesService, queryClient } = useRouteContext({ from: "__root__" });
  const navigate = useNavigate();
  const rawSearch = useLocation({ select: (state) => state.search });
  const rawReturnTo =
    rawSearch && typeof rawSearch === "object" && "returnTo" in rawSearch
      ? String(rawSearch.returnTo)
      : undefined;
  const continuation = rawReturnTo ? readSetupContinuation(rawReturnTo) : undefined;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [startUrl, setStartUrl] = useState("");
  const [persistent, setPersistent] = useState(true);
  const spaces = useQuery({
    queryKey: ["browser-spaces"],
    queryFn: () => browserSpacesService.listSpaces(),
    staleTime: 10_000,
  });
  const create = useMutation({
    mutationFn: () =>
      browserSpacesService.createSpace({
        name,
        startUrl,
        profileRetention: persistent ? "retain" : "ephemeral",
      }),
    onSuccess: async (space) => {
      await queryClient.invalidateQueries({ queryKey: ["browser-spaces"] });
      setOpen(false);
      if (continuation) {
        await navigate({
          to: "/tests/new",
          search: {
            ...(continuation.appId ? { app: continuation.appId } : {}),
            target: space.id,
          },
        });
      } else {
        await navigate({ to: "/environments/$profileId", params: { profileId: space.id } });
      }
    },
  });

  function reset() {
    setName("");
    setStartUrl("");
    setPersistent(true);
    create.reset();
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    create.mutate();
  }

  return (
    <LibraryPage className="max-w-[1040px]">
      <Breadcrumbs items={[{ label: "Devices", to: "/devices" }, { label: "Browsers" }]} />
      <PageHeader
        context="Devices & browsers"
        title="Browsers"
        description="Saved browsers you can open, record on, and sign into."
        actions={
          <>
            {continuation ? (
              <Button
                variant="ghost"
                nativeButton={false}
                render={
                  <Link
                    to="/tests/new"
                    search={{
                      ...(continuation.appId ? { app: continuation.appId } : {}),
                      ...(continuation.targetId ? { target: continuation.targetId } : {}),
                    }}
                  />
                }
              >
                Back to recording
              </Button>
            ) : null}
            <Dialog
              open={open}
              onOpenChange={(next) => {
                setOpen(next);
                if (next) reset();
              }}
            >
              <DialogTrigger render={<Button variant="default" />}>
                <Plus aria-hidden="true" /> New browser
              </DialogTrigger>

              <DialogContent showCloseButton={false} className="relay-environment-dialog">
                <DialogTitle>New browser</DialogTitle>
                <DialogDescription>
                  Opens an isolated browser for this workspace. Keep data if you need the same
                  sign-in next time.
                </DialogDescription>
                <form onSubmit={submit} className="grid gap-5">
                  <Field>
                    <FieldLabel htmlFor="space-name">Name</FieldLabel>
                    <Input
                      id="space-name"
                      value={name}
                      onChange={(event) => setName(event.currentTarget.value)}
                      placeholder="For example, Staging member"
                      autoComplete="off"
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="space-url">Website</FieldLabel>
                    <Input
                      id="space-url"
                      type="url"
                      inputMode="url"
                      value={startUrl}
                      onChange={(event) => setStartUrl(event.currentTarget.value)}
                      placeholder="https://staging.example.com"
                      autoCapitalize="none"
                      autoCorrect="off"
                    />
                  </Field>
                  <ChoiceLabel className="flex min-h-14 min-w-0 cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-card-foreground transition-colors outline-none hover:bg-muted/50 has-data-checked:border-primary/30 has-data-checked:bg-primary/5 has-[:focus-visible]:border-ring has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50">
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="text-sm font-medium text-foreground">
                        Keep this browser profile
                      </span>
                      <span className="text-xs leading-snug text-muted-foreground">
                        Keep browser data and saved sign-ins between sessions.
                      </span>
                    </span>
                    <Checkbox
                      checked={persistent}
                      onCheckedChange={(checked) => setPersistent(checked === true)}
                    />
                  </ChoiceLabel>
                  {create.error ? (
                    <FieldError>
                      {create.error instanceof Error
                        ? create.error.message
                        : "Relay could not create this browser."}
                    </FieldError>
                  ) : null}
                  <div className="relay-dialog-actions flex flex-wrap items-center justify-end gap-2.5">
                    <DialogClose
                      render={
                        <Button
                          variant="ghost"
                          onClick={() => {
                            if (continuation) {
                              void navigate({
                                to: "/tests/new",
                                search: {
                                  ...(continuation.appId ? { app: continuation.appId } : {}),
                                  ...(continuation.targetId
                                    ? { target: continuation.targetId }
                                    : {}),
                                },
                              });
                            }
                          }}
                        />
                      }
                    >
                      Cancel
                    </DialogClose>
                    <Button
                      type="submit"
                      variant="default"
                      disabled={!name.trim() || !startUrl.trim() || create.isPending}
                    >
                      {create.isPending ? "Creating…" : "Create browser"}
                    </Button>
                  </div>
                </form>
              </DialogContent>
            </Dialog>
          </>
        }
      />

      {spaces.isPending ? <PageLoading label="Loading browsers…" /> : null}
      {spaces.error ? (
        <RecoveryState
          layout="centered"
          title="Browsers are unavailable"
          detail="Reconnect Relay, then try again."
          action={
            <Button variant="outline" onClick={() => void spaces.refetch()}>
              <RotateCcw aria-hidden="true" /> Try again
            </Button>
          }
        />
      ) : null}
      {spaces.data?.length ? (
        <ul className="mb-6 grid list-none gap-3 p-0" aria-label="Browsers">
          {spaces.data.map((space) => (
            <li key={space.id}>
              <Link
                className="group flex min-w-0 items-center gap-4 rounded-xl border border-border bg-card p-5 transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                to="/environments/$profileId"
                params={{ profileId: space.id }}
                search={continuation ? { returnTo: rawReturnTo } : undefined}
              >
                <span
                  className="grid size-[38px] place-items-center rounded-md border border-border bg-muted text-muted-foreground"
                  aria-hidden="true"
                >
                  <Globe2 />
                </span>
                <span className="grid min-w-0 flex-1 gap-1">
                  <strong className="text-sm font-semibold wrap-anywhere">{space.name}</strong>
                  <small className="text-sm text-muted-foreground wrap-anywhere">
                    {displayHost(space.startUrl)}
                  </small>
                  <small className="text-xs text-muted-foreground">
                    {space.persistent ? "Keeps browser data" : "Fresh browser each session"}
                    {space.environment?.locale ? ` · ${space.environment.locale}` : ""}
                  </small>
                </span>
                <span className="inline-flex flex-none items-center gap-1.5 text-xs font-semibold text-primary">
                  Open <span aria-hidden="true">→</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
      {!spaces.isPending && !spaces.error && spaces.data?.length === 0 ? (
        <EmptyState
          icon={Globe2}
          title="No browsers yet"
          detail="Start one to record or run a Test."
          action={
            <Button
              variant="default"
              onClick={() => {
                reset();
                setOpen(true);
              }}
            >
              New browser
            </Button>
          }
        />
      ) : null}
    </LibraryPage>
  );
}
