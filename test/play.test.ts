import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePlayableCases, play } from "../src/play.ts";
import { result } from "../src/utils/result.ts";
import { runCliWithArgs } from "./helpers.ts";

const cast = (chunks: [number, "stdout" | "stderr", number[]][]) => ({
  startAt: 1_700_000_000_000,
  chunks: chunks.map(([elapse, stream, buffer]) => ({ elapse, stream, buffer })),
});

describe("parsePlayableCases", () => {
  test("keeps the cases that have a cast", () => {
    const text = JSON.stringify({
      cases: [{ name: "a", cast: cast([]) }, { name: "b" }, { cast: cast([]) }],
    });
    expect(parsePlayableCases(text).map((c) => c.name)).toEqual(["a", "case 3"]);
  });

  test.each([
    ["not json", "not a valid JSON report"],
    ["{}", "no `cases`"],
    [JSON.stringify({ cases: [{ name: "a" }] }), "no cast to play"],
    [JSON.stringify({ cases: [{ cast: { startAt: 1 } }] }), "malformed `cast`"],
  ])("rejects %s", (text, message) => {
    const [ok, error] = result(() => parsePlayableCases(text));
    expect(ok).toBe(false);
    expect((error as Error).message).toContain(message);
  });
});

describe("play", () => {
  test("writes each chunk to its stream, waiting for its elapse", async () => {
    const out: number[][] = [];
    const err: (number[] | string)[] = [];
    const waits: number[] = [];
    await play(
      [
        {
          name: "a",
          cast: cast([
            [10, "stdout", [104, 0, 255]],
            [20, "stderr", [33]],
          ]),
        },
      ],
      {
        stdout: { write: (b) => out.push([...(b as Uint8Array)]) },
        stderr: { write: (b) => err.push(typeof b === "string" ? b : [...b]) },
        sleep: async (ms) => void waits.push(ms),
      },
    );

    expect(out).toEqual([[104, 0, 255]]);
    expect(err).toEqual(["▶ a\n", [33]]);
    expect(waits).toHaveLength(2);
    expect(waits[0]).toBeGreaterThan(0);
    expect(waits[0]).toBeLessThanOrEqual(10);
  });
});

describe("smoking play", () => {
  test("replays a report saved with --output", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smoking-play-"));
    const [ok, error, run] = await result(async () => {
      const donly = join(dir, "cases.donly");
      await writeFile(donly, 'case hi {\n  run <<<ts\n    console.log("hello")\n}\n');
      const report = join(dir, "report.json");
      runCliWithArgs(["--output", report, donly]);
      return runCliWithArgs(["play", report]);
    });
    await rm(dir, { recursive: true, force: true });
    if (!ok) throw error;

    expect(run!.exitCode).toBe(0);
    expect(run!.stdout).toBe("hello\n");
    expect(run!.stderr).toBe("▶ hi\n");
  });

  test("fails without a report file or with an unreadable one", () => {
    expect(runCliWithArgs(["play"]).exitCode).toBe(1);
    const missing = runCliWithArgs(["play", "/nonexistent/report.json"]);
    expect(missing.exitCode).toBe(1);
    expect(missing.stderr).toContain("Could not play /nonexistent/report.json");
  });
});
