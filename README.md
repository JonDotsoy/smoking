# smoking

CLI that executes `.donly` test files: `.donly` files declare dependencies
and `case` blocks (each with `env` vars and a `run` heredoc script), and
`smoking` runs each case reporting pass/fail.

## Usage

```
npx smoking file.donly
```

## `.donly` file format

```
dependency hotconfigs

case {
  env FOO tar
  run <<<ts
    import { create, string } from "hotconfigs"
    if (process.env.FOO !== "tar") throw new Error("env FOO not injected")
    console.log("FOO =", process.env.FOO)
}
```

- `dependency <package>` — installed (via `bun add`) before running any case.
  A version can be pinned, e.g. `dependency donly@0.0.28`.
- `case { ... }` — one test case; a file may declare several.
- `env NAME VALUE` — sets an environment variable for that case's script.
- `file <path> <<<ext ... }` — writes a file (relative to the case's scratch
  directory) before running the script, e.g. `file ./file.txt <<<txt`. A case
  may declare several.
- `run <<<ts ... }` — the script body, run with `bun run` in a temp file
  (the heredoc delimiter picks the extension: `ts`, `js`, `tsx`, `jsx`, `mjs`).

Each run of `smoking` creates its own scratch temp directory: declared
dependencies are installed there and case scripts run from there, so a
`.donly` file's dependencies never touch the project you run `smoking` from.

For each case, `smoking` prints `✔ <case>` on success or `✘ <case>` with the
error on failure, and exits non-zero if any case failed.

See `examples/basic.donly` for a working example.
