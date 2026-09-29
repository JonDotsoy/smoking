import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "bin", "smoking.ts");
const FIXTURES_DIR = join(import.meta.dir, "fixtures");

const normalize = (output: string): string =>
  output
    .replaceAll(/\/tmp\/smoking-[^/]+/g, "/tmp/smoking-<random>")
    .replaceAll(/Bun v[\d.]+ \([^)]+\)/g, "Bun v<version> (<platform>)")
    // `bun add`'s own noise: whether it needs to resolve/download, and how
    // long that takes, depends on whatever's already in the local package
    // cache rather than on the CLI's own behavior.
    .replaceAll(/^Resolving dependencies\n/gm, "")
    .replaceAll(/^Resolved, downloaded and extracted \[\d+\]\n/gm, "")
    .replaceAll(/^\[[\d.]+m?s\] done\n/gm, "")
    .replaceAll(/^\d+ packages? (?:installed|removed) \[[\d.]+m?s\]\n/gm, "");

const runCli = async (fixture: string, cwd: string) => {
  const result = Bun.spawnSync(["bun", CLI_PATH, join(FIXTURES_DIR, fixture)], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    stdout: normalize(result.stdout.toString()),
    stderr: normalize(result.stderr.toString()),
  };
};

const REPO_ROOT = join(import.meta.dir, "..");

describe("smoking CLI", () => {
  test("runs a mix of passing and failing cases", async () => {
    const { exitCode, stdout, stderr } = await runCli("mixed.donly", REPO_ROOT);

    expect(exitCode).toBe(1);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("installs a declared `dependency` before running the case", async () => {
    const { exitCode, stdout, stderr } = await runCli("dependency.donly", REPO_ROOT);

    expect(exitCode).toBe(0);
    expect(stdout).toMatchSnapshot("stdout");
    expect(stderr).toMatchSnapshot("stderr");
  });

  test("installs a `dependency` pinned to a specific version", async () => {
    // Run from a scratch project instead of the repo root: `bun add` writes
    // the resolved version into the cwd's package.json, and pinning a
    // version other than what this repo already depends on would otherwise
    // dirty this project's own package.json/bun.lock on every test run.
    const scratchDir = await mkdtemp(join(tmpdir(), "smoking-test-"));
    try {
      const { exitCode, stdout, stderr } = await runCli(
        "dependency-version.donly",
        scratchDir,
      );

      expect(exitCode).toBe(0);
      expect(stdout).toMatchSnapshot("stdout");
      expect(stderr).toMatchSnapshot("stderr");

      const installedPkg = await Bun.file(
        join(scratchDir, "node_modules", "donly", "package.json"),
      ).json();
      expect(installedPkg.version).toBe("0.0.28");
    } finally {
      await rm(scratchDir, { recursive: true, force: true });
    }
  });
});
