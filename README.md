<img src="docs/assets/smoking.png" alt="Black and white engraving of a man in a fedora and a fine pinstripe suit, looking downward" align="right" width="160" />

# smoking

Create smoke tests quickly. A single manifest (a `.donly` file, written in
[DON](https://don.jon.soy/), or YAML) can hold and run several scripts, each in
its own isolated environment. `smoking` installs the npm packages the tests
need, prepares the working files and scripts, runs every `case` in an isolated
temporary directory, and cleans those workspaces up afterwards with `teardown`
scripts and by deleting the temporary directory. It prints `✔` or `✘` for each
case (or a JSON report, with `--json`). A saved report records each case's
console output, so you can replay it later in the terminal or in a browser
player (`play`).

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

```sh
bunx @jondotsoy/smoking play [--ui] <report file>
```

`play` replays a saved report (see [Replaying a report](#replaying-a-report)).

Running it without a file, or with `--help`, prints the full reference
(directives, options, exit codes and a runnable example).

### Options

| Option                             | Description                                                                                                                                                                                                                                       |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--dependency <package>[@version]` | Install an extra package, as if the file started with a `dependency <package>` line. Repeatable: `--dependency lodash --dependency react`.                                                                                                        |
| `--runtime <bun\|node>`            | Executable that runs each script. Default: `bun`. With `node`, scripts run as ES modules; `tsx`/`jsx` scripts are not supported.                                                                                                                  |
| `--json`                           | Print the report as JSON on stdout. Script output and progress go to stderr, so stdout stays valid JSON.                                                                                                                                          |
| `--output <path>`                  | Save the report, as JSON, to `<path>` (parent folders are created). Works with or without `--json`.                                                                                                                                               |
| `--no-profile`                     | With `--json` or `--output`, every script runs with `--cpu-prof` and each case gets `profiles: [{ phase, script, profile }]` (V8 `.cpuprofile`, opens in Chrome DevTools or speedscope). `--no-profile` leaves it out.                            |
| `--no-network`                     | With `--json` or `--output`, each case gets `network: [{ phase, script, method, url, status, … }]`, the HTTP requests its scripts made. Uses `node:inspector` with `--runtime node`; with Bun only `fetch` is seen. `--no-network` leaves it out. |
| `--no-cast`                        | With `--json` or `--output`, each case in the report has `cast: { startAt, chunks: [{ elapse, stream, buffer }] }`, its console output byte by byte. `--no-cast` leaves it out.                                                                   |
| `-h`, `--help`                     | Show the help and exit.                                                                                                                                                                                                                           |

### Replaying a report

```sh
bunx @jondotsoy/smoking run --output report.json examples/basic.donly
bunx @jondotsoy/smoking play report.json
bunx @jondotsoy/smoking play --ui report.json
```

| Command              | What it does                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `play <report>`      | Writes the recorded console output back to the terminal, byte by byte and with its original timing (each case is announced with a `▶ <name>` line on stderr). |
| `play --ui <report>` | Serves a browser player and the report on `http://localhost` (random port, the URL is printed; Ctrl+C stops it).                                              |

Both need a report with a cast, so they fail on one saved with `--no-cast`.

#### Colors

The cast keeps the bytes as the script wrote them, and the player renders ANSI
colors and styles. Scripts write to a pipe, though, so runtimes turn colors off
there: a plain `console.log({ a: 1 })` is recorded without colors. To record
them, set `FORCE_COLOR` in the case:

```
case colorful {
  env FORCE_COLOR 1
  run <<<ts
    console.log({ a: 1, b: "two" })
}
```

#### Browser player

A terminal with a time bar. It processes the whole cast up front, one terminal
state per chunk, so you can scrub, pause and change the speed (0.25×–4×). Space
plays/pauses, ←/→ jump 1 s, Home/End go to the start/end. With several cases, pick
one from the list; columns and rows (default 80×24) are adjustable. Blue marks on
the bar are stdout chunks, red ones stderr.

The player is also a standalone page, `src/player.html`: open it and drop a
report on it, or serve it and use `player.html?report=report.json`.

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
`teardown` accept either an inline heredoc (`<<<ts`, `<<<js`, `<<<tsx`, `<<<jsx`, `<<<mjs`, `<<<sh`, `<<<bash`, `<<<zsh`;
the label picks the language; the shell ones run with that shell) or a path to a file. Paths are resolved relative
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
