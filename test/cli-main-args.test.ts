import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CliArgsError, CliMainArgs } from "../src/cli-main-args.ts";
import { result } from "../src/utils/result.ts";

const parse = (...args: string[]) => new CliMainArgs().parse(args);

const errorOf = (...args: string[]): CliArgsError => {
  const [ok, error] = result(() => parse(...args));
  if (ok) throw new Error("expected parse() to throw");
  return error as CliArgsError;
};

describe("CliMainArgs", () => {
  test("defaults to the bun runtime and no extra dependencies", () => {
    expect(parse("cases.donly")).toEqual({
      dependencies: [],
      runtime: "bun",
      file: pathToFileURL(resolve("cases.donly")),
    });
  });

  test("returns the file as a URL resolved from the current directory", () => {
    const { file } = parse("app/cases.donly");

    expect(file).toBeInstanceOf(URL);
    expect(file.protocol).toBe("file:");
    expect(file.href.endsWith("/app/cases.donly")).toBe(true);
  });

  test("collects every --dependency, in order", () => {
    const { dependencies } = parse(
      "--dependency",
      "lodash",
      "--dependency=react@18",
      "cases.donly",
    );

    expect(dependencies).toEqual(["lodash", "react@18"]);
  });

  test("accepts --runtime node and bun, before or after the file", () => {
    expect(parse("--runtime", "node", "cases.donly").runtime).toBe("node");
    expect(parse("cases.donly", "--runtime=node").runtime).toBe("node");
    expect(parse("--runtime=bun", "cases.donly").runtime).toBe("bun");
  });

  test("rejects an unsupported runtime", () => {
    const error = errorOf("--runtime", "deno", "cases.donly");

    expect(error.kind).toBe("invalid");
    expect(error.message).toBe('Invalid --runtime "deno": expected bun or node');
  });

  test("rejects options without a value", () => {
    expect(errorOf("--dependency").message).toBe("Option --dependency requires a value");
    expect(errorOf("--runtime", "--dependency", "x", "f.donly").message).toBe(
      "Option --runtime requires a value",
    );
    expect(errorOf("--dependency=", "f.donly").kind).toBe("invalid");
  });

  test("rejects unknown options", () => {
    const error = errorOf("--nope", "cases.donly");

    expect(error.kind).toBe("invalid");
    expect(error.message).toBe("Unknown option: --nope");
  });

  test("signals help requests, even next to other arguments", () => {
    expect(errorOf("--help").kind).toBe("help");
    expect(errorOf("-h", "--nope").kind).toBe("help");
  });

  test("signals a missing file", () => {
    expect(errorOf().kind).toBe("missing-file");
    expect(errorOf("--runtime", "node").kind).toBe("missing-file");
  });
});
