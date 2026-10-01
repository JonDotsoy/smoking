import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { dirname, extname, join, resolve } from "node:path";
import { ConsoleCapture, type Capture } from "./capture.ts";
import { result } from "./utils/result.ts";
import { parseSpec, type CaseSpec, type ScriptSpec, type Spec } from "./spec.ts";

export type CaseResult = {
  name: string;
  ok: boolean;
  error?: string;
  // Byte-by-byte console output of the case's scripts, in the report unless `--no-cast`.
  cast?: Capture;
};

export type Report = {
  file: string;
  runtime: Runtime;
  ok: boolean;
  summary: { total: number; passed: number; failed: number };
  cases: CaseResult[];
};

// In JSON mode stdout is reserved for the report, so child output goes to
// stderr (fd 2) instead.
const childStdout = (json: boolean): "inherit" | 2 => (json ? 2 : "inherit");

const installDependency = async (spec: string, cwd: string, json: boolean): Promise<void> => {
  const proc = Bun.spawn(["bun", "add", spec], {
    cwd,
    stdout: childStdout(json),
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
  json: boolean;
  capture?: ConsoleCapture;
};

// Runs a `run`/`setup`/`teardown` script, given inline or as a path to a
// file (relative to the spec file); resolves to an error message, or
// undefined when the script succeeded.
const runScript = async (
  source: ScriptSpec,
  kind: string,
  fileStem: string,
  { baseDir, workDir, runtime, env, json, capture }: ScriptContext,
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
    stdout: capture ? "pipe" : childStdout(json),
    stderr: "pipe",
  });
  const stdoutDestination = json ? process.stderr : process.stdout;
  const [stderr] = await Promise.all([
    capture
      ? capturedStderr(capture, proc.stderr)
      : new Response(proc.stderr).text().then((text) => {
          if (text) process.stderr.write(text);
          return text;
        }),
    capture?.pipe(proc.stdout as ReadableStream<Uint8Array>, "stdout", stdoutDestination),
  ]);
  const exitCode = await proc.exited;
  return exitCode === 0 ? undefined : stderr.trim() || `exit code ${exitCode}`;
};

// Captures stderr while forwarding it, and resolves to its text.
const capturedStderr = async (
  capture: ConsoleCapture,
  source: ReadableStream<Uint8Array>,
): Promise<string> => {
  const parts: Buffer[] = [];
  const tap = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      parts.push(chunk);
      process.stderr.write(chunk, callback);
    },
  });
  await capture.pipe(source, "stderr", tap);
  return Buffer.concat(parts).toString();
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
  json: boolean,
  capture?: ConsoleCapture,
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

  const context: ScriptContext = { baseDir, workDir, runtime, env, json, capture };
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

  const captured = capture ? { cast: capture.toJSON() } : {};
  return error === undefined
    ? { name, ok: true, ...captured }
    : { name, ok: false, error, ...captured };
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
  // The caller prints the returned report as JSON on stdout, so nothing else
  // may go there: progress lines and child process output go to stderr.
  json?: boolean;
  // Record each case's console output byte by byte into its `cast`.
  capture?: boolean;
};

export const runDonlyFile = async (
  filePath: string,
  { dependencies = [], runtime = "bun", json = false, capture = false }: RunOptions = {},
): Promise<Report> => {
  const spec = parseSpec(filePath, await Bun.file(filePath).text());

  // Every run gets its own scratch directory: dependencies are installed
  // here and case scripts run from here, so `smoking` never touches the
  // caller's own package.json/node_modules.
  const workDir = await mkdtemp(join(tmpdir(), "smoking-run-"));
  const [ok, error, cases] = await result(
    runInWorkDir({ filePath, spec, workDir, dependencies, runtime, json, capture }),
  );
  await rm(workDir, { recursive: true, force: true });
  if (!ok) throw error;
  const passed = cases.filter((c) => c.ok).length;
  return {
    file: filePath,
    runtime,
    ok: passed === cases.length,
    summary: { total: cases.length, passed, failed: cases.length - passed },
    cases,
  };
};

const runInWorkDir = async ({
  filePath,
  spec,
  workDir,
  dependencies,
  runtime,
  json,
  capture,
}: {
  filePath: string;
  spec: Spec;
  workDir: string;
  dependencies: string[];
  runtime: Runtime;
  json: boolean;
  capture: boolean;
}): Promise<CaseResult[]> => {
  if (runtime === "node") {
    // Without this, node warns on stderr about detecting the module type.
    await writeFile(join(workDir, "package.json"), '{"type":"module"}\n');
  }
  for (const dep of new Set([...dependencies, ...spec.dependencies])) {
    if (!dep) continue;
    (json ? console.error : console.log)(`→ installing dependency: ${dep}`);
    await installDependency(dep, workDir, json);
  }

  const cases = spec.cases;
  if (cases.length === 0) {
    (json ? console.error : console.log)("No `case` blocks found.");
    return [];
  }

  const results: CaseResult[] = [];
  for (const [index, caseSpec] of cases.entries()) {
    const caseResult = await runCase(
      caseSpec,
      index,
      dirname(resolve(filePath)),
      workDir,
      runtime,
      json,
      capture ? new ConsoleCapture() : undefined,
    );
    results.push(caseResult);
    if (json) continue;
    if (caseResult.ok) {
      console.log(`✔ ${caseResult.name}`);
    } else {
      console.log(`✘ ${caseResult.name}`);
      if (caseResult.error) console.log(`  ${caseResult.error}`);
    }
  }

  return results;
};
