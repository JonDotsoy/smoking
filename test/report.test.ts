import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hottestStack, runDonly } from "./helpers.ts";
import { result } from "../src/utils/result.ts";

// One case with everything a report records: console output, nested functions
// doing math (the profile) and a local server hit by a POST and a GET (the network).
const CASES = `case everything {
  run <<<ts
    import http from "node:http";
    const inner = (n: number) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += Math.sqrt(i);
      return sum;
    };
    const outer = (n: number) => inner(n) * 2;
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/plain");
      res.setHeader("x-smoking", "pong");
      res.end("pong");
    });
    await new Promise<void>((done) => server.listen(0, done));
    const url = \`http://localhost:\${(server.address() as { port: number }).port}/ping?n=1\`;
    await (await fetch(url, { method: "POST", body: "hello", headers: { "x-case": "post" } })).text();
    await (await fetch(url, { headers: { "x-case": "get" } })).text();
    server.close();
    console.log(outer(3e7));
}
`;

type Chunk = { elapse: unknown; stream: string; buffer: number[] };
type Request = Record<string, any>;

// What changes on every run (paths, ports, dates, timings, the profile's
// samples) is replaced, so the snapshot keeps the report's whole shape and
// every stable value.
const normalize = (report: Record<string, any>) => {
  const [testCase] = report.cases;

  const { startAt, chunks } = testCase.cast;
  expect(startAt).toBeGreaterThan(1_000_000_000_000);
  testCase.cast = {
    startAt: "<startAt>",
    chunks: chunks.map((chunk: Chunk) => ({ ...chunk, elapse: "<elapse>" })),
  };

  testCase.profiles = testCase.profiles.map((run: Record<string, any>) => ({
    phase: run.phase,
    script: run.script.replace(/^.*[\\/]/, ""),
    profileKeys: Object.keys(run.profile),
    root: run.profile.nodes[0].callFrame,
    hottestStack: hottestStack(run as Parameters<typeof hottestStack>[0]),
  }));

  testCase.network = testCase.network.map((request: Request) => {
    expect(request.startedAt).toBeGreaterThan(1_000_000_000_000);
    expect(request.duration).toBeGreaterThanOrEqual(0);
    const masked = (headers: Record<string, string> | undefined) =>
      headers &&
      Object.fromEntries(
        Object.entries(headers)
          // Whether a response carries these depends on the runtime's version.
          .filter(([name]) => !["connection", "keep-alive"].includes(name.toLowerCase()))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([name, value]) => [
            name,
            ["date", "host"].includes(name.toLowerCase()) ? `<${name}>` : value,
          ]),
      );
    return {
      ...request,
      script: request.script.replace(/^.*[\\/]/, ""),
      url: request.url.replace(/localhost:\d+/, "localhost:<port>"),
      startedAt: "<startedAt>",
      duration: "<duration>",
      requestHeaders: masked(request.requestHeaders),
      responseHeaders: masked(request.responseHeaders),
    };
  });

  return { ...report, file: "<file>" };
};

for (const runtime of ["bun", "node"]) {
  test(`report.json with its profile and network matches its snapshot (${runtime})`, async () => {
    const dir = await mkdtemp(join(tmpdir(), "smoking-report-"));
    const output = join(dir, "report.json");
    const [ok, error, report] = await result(async () => {
      const run = await runDonly(CASES, (file) => ["--output", output, "--runtime", runtime, file]);
      expect(run.exitCode).toBe(0);
      return JSON.parse(await Bun.file(output).text());
    });
    await rm(dir, { recursive: true, force: true });
    if (!ok) throw error;

    // The profile is there, with the call chain of the nested functions...
    const [run] = report.cases[0].profiles;
    expect(run.profile.nodes.length).toBeGreaterThan(1);
    expect(hottestStack(run)).toEqual(["outer", "inner"]);
    // ...and so is the whole network: both requests, each with its response.
    expect(report.cases[0].network).toHaveLength(2);

    expect(normalize(report)).toMatchSnapshot();
  });
}
