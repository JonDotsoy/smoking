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

// `outer` calls `inner`, which does the math: the profile must show that call chain.
const NESTED = `case nested {
  run <<<ts
    const inner = (n: number) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += Math.sqrt(i);
      return sum;
    };
    const outer = (n: number) => inner(n) * 2;
    console.log(outer(3e7));
}
`;

type ProfileNode = {
  id: number;
  callFrame: { functionName: string; url: string };
  hitCount: number;
  children?: number[];
};

// Names of the script's own functions on the stack where most samples landed,
// outermost first (the runtimes' internal frames are left out).
const hottestStack = ({
  script,
  profile,
}: {
  script: string;
  profile: { nodes: ProfileNode[] };
}) => {
  const parent = new Map<number, ProfileNode>();
  for (const node of profile.nodes)
    for (const child of node.children ?? []) parent.set(child, node);
  const own = (node: ProfileNode) => node.callFrame.url.endsWith(script.replace(/^.*[\\/]/, ""));
  const hottest = profile.nodes.filter(own).reduce((a, b) => (b.hitCount > a.hitCount ? b : a));
  const stack: string[] = [];
  for (let node: ProfileNode | undefined = hottest; node; node = parent.get(node.id)) {
    if (own(node) && node.callFrame.functionName && node.callFrame.functionName !== "(module)") {
      stack.unshift(node.callFrame.functionName);
    }
  }
  return stack;
};

for (const runtime of ["bun", "node"]) {
  test(`snapshot of the call stack of nested functions doing math (${runtime})`, async () => {
    const { stdout } = await runDonly(NESTED, (file) => [
      "--json",
      "--profile",
      "--runtime",
      runtime,
      file,
    ]);

    const [run] = JSON.parse(stdout).cases[0].profiles;
    expect(hottestStack(run)).toMatchSnapshot();
  });
}
