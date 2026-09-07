import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@relay/ui-react/components/button";
import { Input } from "@relay/ui-react/components/input";
import { Label } from "@relay/ui-react/components/label";
import { SelectField } from "../components/filter-select";

export function RecordingAppChoice({
  apps,
  value,
  onChange,
  createApp,
  onCreated,
  onCreatingChange,
}: {
  apps: readonly { id: string; name: string }[];
  value: string;
  onChange(id: string): void;
  createApp(name: string): Promise<{ id: string; name: string }>;
  onCreated(app: { id: string; name: string }): void;
  onCreatingChange(creating: boolean): void;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const open = creating || !apps.length;
  const create = useMutation({
    mutationFn: () => createApp(name.trim()),
    onSuccess: (app) => {
      onCreated(app);
      setCreating(false);
      onCreatingChange(false);
      setName("");
    },
  });
  function submit() {
    if (name.trim() && !create.isPending) create.mutate();
  }
  return (
    <div className="grid min-w-0 gap-3">
      {open ? (
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="recording-app-name">App name</Label>
            <Input
              id="recording-app-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="For example, Acme"
              maxLength={120}
              autoFocus
              disabled={create.isPending}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  submit();
                }
              }}
            />
            <p className="text-xs leading-relaxed text-muted-foreground">
              Keep this app’s tests and screens together.
            </p>
          </div>
          {create.error ? (
            <p role="alert" className="text-xs text-destructive">
              Couldn’t create the app. Your name is kept here—try again.
            </p>
          ) : null}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={!name.trim() || create.isPending}
              onClick={submit}
            >
              {create.isPending ? "Creating…" : "Create app"}
            </Button>
            {apps.length ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={create.isPending}
                onClick={() => {
                  setCreating(false);
                  onCreatingChange(false);
                  create.reset();
                }}
              >
                Cancel
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="flex min-w-0 items-end gap-2 [&>div]:min-w-0 [&>div]:flex-1">
          <SelectField
            label="App"
            value={value}
            placeholder="Choose an app"
            options={[
              ...apps.map((app) => ({ value: app.id, label: app.name })),
              { value: "__create_app__", label: "+ Create app…" },
            ]}
            onValueChange={(id) => {
              if (id === "__create_app__") {
                setCreating(true);
                onCreatingChange(true);
              } else onChange(id);
            }}
          />
        </div>
      )}
    </div>
  );
}
