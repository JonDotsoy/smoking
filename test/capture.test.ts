import { expect, test } from "bun:test";
import { runDonly } from "./helpers.ts";

const CASES = `case prints {
  run <<<ts
    process.stdout.write(Buffer.from([104, 105, 0, 255]));
    await Bun.sleep(30);
    console.error("oops");
}
`;

test("--capture records console bytes with their elapsed time", async () => {
  const { exitCode, stdout } = await runDonly(CASES, (file) => ["--json", "--capture", file]);

  expect(exitCode).toBe(0);
  const capture = JSON.parse(stdout).cases[0].capture;
  expect(capture.startAt).toBeGreaterThan(1_000_000_000_000);
  const out = capture.chunks.filter((c: { stream: string }) => c.stream === "stdout");
  const err = capture.chunks.filter((c: { stream: string }) => c.stream === "stderr");
  expect(out.flatMap((c: { buffer: number[] }) => c.buffer)).toEqual([104, 105, 0, 255]);
  expect(Buffer.from(err.flatMap((c: { buffer: number[] }) => c.buffer)).toString()).toBe("oops\n");
  expect(out[0].elapse).toBeGreaterThanOrEqual(0);
  expect(err[0].elapse).toBeGreaterThan(out[0].elapse);
});

test("without --capture the report has no capture", async () => {
  const { stdout } = await runDonly(CASES, (file) => ["--json", file]);
  expect(JSON.parse(stdout).cases[0].capture).toBeUndefined();
});
