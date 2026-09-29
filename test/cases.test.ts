import { describe, expect, test } from "bun:test";
import { HELP } from "../src/help.ts";
import { runCliWithArgs, runDonly } from "./helpers.ts";

const say = (text: string) => `  run <<<ts\n    console.log(${JSON.stringify(text)})\n`;

const RUNTIME_LABEL = `case {
  run <<<ts
    console.log(typeof (process.versions as any).bun === "undefined" ? "node" : "bun")
}
`;

describe("case directives", () => {
  test("one case directive", async () => {
    const { exitCode, stdout, stderr } = await runDonly(`case {\n${say("only")}}\n`);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("only\n✔ case 1\n");
    expect(stderr).toBe("");
  });

  test("five case directives run in order", async () => {
    const content = [1, 2, 3, 4, 5].map((n) => `case {\n${say(`run ${n}`)}}\n`).join("\n");

    const { exitCode, stdout } = await runDonly(content);

    expect(exitCode).toBe(0);
    expect(stdout).toBe([1, 2, 3, 4, 5].map((n) => `run ${n}\n✔ case ${n}\n`).join(""));
  });

  test("a named case (`case name {`) is reported by its name", async () => {
    const { stdout } = await runDonly(`case name {\n${say("hi")}}\n`);

    expect(stdout).toBe("hi\n✔ name\n");
  });

  test("an unnamed case (`case {`) is reported by its position", async () => {
    const content = `case first {\n${say("a")}}\n\ncase {\n${say("b")}}\n\ncase third {\n${say("c")}}\n\ncase {\n${say("d")}}\n`;

    const { stdout } = await runDonly(content);

    expect(stdout).toBe("a\n✔ first\nb\n✔ case 2\nc\n✔ third\nd\n✔ case 4\n");
  });

  test("names can have several words, quoted or not", async () => {
    const content = `case two words {\n${say("a")}}\n\ncase "quoted name" {\n${say("b")}}\n`;

    const { stdout } = await runDonly(content);

    expect(stdout).toBe("a\n✔ two words\nb\n✔ quoted name\n");
  });

  test("a case with run passes or fails with its exit code", async () => {
    const content = `case ok {\n${say("fine")}}\n\ncase bad {\n  run <<<ts\n    process.exit(7)\n}\n`;

    const { exitCode, stdout } = await runDonly(content);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("fine\n✔ ok\n✘ bad\n  exit code 7\n");
  });

  test("a case without run fails, and the other cases still run", async () => {
    const content = `case no-run {\n  env FOO bar\n}\n\ncase after {\n${say("still runs")}}\n`;

    const { exitCode, stdout } = await runDonly(content);

    expect(exitCode).toBe(1);
    expect(stdout).toBe("✘ no-run\n  case has no `run` directive\nstill runs\n✔ after\n");
  });

  test("a file without any case reports it and succeeds", async () => {
    const { exitCode, stdout } = await runDonly("dependency donly@0.0.29\n");

    expect(exitCode).toBe(0);
    expect(stdout).toContain("No `case` blocks found.");
  });

  for (const withSetup of [false, true]) {
    for (const withTeardown of [false, true]) {
      test(`case ${withSetup ? "with" : "without"} setup and ${withTeardown ? "with" : "without"} teardown`, async () => {
        const hook = (kind: string) => `  ${kind} <<<ts\n    console.log("${kind}")\n`;
        const content = `case hooks {\n${withSetup ? hook("setup") : ""}${hook("run")}${withTeardown ? hook("teardown") : ""}}\n`;

        const { exitCode, stdout } = await runDonly(content);

        const expected = [withSetup && "setup", "run", withTeardown && "teardown"]
          .filter(Boolean)
          .join("\n");
        expect(exitCode).toBe(0);
        expect(stdout).toBe(`${expected}\n✔ hooks\n`);
      });
    }
  }
});

describe("CLI arguments", () => {
  const helpOutput = HELP + "\n";

  test("<file>", async () => {
    const { exitCode, stdout } = await runDonly(RUNTIME_LABEL);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("bun\n✔ case 1\n");
  });

  test("without arguments prints the help and fails", () => {
    const { exitCode, stdout, stderr } = runCliWithArgs([]);

    expect(exitCode).toBe(1);
    expect(stdout).toBe(helpOutput);
    expect(stdout).toContain("USAGE");
    expect(stderr).toBe("");
  });

  for (const flag of ["--help", "-h"]) {
    test(flag, () => {
      const { exitCode, stdout, stderr } = runCliWithArgs([flag]);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(helpOutput);
      expect(stderr).toBe("");
    });
  }

  test("--help wins over other arguments", () => {
    const { exitCode, stdout } = runCliWithArgs(["--runtime", "deno", "--nope", "--help"]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe(helpOutput);
  });

  const runtimeForms: [string[], string][] = [
    [["--runtime", "bun"], "bun"],
    [["--runtime=bun"], "bun"],
    [["--runtime", "node"], "node"],
    [["--runtime=node"], "node"],
  ];
  for (const [args, runtime] of runtimeForms) {
    test(`${args.join(" ")} runs the script with ${runtime}`, async () => {
      const { exitCode, stdout } = await runDonly(RUNTIME_LABEL, (file) => [...args, file]);

      expect(exitCode).toBe(0);
      expect(stdout).toBe(`${runtime}\n✔ case 1\n`);
    });
  }

  test("options can come after the file", async () => {
    const { exitCode, stdout } = await runDonly(RUNTIME_LABEL, (file) => [file, "--runtime=node"]);

    expect(exitCode).toBe(0);
    expect(stdout).toBe("node\n✔ case 1\n");
  });

  const useDonly = `case {
  run <<<ts
    import { DON } from "donly"
    console.log(typeof DON.parse)
}
`;
  const dependencyForms: string[][] = [
    ["--dependency", "donly@0.0.29"],
    ["--dependency=donly@0.0.29"],
    ["--dependency", "donly@0.0.29", "--dependency=donly@0.0.29"],
    ["--dependency", "donly@0.0.29", "--runtime", "node"],
  ];
  for (const args of dependencyForms) {
    test(args.join(" "), async () => {
      const { exitCode, stdout } = await runDonly(useDonly, (file) => [...args, file]);

      expect(exitCode).toBe(0);
      expect(stdout).toContain("→ installing dependency: donly@0.0.29");
      expect(stdout).toEndWith("function\n✔ case 1\n");
      // A duplicated flag is installed only once.
      expect(stdout.match(/→ installing dependency/g)).toHaveLength(1);
    });
  }

  const invalid: [string[], string][] = [
    [["--nope"], "Unknown option: --nope"],
    [["--dependency"], "Option --dependency requires a value"],
    [["--dependency", "--runtime", "node"], "Option --dependency requires a value"],
    [["--runtime"], "Option --runtime requires a value"],
    [["--runtime="], "Option --runtime requires a value"],
    [["--runtime", "deno"], 'Invalid --runtime "deno": expected bun or node'],
  ];
  for (const [args, message] of invalid) {
    test(`${args.join(" ")} is rejected`, async () => {
      const { exitCode, stdout, stderr } = await runDonly(RUNTIME_LABEL, (file) => [file, ...args]);

      expect(exitCode).toBe(1);
      expect(stdout).toBe("");
      expect(stderr.split("\n")[0]).toBe(message);
      expect(stderr).toContain("USAGE");
    });
  }
});
