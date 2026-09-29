import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "bin", "smoking.ts");
const FIXTURES_DIR = join(import.meta.dir, "fixtures");
const REPO_ROOT = join(import.meta.dir, "..");

const normalize = (output: string): string =>
  output
    .replaceAll(/\/tmp\/smoking-run-[^/]+/g, "/tmp/smoking-run-<random>")
    .replaceAll(/Bun v[\d.]+ \([^)]+\)/g, "Bun v<version> (<platform>)")
    // `bun add`'s own noise: whether it needs to resolve/download, and how
    // long that takes, depends on whatever's already in the local package
    // cache rather than on the CLI's own behavior.
    .replaceAll(/^Resolving dependencies\n/gm, "")
    .replaceAll(/^Resolved, downloaded and extracted \[\d+\]\n/gm, "")
    .replaceAll(/^\[[\d.]+m?s\] done\n/gm, "")
    .replaceAll(/^\d+ packages? (?:installed|removed) \[[\d.]+m?s\]\n/gm, "");

const runCli = (fixture: string) => {
  // `smoking` runs each file in its own scratch temp directory (installing
  // dependencies and running case scripts there), so it never touches this
  // repo's own package.json/node_modules regardless of the cwd it's run from.
  const result = Bun.spawnSync(["bun", CLI_PATH, join(FIXTURES_DIR, fixture)], {
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
});
