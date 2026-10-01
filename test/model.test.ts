import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { Case, Script, SmokingFile } from "../src/model.ts";

const DONLY = `case tar {
  env FOO bar
  file ./a.txt <<<txt
    hi
  run <<<ts
    console.log("foo")
}
`;

const YAML = `cases:
  - name: tar
    env:
      FOO: bar
    files:
      ./a.txt: hi
    run: |
      console.log("foo")
`;

describe("SmokingFile", () => {
  test.each([
    ["donly", "/tmp/x/a.donly", DONLY],
    ["yaml", "/tmp/x/a.yaml", YAML],
  ])("%s parses into the same instances", async (_, path, text) => {
    const file = await SmokingFile.parse(path, text);

    expect(file.location.href).toBe(`file://${path}`);
    const [tar] = file.cases;
    expect(tar).toBeInstanceOf(Case);
    expect(tar?.name).toBe("tar");
    expect(tar?.env).toEqual({ FOO: "bar" });
    expect(new TextDecoder().decode(tar?.files.get("./a.txt"))).toContain("hi");
    expect(tar?.run).toBeInstanceOf(Script);
    expect(tar?.run?.syntax).toBe("ts");
    expect(tar?.run?.command).toBeInstanceOf(Uint8Array);
    expect(tar?.run?.text).toContain(`console.log("foo")`);
  });

  test("a script given as a path is read from disk", async () => {
    const path = resolve(import.meta.dir, "fixtures/mixed.yaml");
    const file = await SmokingFile.fromFile(path);
    const last = file.cases.at(-1);

    expect(last?.run?.location?.pathname).toBe(
      resolve(import.meta.dir, "fixtures/external/configs/setup.ts"),
    );
    expect(last?.run?.text.length).toBeGreaterThan(0);
  });

  test("a malformed script throws", async () => {
    expect(SmokingFile.parse("/tmp/a.donly", "case { run }")).rejects.toThrow("run");
  });
});
