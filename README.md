# smoking

Run test cases described in `.donly` files ([DON](https://don.jon.soy/)) and see
which ones passed. A `.donly` file lists the npm packages a test needs and one
or more `case` blocks; `smoking` installs the packages, runs every case in an
isolated temporary directory and prints `✔` or `✘` for each one.

## Requirements

[Bun](https://bun.sh). It installs the dependencies and, unless you pass
`--runtime node`, runs each script. Node 22.18+ is only needed for
`--runtime node`.

## Usage

```sh
bunx @jondotsoy/smoking [options] <file.donly>
# or
npx @jondotsoy/smoking [options] <file.donly>
```

Running it without a file, or with `--help`, prints the full reference
(directives, options, exit codes and a runnable example).

### Options

| Option                             | Description                                                                                                                                |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `--dependency <package>[@version]` | Install an extra package, as if the file started with a `dependency <package>` line. Repeatable: `--dependency lodash --dependency react`. |
| `--runtime <bun\|node>`            | Executable that runs each script. Default: `bun`. With `node`, scripts run as ES modules; `tsx`/`jsx` scripts are not supported.           |
| `-h`, `--help`                     | Show the help and exit.                                                                                                                    |

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
bunx @jondotsoy/smoking examples/basic.donly
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

## Output and exit codes

Script output is printed as it happens, followed by one line per case: `✔ name`
if it passed, or `✘ name` with the error if it failed. The exit code is `0` when
every case passed and `1` when a case failed or the command was used
incorrectly.

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
