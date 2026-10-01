import type { Capture } from "./capture.ts";
import { result } from "./utils/result.ts";

export type PlayableCase = { name: string; cast: Capture };

const isCapture = (value: unknown): value is Capture => {
  const cast = value as Capture | null | undefined;
  return (
    typeof cast?.startAt === "number" &&
    Array.isArray(cast.chunks) &&
    cast.chunks.every(
      (chunk) =>
        typeof chunk?.elapse === "number" &&
        (chunk.stream === "stdout" || chunk.stream === "stderr") &&
        Array.isArray(chunk.buffer),
    )
  );
};

// The cases of a saved report (`--json`/`--output`) that carry a cast.
export const parsePlayableCases = (text: string): PlayableCase[] => {
  const [ok, error, report] = result(() => JSON.parse(text) as { cases?: unknown });
  if (!ok)
    throw new Error(`not a valid JSON report: ${error instanceof Error ? error.message : error}`);
  if (!Array.isArray(report?.cases)) throw new Error("not a smoking report: no `cases` found");

  const cases: PlayableCase[] = [];
  for (const [index, c] of report.cases.entries()) {
    if (c?.cast === undefined) continue;
    if (!isCapture(c.cast)) throw new Error(`case ${index + 1} has a malformed \`cast\``);
    cases.push({ name: String(c.name ?? `case ${index + 1}`), cast: c.cast });
  }
  if (cases.length === 0) {
    throw new Error("the report has no cast to play (it was saved with --no-cast?)");
  }
  return cases;
};

export type PlayIO = {
  stdout: { write(bytes: Uint8Array): unknown };
  stderr: { write(bytes: Uint8Array | string): unknown };
  sleep(ms: number): Promise<unknown>;
};

// Replays the recorded bytes of every case with their original timing.
export const play = async (
  cases: PlayableCase[],
  { stdout, stderr, sleep }: PlayIO = {
    stdout: process.stdout,
    stderr: process.stderr,
    sleep: Bun.sleep,
  },
): Promise<void> => {
  for (const { name, cast } of cases) {
    stderr.write(`▶ ${name}\n`);
    const startedAt = performance.now();
    for (const chunk of cast.chunks) {
      const wait = chunk.elapse - (performance.now() - startedAt);
      if (wait > 0) await sleep(wait);
      (chunk.stream === "stdout" ? stdout : stderr).write(Uint8Array.from(chunk.buffer));
    }
  }
};
