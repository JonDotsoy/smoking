import { cp, mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Writable } from "node:stream";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { ConsoleCapture, type Capture } from "./capture.ts";
import networkPreload from "./network-preload.txt" with { type: "text" };
import { readNetwork, type NetworkRequest } from "./network.ts";
import { result } from "./utils/result.ts";
import { SmokingFile, type Case, type Script } from "./model.ts";

export type CaseResult = {
  name: string;
  ok: boolean;
  error?: string;
  // Byte-by-byte console output of the case's scripts, in the report unless `--no-cast`.
  cast?: Capture;
  // CPU profile of each script the case ran, in the report with `--profile`.
  profiles?: ScriptProfile[];
  // HTTP requests the case's scripts made, in the report with `--network`.
  network?: NetworkRequest[];
};

// A V8 CPU profile (`.cpuprofile`, loadable in Chrome DevTools or speedscope)
// of one script, as produced by `bun`/`node --cpu-prof`.
export type ScriptProfile = {
  phase: "setup" | "run" | "teardown";
  // Script file path as run: inline scripts live in the scratch directory.
  script: string;
  profile: unknown;
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

const writeCaseFile = async (path: string, content: Uint8Array, workDir: string): Promise<void> => {
  const filePath = join(workDir, path);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
};

type ScriptContext = {
  workDir: string;
  runtime: Runtime;
  env: Record<string, string>;
  json: boolean;
  capture?: ConsoleCapture;
  // With --profile: where `--cpu-prof` writes, and where profiles are collected.
  profileDir?: string;
  profiles?: ScriptProfile[];
  // With --network: where each script's events are written, and where requests
  // are collected.
  network?: { dir: string; requests: NetworkRequest[] };
};

// Runs a `run`/`setup`/`teardown` script, given inline or as a path to a
// file (`script.location`, run in place); resolves to an error message, or
// undefined when the script succeeded.
const runScript = async (
  script: Script,
  kind: string,
  fileStem: string,
  { workDir, runtime, env, json, capture, profileDir, profiles, network }: ScriptContext,
): Promise<string | undefined> => {
  if (script.error !== undefined) return script.error;
  const ext = script.syntax;
  if (runtime === "node" && (ext === "tsx" || ext === "jsx")) {
    return `the node runtime cannot run \`${ext}\` scripts; use --runtime bun`;
  }
  // A script given as a path runs in place (not copied) so its own relative
  // imports keep working.
  let scriptPath: string;
  if (script.location) {
    scriptPath = fileURLToPath(script.location);
  } else {
    scriptPath = join(workDir, `${fileStem}.${ext}`);
    await writeFile(scriptPath, script.command);
  }

  const scriptDir = profileDir && join(profileDir, fileStem);
  const networkFile = network && join(network.dir, `${fileStem}.ndjson`);
  const preload = network && join(network.dir, "preload.mjs");
  const flags = [
    ...(scriptDir ? ["--cpu-prof", "--cpu-prof-dir", scriptDir] : []),
    ...(preload && runtime === "node"
      ? ["--experimental-network-inspection", "--import", preload]
      : []),
    ...(preload && runtime === "bun" ? ["--preload", preload] : []),
  ];
  // Bun only takes these flags before the script, without `run`.
  const command =
    runtime === "node"
      ? ["node", ...flags, scriptPath]
      : flags.length > 0
        ? ["bun", ...flags, scriptPath]
        : ["bun", "run", scriptPath];
  const proc = Bun.spawn(command, {
    cwd: workDir,
    env: networkFile ? { ...env, SMOKING_NETWORK_FILE: networkFile } : env,
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
  if (networkFile && network) {
    const phase = kind as ScriptProfile["phase"];
    network.requests.push(...(await readNetwork(networkFile, phase, scriptPath)));
  }
  if (scriptDir && profiles) {
    const phase = kind as ScriptProfile["phase"];
    profiles.push(...(await readProfiles(scriptDir, phase, scriptPath)));
  }
  return exitCode === 0 ? undefined : stderr.trim() || `exit code ${exitCode}`;
};

// Reads the `.cpuprofile` files the script wrote (none if it was killed or
// the profile could not be parsed).
const readProfiles = async (
  dir: string,
  phase: ScriptProfile["phase"],
  script: string,
): Promise<ScriptProfile[]> => {
  const [listed, , names] = await result(readdir(dir));
  if (!listed) return [];
  const profiles: ScriptProfile[] = [];
  for (const name of names.filter((n) => n.endsWith(".cpuprofile")).sort()) {
    const [parsed, , profile] = await result(async () => Bun.file(join(dir, name)).json());
    if (parsed) profiles.push({ phase, script, profile });
  }
  return profiles;
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

const writeCaseFiles = async (spec: Case, workDir: string): Promise<void> => {
  // Runs before `file` so a `file` can override something copied by `add`.
  for (const [path, source] of spec.adds) {
    const destination = join(workDir, path);
    await mkdir(dirname(destination), { recursive: true });
    await cp(fileURLToPath(source), destination, { recursive: true });
  }
  for (const [path, content] of spec.files) await writeCaseFile(path, content, workDir);
};

const runCase = async (
  spec: Case,
  index: number,
  workDir: string,
  runtime: Runtime,
  json: boolean,
  capture?: ConsoleCapture,
  profileDir?: string,
  networkDir?: string,
): Promise<CaseResult> => {
  const name = spec.name ?? `case ${index + 1}`;

  const env: Record<string, string> = { ...process.env } as Record<string, string>;
  for (const [envName, envValue] of Object.entries(spec.env)) {
    if (!envName) continue;
    env[envName] = envValue;
  }

  if (spec.error !== undefined) return { name, ok: false, error: spec.error };

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

  const profiles: ScriptProfile[] | undefined = profileDir ? [] : undefined;
  const network = networkDir ? { dir: networkDir, requests: [] } : undefined;
  const context: ScriptContext = {
    workDir,
    runtime,
    env,
    json,
    capture,
    profileDir: profileDir && join(profileDir, `case-${index}`),
    profiles,
    network,
  };
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

  const extra = {
    ...(capture ? { cast: capture.toJSON() } : {}),
    ...(profiles ? { profiles } : {}),
    ...(network ? { network: network.requests } : {}),
  };
  return error === undefined ? { name, ok: true, ...extra } : { name, ok: false, error, ...extra };
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
  // Run every script with `--cpu-prof` and record the CPU profiles into each
  // case's `profiles`.
  profile?: boolean;
  // Record the HTTP requests each case's scripts make into its `network`.
  network?: boolean;
};

export const runDonlyFile = async (
  filePath: string,
  {
    dependencies = [],
    runtime = "bun",
    json = false,
    capture = false,
    profile = false,
    network = false,
  }: RunOptions = {},
): Promise<Report> => {
  const spec = await SmokingFile.fromFile(filePath);

  // Every run gets its own scratch directory: dependencies are installed
  // here and case scripts run from here, so `smoking` never touches the
  // caller's own package.json/node_modules.
  const workDir = await mkdtemp(join(tmpdir(), "smoking-run-"));
  const profileDir = profile ? await mkdtemp(join(tmpdir(), "smoking-prof-")) : undefined;
  const networkDir = network ? await mkdtemp(join(tmpdir(), "smoking-net-")) : undefined;
  if (networkDir) await writeFile(join(networkDir, "preload.mjs"), networkPreload);
  const [ok, error, cases] = await result(
    runInWorkDir({
      filePath,
      spec,
      workDir,
      dependencies,
      runtime,
      json,
      capture,
      profileDir,
      networkDir,
    }),
  );
  await rm(workDir, { recursive: true, force: true });
  if (profileDir) await rm(profileDir, { recursive: true, force: true });
  if (networkDir) await rm(networkDir, { recursive: true, force: true });
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
  profileDir,
  networkDir,
}: {
  filePath: string;
  spec: SmokingFile;
  workDir: string;
  dependencies: string[];
  runtime: Runtime;
  json: boolean;
  capture: boolean;
  profileDir?: string;
  networkDir?: string;
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
      workDir,
      runtime,
      json,
      capture ? new ConsoleCapture() : undefined,
      profileDir,
      networkDir,
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
