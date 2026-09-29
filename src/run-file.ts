import { DON, Directive, HeredocValue, ROOT_DIRECTIVE_NAME } from "donly";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { result } from "./utils/result.ts";

const EXT_BY_DELIMITER: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  js: "js",
  jsx: "jsx",
  mjs: "mjs",
};

const argValue = (arg: Directive["args"][number]): string =>
  arg instanceof HeredocValue ? arg.content : String(arg);

const directivesNamed = (directive: Directive, name: string): Directive[] =>
  directive.children.filter((child) => child.name === name);

// `DON.parse()` collapses a file with a single top-level directive into
// that directive itself, instead of wrapping it in a synthetic root — so a
// `.donly` file with just one `case` and no `dependency` has that `case` as
// `root` directly, not as a child of it.
const topLevelDirectives = (root: Directive): Directive[] =>
  root.name === ROOT_DIRECTIVE_NAME ? root.children : [root];

type CaseResult = {
  name: string;
  ok: boolean;
  error?: string;
};

const installDependency = async (spec: string, cwd: string): Promise<void> => {
  const proc = Bun.spawn(["bun", "add", spec], {
    cwd,
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`Failed to install dependency "${spec}" (exit code ${exitCode})`);
  }
};

const writeFileDirective = async (fileDirective: Directive, workDir: string): Promise<void> => {
  const [relativePath, content] = fileDirective.args;
  if (typeof relativePath !== "string" || !relativePath) {
    throw new Error("`file` directive expects a path as its first argument");
  }
  if (!(content instanceof HeredocValue)) {
    throw new Error(`\`file ${relativePath}\` expects a heredoc body`);
  }
  const filePath = join(workDir, relativePath);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content.content);
};

type ScriptContext = {
  // Directory of the .donly file; `setup ./x.ts` paths resolve against it.
  baseDir: string;
  workDir: string;
  runtime: Runtime;
  env: Record<string, string>;
};

// Runs a `run`/`setup`/`teardown` script, given either as a heredoc body or
// as a path to a file (relative to the .donly file); resolves to an error
// message, or undefined when the script succeeded.
const runScript = async (
  directive: Directive,
  kind: string,
  fileStem: string,
  { baseDir, workDir, runtime, env }: ScriptContext,
): Promise<string | undefined> => {
  const source = directive.args[0];
  let scriptPath: string;
  let ext: string;

  if (source instanceof HeredocValue) {
    ext = EXT_BY_DELIMITER[source.delimiter?.toLowerCase() ?? ""] ?? "ts";
    scriptPath = join(workDir, `${fileStem}.${ext}`);
    if (runtime === "node" && (ext === "tsx" || ext === "jsx")) {
      return `the node runtime cannot run \`${ext}\` scripts; use --runtime bun`;
    }
    await writeFile(scriptPath, source.content);
  } else if (typeof source === "string" && source) {
    // Run in place (not copied) so its own relative imports keep working.
    scriptPath = resolve(baseDir, source);
    ext = extname(scriptPath).slice(1).toLowerCase();
    if (!(await Bun.file(scriptPath).exists())) {
      return `${kind} file not found: ${scriptPath}`;
    }
    if (runtime === "node" && (ext === "tsx" || ext === "jsx")) {
      return `the node runtime cannot run \`${ext}\` scripts; use --runtime bun`;
    }
  } else {
    return `\`${kind}\` directive expects a heredoc body or a file path`;
  }

  const proc = Bun.spawn(runtime === "node" ? ["node", scriptPath] : ["bun", "run", scriptPath], {
    cwd: workDir,
    env,
    stdout: "inherit",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (stderr) process.stderr.write(stderr);
  return exitCode === 0 ? undefined : stderr.trim() || `exit code ${exitCode}`;
};

const writeFileDirectives = async (caseDirective: Directive, workDir: string): Promise<void> => {
  for (const fileDirective of directivesNamed(caseDirective, "file")) {
    await writeFileDirective(fileDirective, workDir);
  }
};

const runCase = async (
  caseDirective: Directive,
  index: number,
  baseDir: string,
  workDir: string,
  runtime: Runtime,
): Promise<CaseResult> => {
  const name = caseDirective.args.length
    ? caseDirective.args.map(argValue).join(" ")
    : `case ${index + 1}`;

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const envDirective of directivesNamed(caseDirective, "env")) {
    const [envName, envValue] = envDirective.args.map(argValue);
    if (!envName) continue;
    env[envName] = envValue ?? "";
  }

  const [filesOk, filesError] = await result(writeFileDirectives(caseDirective, workDir));
  if (!filesOk) {
    return { name, ok: false, error: filesError instanceof Error ? filesError.message : String(filesError) };
  }

  const runDirective = directivesNamed(caseDirective, "run")[0];
  if (!runDirective) {
    return { name, ok: false, error: "case has no `run` directive" };
  }

  const context: ScriptContext = { baseDir, workDir, runtime, env };
  const setups = directivesNamed(caseDirective, "setup");
  const teardowns = directivesNamed(caseDirective, "teardown");

  let error: string | undefined;
  for (const [n, setup] of setups.entries()) {
    const setupError = await runScript(setup, "setup", `case-${index}-setup-${n}`, context);
    if (setupError) {
      error = `setup failed: ${setupError}`;
      break;
    }
  }
  if (!error) {
    error = await runScript(runDirective, "run", `case-${index}`, context);
  }
  // Teardowns always run, even when setup or run failed; a failing teardown
  // only fails the case if nothing failed before it.
  for (const [n, teardown] of teardowns.entries()) {
    const teardownError = await runScript(teardown, "teardown", `case-${index}-teardown-${n}`, context);
    if (teardownError) error ??= `teardown failed: ${teardownError}`;
  }

  return error === undefined ? { name, ok: true } : { name, ok: false, error };
};

export type Runtime = "bun" | "node";
export const RUNTIMES: readonly Runtime[] = ["bun", "node"];

export type RunOptions = {
  // Executable that runs each case's script. Dependencies are always
  // installed with Bun.
  runtime?: Runtime;
  // Extra packages to install, as if `dependency <spec>` lines were added at
  // the top of the file.
  dependencies?: string[];
};

export const runDonlyFile = async (
  filePath: string,
  { dependencies = [], runtime = "bun" }: RunOptions = {},
): Promise<boolean> => {
  const text = await Bun.file(filePath).text();
  const root = DON.parse(text);
  const topLevel = topLevelDirectives(root);

  // Every run gets its own scratch directory: dependencies are installed
  // here and case scripts run from here, so `smoking` never touches the
  // caller's own package.json/node_modules.
  const workDir = await mkdtemp(join(tmpdir(), "smoking-run-"));
  const [ok, error, allOk] = await result(
    runInWorkDir({ filePath, topLevel, workDir, dependencies, runtime }),
  );
  await rm(workDir, { recursive: true, force: true });
  if (!ok) throw error;
  return allOk;
};

const runInWorkDir = async ({
  filePath,
  topLevel,
  workDir,
  dependencies,
  runtime,
}: {
  filePath: string;
  topLevel: Directive[];
  workDir: string;
  dependencies: string[];
  runtime: Runtime;
}): Promise<boolean> => {
  if (runtime === "node") {
    // Without this, node warns on stderr about detecting the module type.
    await writeFile(join(workDir, "package.json"), '{"type":"module"}\n');
  }
  const fileDependencies = topLevel
    .filter((d) => d.name === "dependency")
    .map((d) => d.args.map(argValue).join(""));
  for (const spec of new Set([...dependencies, ...fileDependencies])) {
    if (!spec) continue;
    console.log(`→ installing dependency: ${spec}`);
    await installDependency(spec, workDir);
  }

  const cases = topLevel.filter((d) => d.name === "case");
  if (cases.length === 0) {
    console.log("No `case` blocks found.");
    return true;
  }

  let allOk = true;
  for (const [index, caseDirective] of cases.entries()) {
    const caseResult = await runCase(caseDirective, index, dirname(resolve(filePath)), workDir, runtime);
    allOk = allOk && caseResult.ok;
    if (caseResult.ok) {
      console.log(`✔ ${caseResult.name}`);
    } else {
      console.log(`✘ ${caseResult.name}`);
      if (caseResult.error) console.log(`  ${caseResult.error}`);
    }
  }

  return allOk;
};
