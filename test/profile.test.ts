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

// A profile's samples and timings change on every run, so the snapshot keeps
// only its stable shape: which scripts were profiled and what a profile holds.
const shapeOf = ({ phase, script, profile }: Profile & { profile: Record<string, unknown> }) => {
  const nodes = profile.nodes as { callFrame: unknown }[];
  return {
    phase,
    script: script.replace(/^.*[\\/]/, ""),
    profileKeys: Object.keys(profile),
    root: nodes[0]!.callFrame,
    samples: Array.isArray(profile.samples),
    timeDeltas: Array.isArray(profile.timeDeltas),
  };
};

test("snapshot of the shape of the profiles in a report", async () => {
  const { stdout } = await runDonly(CASES, (file) => ["--json", "--profile", file]);

  const profiles = JSON.parse(stdout).cases[0].profiles;
  expect(profiles.map(shapeOf)).toMatchSnapshot();
});
