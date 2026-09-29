import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import { result } from "./utils/result.ts";
import { parseSpec, type CaseSpec, type ScriptSpec, type Spec } from "./spec.ts";

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

const writeCaseFile = async (file: CaseSpec["files"][number], workDir: string): Promise<void> => {
  if (file.error !== undefined || file.content === undefined) throw new Error(file.error);
  const filePath = join(workDir, file.path);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, file.content);
};

type ScriptContext = {
  // Directory of the .donly file; `setup ./x.ts` paths resolve against it.
  baseDir: string;
  workDir: string;
  runtime: Runtime;
  env: Record<string, string>;
};

// Runs a `run`/`setup`/`teardown` script, given inline or as a path to a
// file (relative to the spec file); resolves to an error message, or
// undefined when the script succeeded.
const runScript = async (
  source: ScriptSpec,
  kind: string,
  fileStem: string,
  { baseDir, workDir, runtime, env }: ScriptContext,
): Promise<string | undefined> => {
  let scriptPath: string;
  let ext: string;

  if (source.kind === "inline") {
    ext = source.ext;
    scriptPath = join(workDir, `${fileStem}.${ext}`);
    if (runtime === "node" && (ext === "tsx" || ext === "jsx")) {
      return `the node runtime cannot run \`${ext}\` scripts; use --runtime bun`;
    }
    await writeFile(scriptPath, source.code);
  } else if (source.kind === "file") {
    // Run in place (not copied) so its own relative imports keep working.
    scriptPath = resolve(baseDir, source.path);
    ext = extname(scriptPath).slice(1).toLowerCase();
    if (!(await Bun.file(scriptPath).exists())) {
      return `${kind} file not found: ${scriptPath}`;
    }
    if (runtime === "node" && (ext === "tsx" || ext === "jsx")) {
      return `the node runtime cannot run \`${ext}\` scripts; use --runtime bun`;
    }
  } else {
    return source.message;
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

const writeCaseFiles = async (spec: CaseSpec, workDir: string): Promise<void> => {
  for (const file of spec.files) await writeCaseFile(file, workDir);
};

const runCase = async (
  spec: CaseSpec,
  index: number,
  baseDir: string,
  workDir: string,
  runtime: Runtime,
): Promise<CaseResult> => {
  const name = spec.name ?? `case ${index + 1}`;

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [envName, envValue] of spec.env) {
    if (!envName) continue;
    env[envName] = envValue;
  }

  const [filesOk, filesError] = await result(writeCaseFiles(spec, workDir));
  if (!filesOk) {
    return {
      name,
      ok: false,
      error: filesError instanceof Error ? filesError.message : String(filesError),
    };
  }

  const runDirective = spec.run;
  if (!runDirective) {
    return { name, ok: false, error: "case has no `run` directive" };
  }

  const context: ScriptContext = { baseDir, workDir, runtime, env };
  const setups = spec.setups;
  const teardowns = spec.teardowns;

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
    const teardownError = await runScript(
      teardown,
      "teardown",
      `case-${index}-teardown-${n}`,
      context,
    );
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
  const spec = parseSpec(filePath, await Bun.file(filePath).text());

  // Every run gets its own scratch directory: dependencies are installed
  // here and case scripts run from here, so `smoking` never touches the
  // caller's own package.json/node_modules.
  const workDir = await mkdtemp(join(tmpdir(), "smoking-run-"));
  const [ok, error, allOk] = await result(
    runInWorkDir({ filePath, spec, workDir, dependencies, runtime }),
  );
  await rm(workDir, { recursive: true, force: true });
  if (!ok) throw error;
  return allOk;
};

const runInWorkDir = async ({
  filePath,
  spec,
  workDir,
  dependencies,
  runtime,
}: {
  filePath: string;
  spec: Spec;
  workDir: string;
  dependencies: string[];
  runtime: Runtime;
}): Promise<boolean> => {
  if (runtime === "node") {
    // Without this, node warns on stderr about detecting the module type.
    await writeFile(join(workDir, "package.json"), '{"type":"module"}\n');
  }
  for (const dep of new Set([...dependencies, ...spec.dependencies])) {
    if (!dep) continue;
    console.log(`→ installing dependency: ${dep}`);
    await installDependency(dep, workDir);
  }

  const cases = spec.cases;
  if (cases.length === 0) {
    console.log("No `case` blocks found.");
    return true;
  }

  let allOk = true;
  for (const [index, caseSpec] of cases.entries()) {
    const caseResult = await runCase(caseSpec, index, dirname(resolve(filePath)), workDir, runtime);
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
