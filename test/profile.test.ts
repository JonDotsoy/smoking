import { expect, test } from "bun:test";
import { runDonly } from "./helpers.ts";

const CASES = `case busy {
  setup <<<ts
    console.log("setup");
  run <<<ts
    let s = 0;
    for (let i = 0; i < 1e6; i++) s += i;
    console.log(s);
}
`;

type Profile = { phase: string; script: string; profile: { nodes: unknown[] } };

for (const runtime of ["bun", "node"]) {
  test(`--profile records a CPU profile of each script (${runtime})`, async () => {
    const { exitCode, stdout } = await runDonly(CASES, (file) => [
      "--json",
      "--profile",
      "--runtime",
      runtime,
      file,
    ]);

    expect(exitCode).toBe(0);
    const profiles: Profile[] = JSON.parse(stdout).cases[0].profiles;
    expect(profiles.map((p) => p.phase)).toEqual(["setup", "run"]);
    for (const p of profiles) expect(p.profile.nodes.length).toBeGreaterThan(0);
  });
}

test("without --profile the report has no profiles", async () => {
  const { stdout } = await runDonly(CASES, (file) => ["--json", file]);

  expect(JSON.parse(stdout).cases[0].profiles).toBeUndefined();
});
