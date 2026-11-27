# Relay GitHub Action

`bernaferrari/relay` runs Relay YAML tests in CI, uploads the machine-readable verdicts and run evidence, and keeps one pull-request comment up to date.

## Quick start

```yaml
name: Relay
on:
  pull_request:

permissions:
  contents: read
  pull-requests: write # lets the action update its PR comment

jobs:
  relay:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
      - uses: bernaferrari/relay@v1
        with:
          tests: ".relay/tests/*.yaml"
        env:
          OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}
```

Steps that were never recorded execute from their plain-English descriptions, and that execution needs a model. Set a model key in the repository secrets and pass it through `env` as shown — `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or `OPENROUTER_API_KEY` all work. Without one, those steps stop in setup with a missing-model-key error. Fully recorded steps replay without a model, but most real suites mix both kinds.

The pull-request comment is a single sticky comment. It is replaced on every run rather than added as another comment.

If you do not want comments, omit `pull-requests: write` and set `comment: "false"`. The test verdict, exit code, job summary, and artifact upload still work.

## Inputs

| Input           | Default               | Purpose                                                                                       |
| --------------- | --------------------- | --------------------------------------------------------------------------------------------- |
| `tests`         | `.relay/tests/*.yaml` | One Relay YAML file, a folder, or a glob of YAML files.                                       |
| `node-version`  | `24`                  | Node.js version used for the Relay CLI.                                                       |
| `relay-version` | `latest`              | Published `@relay/cli` version or npm dist-tag. Pin this for reproducible CI.                 |
| `device`        | empty                 | Optional value passed as `relay ci --device` (`browser`, `ios`, `android`, or a device name). |
| `comment`       | `true`                | Create or update the sticky pull-request comment.                                             |
| `comment-key`   | empty                 | Optional sticky-comment key. Use a unique value for matrix or multi-app runs.                 |
| `artifact-name` | `relay-results`       | Uploaded artifact name. Make it unique when running Relay in a matrix.                        |

A matrix entry usually needs a distinct artifact name and comment key:

```yaml
- uses: bernaferrari/relay@v1
  with:
    tests: ".relay/tests/*.yaml"
    device: ${{ matrix.device }}
    artifact-name: relay-results-${{ matrix.device }}
    comment-key: ${{ matrix.device }}
```

## Outputs

| Output         | Meaning                                                                                            |
| -------------- | -------------------------------------------------------------------------------------------------- |
| `verdict`      | `passed`, `failed`, `blocked`, `cancelled`, `review-required`, or `error`.                         |
| `results-file` | Path to the `relay-ci` JSON report.                                                                |
| `exit-code`    | The original `relay ci` exit code. The action restores it after uploading evidence and commenting. |
| `artifact-url` | Artifact URL when the upload succeeds.                                                             |

## What the action runs

The action resolves `tests` itself because the CLI currently accepts one positional file or folder, not a glob. If the glob matches several files, they are copied to a temporary folder in filename order and that folder is passed to the CLI. All files in one run must belong to the same Relay app; split multi-app suites into separate folders and use one action step per app (with unique artifact names) until the CLI supports them in one run.

The core invocation is equivalent to:

```bash
npx -y @relay/cli ci <resolved-file-or-folder> \
  --output .relay-ci/results.json \
  --junit .relay-ci/junit.xml
```

`--device <device>` is added only when the `device` input is set. For each run id in the JSON report, the action also runs the equivalent of `relay export <run-id> --out .relay-ci/evidence/<run>` so reviewers receive both machine and human evidence.

## Artifact contents

The uploaded `.relay-ci` artifact contains:

- `results.json` — the complete `{ totals, verdicts, skipped }` report;
- `junit.xml` — JUnit XML for CI dashboards;
- `evidence/<run>/trace-pack.json` — machine-readable trace evidence;
- `evidence/<run>/walkthrough.html` — a passive HTML walkthrough;
- `relay-cli.log`, `action-metadata.json`, and `evidence-manifest.json` — diagnostics.

Evidence can include screenshots of the application under test. Treat the artifact as confidential build output and choose an artifact-retention policy appropriate for the application.

## Runner notes

Browser tests are the best fit for standard hosted runners. iOS tests need a macOS runner with a simulator that Relay can control; Android tests need an emulator or attached device already configured. Mobile device setup is deliberately outside this action.

On pull requests from forks, GitHub may make the workflow token read-only even when `pull-requests: write` is declared. In that case Relay still runs and uploads artifacts; the comment step writes a workflow warning instead of masking the test verdict.
