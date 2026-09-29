import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const CLI_PATH = join(import.meta.dir, "..", "bin", "smoking.ts");
const FIXTURES_DIR = join(import.meta.dir, "fixtures");

const normalize = (output: string): string =>
  output
    .replaceAll(/\/tmp\/smoking-[^/]+/g, "/tmp/smoking-<random>")
    .replaceAll(/Bun v[\d.]+ \([^)]+\)/g, "Bun v<version> (<platform>)");

const runCli = (fixture: string) => {
  const result = Bun.spawnSync(["bun", CLI_PATH, join(FIXTURES_DIR, fixture)], {
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
});
