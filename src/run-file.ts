import { DON, Directive, HeredocValue, ROOT_DIRECTIVE_NAME } from "donly";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

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

const runCase = async (
  caseDirective: Directive,
  index: number,
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

  try {
    for (const fileDirective of directivesNamed(caseDirective, "file")) {
      await writeFileDirective(fileDirective, workDir);
    }
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }

  const runDirective = directivesNamed(caseDirective, "run")[0];
  if (!runDirective) {
    return { name, ok: false, error: "case has no `run` directive" };
  }
  const heredoc = runDirective.args[0];
  if (!(heredoc instanceof HeredocValue)) {
    return { name, ok: false, error: "`run` directive expects a heredoc body" };
  }
  const ext = EXT_BY_DELIMITER[heredoc.delimiter?.toLowerCase() ?? ""] ?? "ts";
  if (runtime === "node" && (ext === "tsx" || ext === "jsx")) {
    return { name, ok: false, error: `the node runtime cannot run \`${ext}\` scripts; use --runtime bun` };
  }
  const scriptPath = join(workDir, `case-${index}.${ext}`);

  await writeFile(scriptPath, heredoc.content);
  const proc = Bun.spawn(runtime === "node" ? ["node", scriptPath] : ["bun", "run", scriptPath], {
    cwd: workDir,
    env,
    stdout: "inherit",
    stderr: "pipe",
  });
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  if (stderr) process.stderr.write(stderr);
  if (exitCode !== 0) {
    return { name, ok: false, error: stderr.trim() || `exit code ${exitCode}` };
  }
  return { name, ok: true };
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
  try {
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
      const result = await runCase(caseDirective, index, workDir, runtime);
      allOk = allOk && result.ok;
      if (result.ok) {
        console.log(`✔ ${result.name}`);
      } else {
        console.log(`✘ ${result.name}`);
        if (result.error) console.log(`  ${result.error}`);
      }
    }

    return allOk;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
};
