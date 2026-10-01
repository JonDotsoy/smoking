<img src="docs/assets/smoking.png" alt="Black and white engraving of a man in a fedora and a fine pinstripe suit, looking downward" align="right" width="160" />

# smoking

Create smoke tests quickly. A single manifest (a `.donly` file, written in
[DON](https://don.jon.soy/), or YAML) can hold and run several scripts, each in
its own isolated environment. `smoking` installs the npm packages the tests
need, prepares the working files and scripts, runs every `case` in an isolated
temporary directory, and cleans those workspaces up afterwards with `teardown`
scripts and by deleting the temporary directory. It prints `✔` or `✘` for each
case (or a JSON report, with `--json`).

## Requirements

[Bun](https://bun.sh). It installs the dependencies and, unless you pass
`--runtime node`, runs each script. Node 22.18+ is only needed for
`--runtime node`.

## Usage

```sh
bunx @jondotsoy/smoking run [options] <manifest.donly>
# or
npx @jondotsoy/smoking run [options] <manifest.donly>
```

`run` is optional (`smoking <manifest.donly>` does the same), but it is the safe
form for a manifest named like a command, e.g. `smoking run play`.

Running it without a file, or with `--help`, prints the full reference
(directives, options, exit codes and a runnable example).

### Options

| Option                             | Description                                                                                                                                                                     |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dependency <package>[@version]` | Install an extra package, as if the file started with a `dependency <package>` line. Repeatable: `--dependency lodash --dependency react`.                                      |
| `--runtime <bun\|node>`            | Executable that runs each script. Default: `bun`. With `node`, scripts run as ES modules; `tsx`/`jsx` scripts are not supported.                                                |
| `--json`                           | Print the report as JSON on stdout. Script output and progress go to stderr, so stdout stays valid JSON.                                                                        |
| `--output <path>`                  | Save the report, as JSON, to `<path>` (parent folders are created). Works with or without `--json`.                                                                             |
| `--no-cast`                        | With `--json` or `--output`, each case in the report has `cast: { startAt, chunks: [{ elapse, stream, buffer }] }`, its console output byte by byte. `--no-cast` leaves it out. |
| `-h`, `--help`                     | Show the help and exit.                                                                                                                                                         |

### Replaying a report

```sh
bunx @jondotsoy/smoking run --output report.json examples/basic.donly
bunx @jondotsoy/smoking play report.json
```

`play` writes the console output recorded in the report back to the terminal,
byte by byte and with its original timing (each case is announced with a
`▶ <name>` line on stderr). It needs a report with a cast, so it won't work on
one saved with `--no-cast`.

### Replaying in the browser

`docs/player.html` is a standalone page (no dependencies) that plays a report in
a terminal with a time bar. Open it, then drop or pick the report's JSON (or
serve it and use `player.html?report=report.json`). It processes the whole cast
up front, one terminal state per chunk, so you can scrub, pause and change the
speed. Space plays/pauses, ←/→ jump 1 s. Cols/rows can be adjusted.

## Example

`examples/basic.donly`:

```
dependency hotconfigs

case reads-config-from-env {
  env FOO tar
  file ./greeting.txt <<<txt
    hello
  setup <<<ts
    console.log("setup: preparing")
  run <<<ts
    import { readFileSync } from "node:fs"
    import { load, string } from "hotconfigs"

    const configs = await load({ FOO: string() })
    if (configs.FOO.get() !== "tar") throw new Error("FOO should be tar")

    const greeting = readFileSync("./greeting.txt", "utf8").trim()
    if (greeting !== "hello") throw new Error("unexpected greeting: " + greeting)

    console.log("config and file look good")
  teardown <<<ts
    console.log("teardown: cleaning up")
}
```

```sh
bunx @jondotsoy/smoking run examples/basic.donly
```

## File format

Top-level directives:

- `dependency <package>[@version]`: npm package to install before any case
  runs. Repeatable.
- `case [name] { ... }`: one test case. A file may have several; they run in
  order. The name is what gets printed (`case 1`, `case 2`, ... when omitted).

Inside a `case`:

- `env <NAME> <VALUE>`: environment variable for the case's scripts.
- `file <path> <<<ext`: write a file, relative to the case's working directory,
  before the scripts run. The heredoc body is the content.
- `setup <<<lang` / `setup <path>`: optional script that runs before `run`. If
  it fails, `run` is skipped and the case fails.
- `run <<<lang` / `run <path>`: the script under test. Required.
- `teardown <<<lang` / `teardown <path>`: optional script that always runs after
  `run`, even if `setup` or `run` failed. If it fails the case fails too.

`setup` and `teardown` can be repeated (they run in order). `setup`, `run` and
`teardown` accept either an inline heredoc (`<<<ts`, `<<<js`, `<<<tsx`, `<<<jsx`, `<<<mjs`;
the label picks the language) or a path to a file. Paths are resolved relative
to the `.donly` file, not to where you run `smoking`: in `app/cases.donly`,
`setup ../configs/setup.ts` runs `configs/setup.ts`. Each script is its own
process, so share state through files or `env`.

### YAML files

Cases can also be written in YAML (`.yaml` / `.yml`); the file extension picks
the format.

```yaml
dependencies:
  - hotconfigs
cases:
  - name: greets
    env:
      FOO: tar
    files:
      ./greeting.txt: hello
    setup: console.log("setting up")
    run: |
      import { readFileSync } from "node:fs";
      if (readFileSync("./greeting.txt", "utf8") !== "hello") throw new Error("bad");
    teardown:
      file: ./teardown.ts # or { code: "...", lang: js }
```

A script (`setup`, `run`, `teardown`) is a string (inline TypeScript),
`{ file: <path> }` (relative to the YAML file) or `{ code, lang }`.

## Output and exit codes

Script output is printed as it happens, followed by one line per case: `✔ name`
if it passed, or `✘ name` with the error if it failed. The exit code is `0` when
every case passed and `1` when a case failed or the command was used
incorrectly.

## JSON report

`--json` prints the report as JSON on stdout instead of the `✔`/`✘` lines, and
`--output <path>` saves the same JSON to a file (it can be combined with
`--json`). With `--json`, script output and progress messages go to stderr, so
stdout can be piped straight into tools like `jq`.

```sh
bunx @jondotsoy/smoking --json examples/basic.donly | jq '.summary'
bunx @jondotsoy/smoking --output reports/smoking.json examples/basic.donly
```

```json
{
  "file": "/path/to/examples/basic.donly",
  "runtime": "bun",
  "ok": false,
  "summary": { "total": 2, "passed": 1, "failed": 1 },
  "cases": [
    { "name": "a", "ok": true },
    { "name": "b", "ok": false, "error": "..." }
  ]
}
```

`error` is only present on failed cases. The exit code is the same as without
`--json`.

## Isolation

Every run happens in its own temporary directory: dependencies are installed
there, scripts run from there, and it is deleted afterwards. `smoking` never
touches the `package.json` or `node_modules` of the project you run it from.

## Development

```sh
bun install
bun test           # tests (snapshots of the real CLI, unit tests, type tests)
bun run check      # tsc --noEmit + prettier --check
bun run fmt        # format the code with prettier
bun run build      # bundle the CLI into dist/ (what gets published)
```

Conventions (Bun-first tooling, the `result()` error-handling helper) are in
[`CLAUDE.md`](CLAUDE.md).

### Publishing

The **Publish** workflow (`.github/workflows/publish.yaml`) is run manually
(`workflow_dispatch`) with three inputs: `version` (`none`, `patch`, `minor`,
`major`), `tag` (`latest`, `demo`, `beta`, `alpha`) and `provenance`. It bumps
the version, builds and runs `npm publish dist/` using npm trusted publishing
(OIDC), so no npm token is needed.

## License

[MIT](LICENSE) © Jonathan Delgado
