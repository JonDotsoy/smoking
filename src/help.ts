export const EXAMPLE_DONLY = `dependency hotconfigs

case reads-config-from-env {
  env FOO tar
  file ./greeting.txt <<<txt
    hello
  run <<<ts
    import { readFileSync } from "node:fs"
    import { load, string } from "hotconfigs"

    const configs = await load({ FOO: string() })
    if (configs.FOO.get() !== "tar") throw new Error("FOO should be tar")

    const greeting = readFileSync("./greeting.txt", "utf8").trim()
    if (greeting !== "hello") throw new Error("unexpected greeting: " + greeting)

    console.log("config and file look good")
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
  bunx @jondotsoy/smoking <file.donly>
  npx  @jondotsoy/smoking <file.donly>

OPTIONS
  -h, --help    Show this help message and exit.

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

    run <<<lang
        The script to execute. The heredoc delimiter picks the language:
        ts (default), tsx, js, jsx or mjs. The script runs with its working
        directory set to the same folder the "file" directives write to, so
        relative paths like "./greeting.txt" just work. Required.

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
  Bun must be installed (https://bun.sh). It is used to install the
  dependencies and to run each script.
`;
