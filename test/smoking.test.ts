import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXAMPLE_DONLY } from "../src/help.ts";
import { result } from "../src/utils/result.ts";

const CLI_PATH = join(import.meta.dir, "..", "bin", "smoking.ts");
const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const REPO_ROOT = join(import.meta.dir, "..");

const normalize = (output: string): string =>
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

const runCliWithArgs = (args: string[]) => {
  // `smoking` runs each file in its own scratch temp directory (installing
  // dependencies and running case scripts there), so it never touches this
  // repo's own package.json/node_modules regardless of the cwd it's run from.
  const result = Bun.spawnSync(["bun", CLI_PATH, ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: normalize(result.stdout.toString()),
    stderr: normalize(result.stderr.toString()),
  };
};

const runCli = (fixture: string) => runCliWithArgs([join(FIXTURES_DIR, fixture)]);

describe("smoking CLI", () => {
  test("runs a mix of passing and failing cases", () => {
    const { exitCode, stdout, stderr } = runCli("mixed.donly");

    expect(exitCode).toBe(1);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("installs a declared `dependency` before running the case", () => {
    const { exitCode, stdout, stderr } = runCli("dependency.donly");

    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("installs a `dependency` pinned to a specific version", () => {
    const { exitCode, stdout, stderr } = runCli("dependency-version.donly");

    expect(exitCode).toBe(0);
    // The version is pinned in the fixture itself (`dependency donly@0.0.28`);
    // the snapshot below is what proves the CLI actually installed that exact
    // version rather than "latest".
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("installs hotconfigs and reads an env-backed config in the case script", () => {
    const { exitCode, stdout, stderr } = runCli("dependency-hotconfigs.donly");

    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("writes a `file` directive's content before running the case", () => {
    const { exitCode, stdout, stderr } = runCli("file-directive.donly");

    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("--dependency installs extra packages as if declared in the file", () => {
    const { exitCode, stdout, stderr } = runCliWithArgs([
      "--dependency",
      "lodash@4.17.21",
      "--dependency=donly@0.0.29",
      join(FIXTURES_DIR, "dependency-flag.donly"),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("--dependency without a value is rejected", () => {
    const { exitCode, stderr } = runCliWithArgs(["--dependency"]);

    expect(exitCode).toBe(1);
    expect(stderr.split("\n")[0]).toBe("Option --dependency requires a value");
  });

  test("runs case scripts with bun by default", () => {
    const { exitCode, stdout } = runCli("runtime.donly");

    expect(exitCode).toBe(0);
    expect(stdout).toBe("running on bun\n✔ which-runtime\n");
  });

  test("--runtime node runs case scripts with node", () => {
    const { exitCode, stdout, stderr } = runCliWithArgs([
      "--runtime",
      "node",
      join(FIXTURES_DIR, "runtime.donly"),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("running on node\n✔ which-runtime\n");
    expect(stderr).toBe("");
  });

  test("--runtime node can use installed dependencies", () => {
    const { exitCode, stdout } = runCliWithArgs([
      "--runtime=node",
      join(FIXTURES_DIR, "dependency.donly"),
    ]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("parsed greeting = hello\n✔ uses-dependency");
  });

  test("--runtime rejects unsupported runtimes", () => {
    const { exitCode, stderr } = runCliWithArgs(["--runtime", "deno", "file.donly"]);

    expect(exitCode).toBe(1);
    expect(stderr.split("\n")[0]).toBe('Invalid --runtime "deno": expected bun or node');
  });

  test("runs setup before run and teardown after, even when steps fail", () => {
    const { exitCode, stdout } = runCli("hooks.donly");

    expect(exitCode).toBe(1);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stdout).not.toContain("run must not execute");
  });

  test("setup and teardown can point to files relative to the .donly file", () => {
    const { exitCode, stdout } = runCliWithArgs([
      join(FIXTURES_DIR, "external", "app", "cases.donly"),
    ]);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stdout).not.toContain("run must not execute");
  });

  test("the built dist/ CLI behaves like the source CLI", async () => {
    const build = Bun.spawnSync(["bun", "run", "build"], { cwd: REPO_ROOT });
    expect(build.exitCode).toBe(0);

    const distPkg = await Bun.file(join(REPO_ROOT, "dist", "package.json")).json();
    expect(distPkg.bin).toEqual({ smoking: "smoking.ts" });
    expect(distPkg.private).toBe(false);

    const dist = Bun.spawnSync(["bun", join(REPO_ROOT, "dist", "smoking.ts"), "--help"]);
    expect(dist.exitCode).toBe(0);
    expect(dist.stdout.toString()).toBe(runCliWithArgs(["--help"]).stdout + "");
  });

  test("--help prints the documented usage and file format", () => {
    const { exitCode, stdout, stderr } = runCliWithArgs(["--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toBe("");
  });

  test("running without a file prints the help and exits with an error", () => {
    const { exitCode, stdout } = runCliWithArgs([]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe(runCliWithArgs(["--help"]).stdout);
  });

  test("rejects unknown options", () => {
    const { exitCode, stderr } = runCliWithArgs(["--nope"]);

    expect(exitCode).toBe(1);
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("the example shown in --help actually passes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smoking-help-example-"));
    const [ok, error] = await result(async () => {
      const examplePath = join(dir, "example.donly");
      await writeFile(examplePath, EXAMPLE_DONLY);

      const { exitCode, stdout } = runCliWithArgs([examplePath]);

      expect(exitCode).toBe(0);
      // The example installs the latest hotconfigs, so mask its version.
      expect(
        stdout.replace(/installed hotconfigs@[\d.]+/, "installed hotconfigs@<latest>"),
      ).toMatchSnapshot("stdout");
    });
    await rm(dir, { recursive: true, force: true });
    if (!ok) throw error;
  });
});
