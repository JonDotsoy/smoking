import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { result } from "../src/utils/result.ts";

export const CLI_PATH = join(import.meta.dir, "..", "bin", "smoking.ts");
export const FIXTURES_DIR = join(import.meta.dir, "fixtures");
export const REPO_ROOT = join(import.meta.dir, "..");

export const normalize = (output: string): string =>
  output
    .replaceAll(REPO_ROOT, "<repo>")
    .replaceAll(/\/tmp\/smoking-run-[^/]+/g, "/tmp/smoking-run-<random>")
    .replaceAll(/Bun v[\d.]+ \([^)]+\)/g, "Bun v<version> (<platform>)")
    .replaceAll(/^bun (\w+) v[\d.]+ \([0-9a-f]+\)$/gm, "bun $1 v<version> (<hash>)")
    // Newer Bun versions, when they detect GitHub Actions, add an `::error`
    // annotation line and drop the internal `loadAndEvaluateModule` frame;
    // strip both (and collapse the blank line left behind) so the snapshot
    // is the same locally and in CI regardless of Bun version.
    .replaceAll(/^::error[^\n]*\n/gm, "")
    .replaceAll(/^[ \t]*at loadAndEvaluateModule \([^)]*\)\n/gm, "")
    .replaceAll(/\n{3,}/g, "\n\n")
    // `bun add`'s own noise: whether it needs to resolve/download, and how
    // long that takes, depends on whatever's already in the local package
    // cache rather than on the CLI's own behavior.
    .replaceAll(/^Resolving dependencies\n/gm, "")
    .replaceAll(/^Resolved, downloaded and extracted \[\d+\]\n/gm, "")
    .replaceAll(/^\[[\d.]+m?s\] done\n/gm, "")
    .replaceAll(/^\d+ packages? (?:installed|removed) \[[\d.]+m?s\]\n/gm, "");

export const runCliWithArgs = (args: string[]) => {
  // `smoking` runs each file in its own scratch temp directory (installing
  // dependencies and running case scripts there), so it never touches this
  // repo's own package.json/node_modules regardless of the cwd it's run from.
  const proc = Bun.spawnSync(["bun", CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: proc.exitCode,
    stdout: normalize(proc.stdout.toString()),
    stderr: normalize(proc.stderr.toString()),
  };
};

export const runCli = (fixture: string) => runCliWithArgs([join(FIXTURES_DIR, fixture)]);

// Writes `content` to a temporary .donly file and runs the CLI on it;
// `buildArgs` receives the file path and returns the full CLI arguments.
export const runDonly = async (
  content: string,
  buildArgs: (file: string) => string[] = (file) => [file],
) => {
  const dir = await mkdtemp(join(tmpdir(), "smoking-test-"));
  const file = join(dir, "cases.donly");
  const [ok, error, run] = await result(async () => {
    await writeFile(file, content);
    return runCliWithArgs(buildArgs(file));
  });
  await rm(dir, { recursive: true, force: true });
  if (!ok) throw error;
  return run!;
};
