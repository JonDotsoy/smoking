import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXAMPLE_DONLY } from "../src/help.ts";
import { FIXTURES_DIR, REPO_ROOT, runCli, runCliWithArgs } from "./helpers.ts";
import { result } from "../src/utils/result.ts";

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

  test("`add` copies a folder next to the spec file into the working directory", () => {
    const { exitCode, stdout } = runCliWithArgs([join(FIXTURES_DIR, "add-directive/add.donly")]);

    expect(exitCode).toBe(0);
    expect(stdout).toContain("added = hello from src");
  });

  test.each([
    ["a single file (`add file.json`)", "file.donly", ["file added"]],
    ["a folder (`add docs/`)", "dir.donly", ["dir added"]],
    [
      "an ambiguous path that is a file or a directory (`add path`)",
      "ambiguous.donly",
      ["file: plain file", "dir: inside dir"],
    ],
    ["a nested relative path (`add foo/tar/biz`)", "relative.donly", ["relative added"]],
  ])("`add` copies %s", (_label, fixture, expected) => {
    const { exitCode, stdout } = runCliWithArgs([join(FIXTURES_DIR, "add-directive", fixture)]);

    expect(exitCode).toBe(0);
    for (const line of expected) expect(stdout).toContain(line);
  });

  test("`add` fails the case when the path does not exist", () => {
    const { exitCode, stdout } = runCli("add-missing.donly");

    expect(exitCode).toBe(1);
    expect(stdout).toContain("path not found");
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

  test("runs a .yaml file: env, files, setup, teardown and file scripts", () => {
    const { exitCode, stdout } = runCli("mixed.yaml");

    expect(exitCode).toBe(1);
    expect(stdout).toContain("setup\nfile = Content\nteardown\n✔ pass");
    expect(stdout).toContain("✘ fail");
    expect(stdout).toContain("intentional failure");
    expect(stdout).toContain("setup.ts ran\n✔ case 3");
  });

  test("a .yml file is parsed as YAML too", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smoking-yml-"));
    const file = join(dir, "cases.yml");
    await writeFile(file, "cases:\n  - name: ok\n    run: console.log('hi')\n");
    const { exitCode, stdout } = runCliWithArgs([file]);
    await rm(dir, { recursive: true, force: true });

    expect(exitCode).toBe(0);
    expect(stdout).toBe("hi\n✔ ok\n");
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

  test("the README and examples/basic.donly show the same example as --help", async () => {
    const readme = await Bun.file(join(REPO_ROOT, "README.md")).text();
    const example = await Bun.file(join(REPO_ROOT, "examples", "basic.donly")).text();

    expect(example).toBe(EXAMPLE_DONLY);
    expect(readme).toContain(EXAMPLE_DONLY);
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
