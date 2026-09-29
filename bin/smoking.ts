#!/usr/bin/env bun
import { HELP } from "../src/help.ts";
import { RUNTIMES, runDonlyFile, type Runtime } from "../src/run-file.ts";

const fail = (message: string): never => {
  console.error(`${message}\n`);
  console.error(HELP);
  process.exit(1);
};

const args = process.argv.slice(2);

if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}

const dependencies: string[] = [];
const positional: string[] = [];
let runtime: Runtime = "bun";

const optionValue = (arg: string, name: string, next: () => string | undefined): string => {
  const value = arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : next();
  if (!value || value.startsWith("-")) return fail(`Option ${name} requires a value`);
  return value;
};

for (let i = 0; i < args.length; i++) {
  const arg = args[i]!;
  if (arg === "--dependency" || arg.startsWith("--dependency=")) {
    dependencies.push(optionValue(arg, "--dependency", () => args[++i]));
  } else if (arg === "--runtime" || arg.startsWith("--runtime=")) {
    const value = optionValue(arg, "--runtime", () => args[++i]);
    if (!RUNTIMES.includes(value as Runtime)) {
      fail(`Invalid --runtime "${value}": expected ${RUNTIMES.join(" or ")}`);
    }
    runtime = value as Runtime;
  } else if (arg.startsWith("-")) {
    fail(`Unknown option: ${arg}`);
  } else {
    positional.push(arg);
  }
}

const filePath = positional[0];
if (!filePath) {
  console.log(HELP);
  process.exit(1);
}

const ok = await runDonlyFile(filePath, { dependencies, runtime });
process.exit(ok ? 0 : 1);
