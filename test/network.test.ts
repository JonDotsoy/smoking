import { expect, test } from "bun:test";
import { runDonly } from "./helpers.ts";

// The case starts its own server, then makes a POST and a GET to it.
const CASES = `case requests {
  run <<<ts
    import http from "node:http";
    const server = http.createServer((_req, res) => {
      res.setHeader("content-type", "text/plain");
      res.end("pong");
    });
    await new Promise<void>((done) => server.listen(0, done));
    const url = \`http://localhost:\${(server.address() as { port: number }).port}/ping?n=1\`;
    await (await fetch(url, { method: "POST", body: "hello" })).text();
    await (await fetch(url)).text();
    server.close();
}
`;

type Request = {
  phase: string;
  method: string;
  url: string;
  postData?: string;
  status: number;
  mimeType: string;
  startedAt: number;
  duration: number;
};

for (const runtime of ["bun", "node"]) {
  test(`--network records the requests of each case (${runtime})`, async () => {
    const { exitCode, stdout } = await runDonly(CASES, (file) => [
      "--json",
      "--network",
      "--runtime",
      runtime,
      file,
    ]);

    expect(exitCode).toBe(0);
    const requests: Request[] = JSON.parse(stdout).cases[0].network;
    expect(
      requests.map((r) => [r.phase, r.method, new URL(r.url).pathname + new URL(r.url).search]),
    ).toEqual([
      ["run", "POST", "/ping?n=1"],
      ["run", "GET", "/ping?n=1"],
    ]);
    // Node's inspector does not report request bodies.
    expect(requests[0]!.postData).toBe(runtime === "bun" ? "hello" : undefined);
    for (const request of requests) {
      expect(request.status).toBe(200);
      expect(request.mimeType).toBe("text/plain");
      expect(request.startedAt).toBeGreaterThan(1_000_000_000_000);
      expect(request.duration).toBeGreaterThanOrEqual(0);
    }
  });
}

test("without --network the report has no network", async () => {
  const { stdout } = await runDonly(CASES, (file) => ["--json", file]);

  expect(JSON.parse(stdout).cases[0].network).toBeUndefined();
});
