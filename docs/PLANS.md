# Plans and Data sets

Run saved Tests together, repeated with different inputs, languages, or devices.

## Repeat Tests with different prompts

Use a named Run input such as `{{chat_prompt}}` in the recorded text action.
In the Project Data sets, approve shared, non-sensitive list or static values.
An input Data set in a saved Plan references that Project input's stable ID:

```json
{
  "name": "Chat prompts",
  "kind": "custom",
  "apply": { "kind": "input", "inputId": "chat-prompt-data" },
  "options": [
    { "id": "value-1", "label": "Tides", "value": "Explain ocean tides in three sentences" },
    { "id": "value-2", "label": "Paper plane", "value": "Suggest one paper airplane tip" }
  ]
}
```

Pass this object as `variable` to `relay test var save <app-id> questions`, with
the current `expectedRevision`. Row IDs are stable identifiers up to 128
characters; the separate approved `value` can contain up to 20,000 characters.
Display labels never become Test text. A mixed Chat and Imagine Plan can use
`variableIds:["questions","pictures"]` and `strategy:"zip"` to pair equally
sized prompt lists in order. Each Test consumes only the inputs it references;
input rows add no taps or picker steps. Admitted values remain frozen on resume
even if the Project Data set changes later.

Discover and inspect the saved Plan using its App and Plan IDs:

```bash
./bin/relay plan list <app-id> --json
./bin/relay plan get <app-id> <plan-id> --json
./bin/relay plan preflight <app-id> <plan-id> --json
```

List and get read saved selections. Preflight checks the selected cases and bindings without
starting a Run; a live Run on the intended device is still needed to qualify the Plan.

Qualify the Plan manually on its intended device, then prepare its 30-minute
schedule with `combineId`, `appMapId`, the exact `targetId`, `platform`,
`targetKind:"device"`, `intervalMinutes:30`, and `enabled:false`. Enable it
after reviewing the successful Run. Without selected input rows, list defaults
use the first value; changing the schedule seed does not rotate prompts.
