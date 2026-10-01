import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { result } from "../src/utils/result.ts";
import { runDonly } from "./helpers.ts";

const CASES = `case prints {
  run <<<ts
    process.stdout.write(Buffer.from([104, 105, 0, 255]));
    await Bun.sleep(30);
    console.error("oops");
}
`;

test("a report includes the cast, with the console bytes and their elapsed time", async () => {
  const { exitCode, stdout } = await runDonly(CASES, (file) => ["--json", file]);

  expect(exitCode).toBe(0);
  const capture = JSON.parse(stdout).cases[0].cast;
  expect(capture.startAt).toBeGreaterThan(1_000_000_000_000);
  const out = capture.chunks.filter((c: { stream: string }) => c.stream === "stdout");
  const err = capture.chunks.filter((c: { stream: string }) => c.stream === "stderr");
  expect(out.flatMap((c: { buffer: number[] }) => c.buffer)).toEqual([104, 105, 0, 255]);
  expect(Buffer.from(err.flatMap((c: { buffer: number[] }) => c.buffer)).toString()).toBe("oops\n");
  expect(out[0].elapse).toBeGreaterThanOrEqual(0);
  expect(err[0].elapse).toBeGreaterThan(out[0].elapse);
});

test("--no-cast leaves the cast out of the report", async () => {
  const { stdout } = await runDonly(CASES, (file) => ["--json", "--no-cast", file]);
  expect(JSON.parse(stdout).cases[0].cast).toBeUndefined();
});

test("without a report flag there is no cast", async () => {
  const { stdout } = await runDonly(CASES);
  expect(stdout).not.toContain("startAt");
});

test("the report file saved with --output matches its snapshot", async () => {
  const dir = await mkdtemp(join(tmpdir(), "smoking-report-"));
  const output = join(dir, "nested", "report.json");
  const [ok, error, report] = await result(async () => {
    await runDonly(CASES, (file) => ["--output", output, "--no-profile", file]);
    return JSON.parse(await Bun.file(output).text());
  });
  await rm(dir, { recursive: true, force: true });
  if (!ok) throw error;

  // The file path, start time and timings change on every run.
  report.file = "<file>";
  for (const c of report.cases) {
    expect(c.cast.startAt).toBeGreaterThan(1_000_000_000_000);
    c.cast.startAt = "<startAt>";
    for (const chunk of c.cast.chunks) {
      expect(chunk.elapse).toBeGreaterThanOrEqual(0);
      chunk.elapse = "<elapse>";
    }
  }
  expect(report).toMatchSnapshot();
});
