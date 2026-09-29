import { DON, Directive, HeredocValue } from "donly";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

const runCase = async (
  caseDirective: Directive,
  index: number,
  workDir: string,
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

  const runDirective = directivesNamed(caseDirective, "run")[0];
  if (!runDirective) {
    return { name, ok: false, error: "case has no `run` directive" };
  }
  const heredoc = runDirective.args[0];
  if (!(heredoc instanceof HeredocValue)) {
    return { name, ok: false, error: "`run` directive expects a heredoc body" };
  }
  const ext = EXT_BY_DELIMITER[heredoc.delimiter?.toLowerCase() ?? ""] ?? "ts";
  const scriptPath = join(workDir, `case-${index}.${ext}`);

  await writeFile(scriptPath, heredoc.content);
  const proc = Bun.spawn(["bun", "run", scriptPath], {
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

export const runDonlyFile = async (filePath: string): Promise<boolean> => {
  const text = await Bun.file(filePath).text();
  const root = DON.parse(text);

  // Every run gets its own scratch directory: dependencies are installed
  // here and case scripts run from here, so `smoking` never touches the
  // caller's own package.json/node_modules.
  const workDir = await mkdtemp(join(tmpdir(), "smoking-run-"));
  try {
    for (const dependencyDirective of directivesNamed(root, "dependency")) {
      const spec = dependencyDirective.args.map(argValue).join("");
      if (!spec) continue;
      console.log(`→ installing dependency: ${spec}`);
      await installDependency(spec, workDir);
    }

    const cases = directivesNamed(root, "case");
    if (cases.length === 0) {
      console.log("No `case` blocks found.");
      return true;
    }

    let allOk = true;
    for (const [index, caseDirective] of cases.entries()) {
      const result = await runCase(caseDirective, index, workDir);
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
