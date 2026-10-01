export const EXAMPLE_DONLY = `dependency hotconfigs

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
`;

const indent = (text: string, spaces: number): string =>
  text
    .trimEnd()
    .split("\n")
    .map((line) => (line ? " ".repeat(spaces) + line : line))
    .join("\n");

export const HELP = `smoking - run test cases described in .donly files

USAGE
  bunx @jondotsoy/smoking [options] <file.donly>
  npx  @jondotsoy/smoking [options] <file.donly>
  bunx @jondotsoy/smoking play <report file>

OPTIONS
  --dependency <package>[@version]
        Install an extra npm package, exactly as if the file started with a
        "dependency <package>" line. Repeatable:

          bunx @jondotsoy/smoking --dependency lodash --dependency react file.donly

        is the same as putting these lines at the top of file.donly:

          dependency lodash
          dependency react

  --runtime <bun|node>
        Executable that runs each case's script (default: bun). With "node",
        scripts run as "node <script>" in ES module mode; TypeScript ("ts")
        needs Node 22.18+ (type stripping) and "tsx"/"jsx" are not supported.
        Dependencies are always installed with Bun, whatever the runtime.

  --json
        Print the report as JSON on stdout instead of the "✔"/"✘" lines:
        { file, runtime, ok, summary: { total, passed, failed },
        cases: [{ name, ok, error? }] }. Script output and progress messages
        go to stderr so stdout stays valid JSON.

  --output <path>
        Save the report, as JSON, to <path> (parent folders are created).
        Works with or without --json; without it the usual output is still
        printed.

  --no-cast
        With --json or --output the report also records everything each case
        writes to the console, byte by byte: every case gets
        cast: { startAt, chunks: [{ elapse, stream, buffer }] } where startAt
        is epoch ms, elapse is ms since startAt, stream is "stdout" or
        "stderr" and buffer is the chunk's bytes as numbers (0-255). Pass
        --no-cast to leave it out. Without a report there is no cast.

  -h, --help
        Show this help message and exit.

PLAY
  smoking play <report file>
        Replay the console output recorded in a report saved with --output (or
        redirected from --json): every case's bytes are written back to the
        terminal with their original timing, stdout to stdout and stderr to
        stderr, each case preceded by a "▶ <name>" line on stderr. Fails when
        the report has no cast (it was saved with --no-cast).

DESCRIPTION
  A .donly file (DON, "Directive Object Notation") declares the npm packages a
  test needs and one or more \`case\` blocks. smoking installs the packages,
  runs every case and prints whether it passed or failed. Each case is a small
  TypeScript/JavaScript script executed with Bun; it passes when the script
  exits with code 0 and fails when it throws or exits with any other code.

FILE FORMAT
  Top-level directives:

    dependency <package>[@version]
        npm package to install before any case runs. Pin a version with
        "@", e.g. "dependency donly@0.0.28". Repeat the directive to install
        several packages.

    case [name] { ... }
        One test case. A file may contain several; they run in order. The
        optional name is what smoking prints next to the result (cases
        without one are called "case 1", "case 2", ...).

  Directives inside a case:

    env <NAME> <VALUE>
        Set an environment variable for this case's script. Repeatable.

    file <path> <<<ext
        Write a file before the script runs. <path> is relative to the
        case's working directory and its parent folders are created for you.
        The heredoc body (the indented lines below it) is the file content.
        Repeatable.

    setup <<<lang
    setup <path>
        Optional script that runs before "run", after the "file" directives.
        If it fails, "run" is skipped and the case fails. Repeatable; setups
        run in order. Give the script inline (heredoc) or as a path to a file,
        resolved relative to the .donly file, not to where you run smoking:
        for app/cases.donly, "setup ../configs/setup.ts" runs configs/setup.ts.

    teardown <<<lang
    teardown <path>
        Optional script that runs after "run" and always runs, even when
        "setup" or "run" failed, so it can clean up. If it fails the case
        fails too (unless it had already failed). Repeatable; teardowns run in
        order. Accepts an inline heredoc or a file path, like "setup".

    run <<<lang
        The script to execute. The heredoc delimiter picks the language:
        ts (default), tsx, js, jsx or mjs (same for setup and teardown). The
        script runs with its working directory set to the same folder the
        "file" directives write to, so relative paths like "./greeting.txt"
        just work. Required. Setup, run and teardown are separate processes:
        share state through files or "env".

  YAML: a file ending in .yaml or .yml describes the same thing as a mapping
  with "dependencies" (list of packages) and "cases" (list). Each case takes
  "name", "env" (mapping), "files" (path -> content), "setup" / "teardown"
  (one script or a list) and "run". A script is a string (inline TypeScript),
  "{ file: <path> }" or "{ code: <source>, lang: ts|tsx|js|jsx|mjs }".

  Files referenced by "setup <path>" / "teardown <path>" run in place, so their
  own relative imports work, and with Bun they can import the packages you
  declared. With "--runtime node" they resolve packages from their own folder.

  Heredocs start with "<<<" followed by a label and continue with the
  indented lines below; the indentation is stripped from the content.

EXAMPLE
  Save this as example.donly and run "bunx @jondotsoy/smoking example.donly":

${indent(EXAMPLE_DONLY, 4)}

OUTPUT
  Script output is printed as it happens, followed by one line per case:

    ✔ <case name>     the case passed
    ✘ <case name>     the case failed; the error is printed right below

EXIT CODES
  0    every case passed (or --help was requested)
  1    at least one case failed, or the command was used incorrectly

ISOLATION
  Every run happens inside its own temporary directory: dependencies are
  installed there and scripts run from there, and the directory is deleted
  afterwards. smoking never touches the package.json or node_modules of the
  project you run it from.

REQUIREMENTS
  Bun must be installed (https://bun.sh). It installs the dependencies and,
  unless --runtime node is given, runs each script. Node 22.18+ is only
  needed for --runtime node.
`;
