/** @jsxImportSource react */
import { Input } from "@relay/ui-react/components/input";
import type { ValidationDraft } from "./test-editor-assertion-model";

type MediaDraft = Extract<ValidationDraft, { kind: "download" | "media-check" | "audio-record" }>;
export function MediaCheckEditor({
  value,
  onChange,
}: {
  value: MediaDraft;
  onChange(value: MediaDraft): void;
}) {
  return (
    <div className="grid gap-3">
      <label htmlFor="media-check-file">
        {value.kind !== "media-check" ? "Save as" : "Generated file"}
        <Input
          id="media-check-file"
          value={value.file}
          placeholder="generated/output.mp4"
          onChange={(event) => onChange({ ...value, file: event.currentTarget.value })}
        />
      </label>
      {value.kind !== "media-check" ? (
        <>
          <label htmlFor="download-control">
            {value.kind === "download" ? "Download control" : "HTML audio or video control"}
            <Input
              id="download-control"
              value={value.label}
              onChange={(event) => onChange({ ...value, label: event.currentTarget.value })}
            />
          </label>
          {value.kind === "audio-record" ? (
            <>
              <label htmlFor="audio-record-duration">
                Recording duration in milliseconds
                <Input
                  id="audio-record-duration"
                  type="number"
                  min={250}
                  max={30000}
                  step={1}
                  value={value.durationMs}
                  onChange={(event) =>
                    onChange({ ...value, durationMs: event.currentTarget.value })
                  }
                />
              </label>
              <p className="text-muted-foreground">
                Records a selected browser HTML audio or video element with explicit audio consent.
                WebAudio, speech synthesis, native apps, and physical speaker output are
                unsupported.
              </p>
            </>
          ) : (
            <p className="text-muted-foreground">
              Downloads the actual generated file through the browser. Add a media check next to
              verify it.
            </p>
          )}
        </>
      ) : (
        <>
          <label>
            File type
            <select
              aria-label="Media type"
              value={value.media}
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              onChange={(event) => {
                const media = event.currentTarget.value;
                if (media === "image" || media === "video" || media === "audio")
                  onChange({ ...value, media });
              }}
            >
              <option value="image">Image</option>
              <option value="video">Video</option>
              <option value="audio">Audio</option>
            </select>
          </label>
          {(
            [
              ["width", "Width in pixels"],
              ["height", "Height in pixels"],
              ["minDurationMs", "Minimum duration in milliseconds"],
              ["minBytes", "Minimum file size in bytes"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} htmlFor={`media-check-${key}`}>
              {label} (optional)
              <Input
                id={`media-check-${key}`}
                type="number"
                min={1}
                step={1}
                value={value[key]}
                onChange={(event) => onChange({ ...value, [key]: event.currentTarget.value })}
              />
            </label>
          ))}
          <label>
            Compare with a source file
            <select
              aria-label="Media comparison"
              value={value.relation}
              className="h-9 w-full rounded-md border border-border bg-background px-2"
              onChange={(event) => {
                const relation = event.currentTarget.value;
                if (
                  relation === "" ||
                  relation === "edited" ||
                  relation === "upscaled" ||
                  relation === "extended"
                )
                  onChange({ ...value, relation, ...(!relation ? { sourceFile: "" } : {}) });
              }}
            >
              <option value="">No comparison</option>
              <option value="edited">Edited output differs</option>
              <option value="upscaled">Upscaled dimensions increased</option>
              <option value="extended">Extended duration increased</option>
            </select>
          </label>
          {value.relation ? (
            <label htmlFor="media-check-source">
              Source file
              <Input
                id="media-check-source"
                value={value.sourceFile}
                onChange={(event) => onChange({ ...value, sourceFile: event.currentTarget.value })}
              />
            </label>
          ) : null}
          <p className="text-muted-foreground">
            Checks the decoded file and its metadata. A visual review is still needed to judge
            content quality.
          </p>
        </>
      )}
    </div>
  );
}
