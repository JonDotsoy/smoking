import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Capture } from "../src/capture.ts";
import { parsePlayableCases, play } from "../src/play.ts";
import { result } from "../src/utils/result.ts";
import { runCliWithArgs, runDonly } from "./helpers.ts";

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

describe("smoking run", () => {
  const CASE = 'case ok {\n  run <<<ts\n    console.log("ran")\n}\n';

  test("runs a manifest, like the bare form", async () => {
    const run = await runDonly(CASE, (file) => ["run", file]);
    const bare = await runDonly(CASE);

    expect(run.exitCode).toBe(0);
    expect(run.stdout).toBe(bare.stdout);
    expect(run.stdout).toContain("✔ ok");
  });

  test("runs a manifest named like a command", async () => {
    const dir = await mkdtemp(join(tmpdir(), "smoking-run-name-"));
    const [ok, error, run] = await result(async () => {
      await writeFile(join(dir, "play"), CASE);
      return runCliWithArgs(["run", join(dir, "play")]);
    });
    await rm(dir, { recursive: true, force: true });
    if (!ok) throw error;

    expect(run!.exitCode).toBe(0);
    expect(run!.stdout).toContain("✔ ok");
  });

  test("without a manifest it prints the help", () => {
    const run = runCliWithArgs(["run"]);
    expect(run.exitCode).toBe(1);
    expect(run.stdout).toContain("USAGE");
  });
});

describe("smoking play --ui", () => {
  const report = JSON.stringify({ cases: [{ name: "a", cast: cast([[1, "stdout", [104]]]) }] });

  test("serves the player and the report", async () => {
    const { serveReportUI } = await import("../src/play-ui.ts");
    const server = serveReportUI(report);
    const [ok, error] = await result(async () => {
      const home = await fetch(server.url, { redirect: "manual" });
      expect(home.status).toBe(302);
      expect(home.headers.get("location")).toBe(`${server.url.origin}/?report=/report.json`);

      const player = await fetch(new URL("/?report=/report.json", server.url));
      expect(player.headers.get("content-type")).toContain("text/html");
      expect(await player.text()).toContain("<title>smoking · player</title>");

      expect(await (await fetch(new URL("/report.json", server.url))).text()).toBe(report);
    });
    await server.stop(true);
    if (!ok) throw error;
  });

  test("rejects a report without a cast before serving", async () => {
    const { serveReportUI } = await import("../src/play-ui.ts");
    const [ok] = result(() => serveReportUI("{}"));
    expect(ok).toBe(false);
  });

  test("the CLI needs a report file", () => {
    const run = runCliWithArgs(["play", "--ui"]);
    expect(run.exitCode).toBe(1);
    expect(run.stderr).toContain("Usage: smoking play [--ui] <report file>");
  });
});

describe("colors in the cast", () => {
  const log = (env: string) => `case c {\n${env}  run <<<ts\n    console.log({ n: 1 })\n}\n`;
  const castText = async (donly: string) => {
    const dir = await mkdtemp(join(tmpdir(), "smoking-colors-"));
    const [ok, error, text] = await result(async () => {
      const file = join(dir, "c.donly");
      await writeFile(file, donly);
      const report = join(dir, "report.json");
      const run = runCliWithArgs(["--output", report, file]);
      if (run.exitCode !== 0) throw new Error(run.stderr);
      const { cases } = (await Bun.file(report).json()) as { cases: { cast: Capture }[] };
      return cases[0]!.cast.chunks.map((c) => String.fromCharCode(...c.buffer)).join("");
    });
    await rm(dir, { recursive: true, force: true });
    if (!ok) throw error;
    return text!;
  };

  test("the output is recorded as is: a pipe gets no colors", async () => {
    expect(await castText(log(""))).toBe("{\n  n: 1,\n}\n");
  });

  test("`env FORCE_COLOR 1` records the ANSI colors of console.log", async () => {
    expect(await castText(log("  env FORCE_COLOR 1\n"))).toContain("\x1b[33m1\x1b[");
  });
});
